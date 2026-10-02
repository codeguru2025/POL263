import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { CardSection } from "@/components/ds";
import { Calendar, Loader2 } from "lucide-react";

type Cell = { target: number | null; actual: number | null; variance: number | null; variancePct: number | null };
interface BudgetMonth { month: string; share: number; income: Cell; expenses: Cell; newPolicies: Cell }
interface BudgetResponse { year: string; today: string; months: BudgetMonth[]; yearToDate: { income: Cell; expenses: Cell; newPolicies: Cell }; unconvertible: string[] }

const CATS = [
  { key: "total_income", field: "income", label: "Income", money: true, goodWhenUp: true },
  { key: "total_expenses", field: "expenses", label: "Expenses", money: true, goodWhenUp: false },
  { key: "new_policies", field: "newPolicies", label: "New policies", money: false, goodWhenUp: true },
] as const;

const fmt = (n: number | null, money: boolean) =>
  n == null ? "—" : money ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const monthName = (m: string) => new Date(m + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });

/** The difference, coloured by whether it's good news: more income / policies, or less spending. */
function Diff({ cell, money, goodWhenUp }: { cell: Cell; money: boolean; goodWhenUp: boolean }) {
  if (cell.variance == null) return <span className="text-muted-foreground">—</span>;
  const good = goodWhenUp ? cell.variance >= 0 : cell.variance <= 0;
  return (
    <span className={`tabular-nums ${good ? "text-emerald-700" : "text-rose-700"}`}>
      {cell.variance > 0 ? "+" : ""}{fmt(cell.variance, money)}{cell.variancePct != null && <span className="text-[10px] ml-1">({cell.variancePct > 0 ? "+" : ""}{cell.variancePct}%)</span>}
    </span>
  );
}

export function BudgetPanel({ year, enabled }: { year: string; enabled: boolean }) {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery<any[]>({
    queryKey: ["budgets", year],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/budgets?from=${year}-01-01&to=${year}-12-31`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled,
  });
  const report = useQuery<BudgetResponse>({
    queryKey: ["reports", "budget-vs-actual", year],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/reports/budget-vs-actual?year=${year}`, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the budget comparison");
      return res.json();
    },
    enabled,
  });
  const save = useMutation({
    mutationFn: (b: { periodMonth: string; category: string; amount: string }) => apiRequest("POST", "/api/budgets", { ...b, currency: "USD" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets", year] });
      qc.invalidateQueries({ queryKey: ["reports", "budget-vs-actual", year] });
    },
  });
  const valueOf = (month: string, cat: string) => {
    const r = rows.find((b) => String(b.periodMonth).slice(0, 7) === month.slice(0, 7) && b.category === cat);
    return r ? String(Number(r.amount)) : "";
  };
  const months = report.data?.months ?? Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}-01`, share: 0 } as BudgetMonth));
  const ytd = report.data?.yearToDate;

  return (
    <CardSection
      title={`Budget — ${year}`}
      description="Each month's target next to what actually happened. Type a target and click away to save. The month in progress is compared with its target for the days gone by. Income and expenses are the Income Statement's figures in USD; new policies are new business only (not existing policies typed in)."
      icon={Calendar}
      flush
    >
      <div className="p-4 overflow-x-auto">
        {report.isError && <p className="text-xs text-destructive mb-2">{(report.error as Error).message}. Try again.</p>}
        <table className="text-sm border-separate border-spacing-0 min-w-[980px]">
          <thead>
            <tr className="text-xs uppercase text-muted-foreground">
              <th className="text-left px-2 py-2 sticky left-0 bg-card" rowSpan={2}>Month</th>
              {CATS.map((c) => <th key={c.key} colSpan={3} className="text-center px-2 pt-2 border-l">{c.label}{c.money ? " (USD)" : ""}</th>)}
            </tr>
            <tr className="text-[10px] uppercase text-muted-foreground">
              {CATS.map((c) => (
                <th key={c.key} colSpan={3} className="border-l p-0">
                  <div className="grid grid-cols-3"><span className="text-right px-2 py-1">Target</span><span className="text-right px-2 py-1">Actual</span><span className="text-right px-2 py-1">Difference</span></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t">
                <td className="px-2 py-1 whitespace-nowrap text-xs sticky left-0 bg-card">
                  {monthName(m.month)}
                  {m.share > 0 && m.share < 1 && <span className="block text-[10px] text-muted-foreground">so far ({Math.round(m.share * 100)}% of month)</span>}
                </td>
                {CATS.map((c) => {
                  const cell: Cell | undefined = (m as any)[c.field];
                  const saved = valueOf(m.month, c.key);
                  return (
                    <td key={c.key} colSpan={3} className="border-l px-1 py-1">
                      <div className="grid grid-cols-3 items-center gap-1">
                        <input
                          key={`${m.month}-${c.key}-${saved}`}
                          type="number"
                          inputMode="decimal"
                          defaultValue={saved}
                          className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm text-right tabular-nums"
                          placeholder="—"
                          title={cell?.target != null && m.share > 0 && m.share < 1 ? `Target so far: ${fmt(cell.target, c.money)}` : undefined}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v === "" || v === saved) return;
                            save.mutate({ periodMonth: m.month, category: c.key, amount: String(Number(v).toFixed(2)) });
                          }}
                        />
                        <span className="text-right tabular-nums px-1">{fmt(cell?.actual ?? null, c.money)}</span>
                        <span className="text-right px-1">{cell ? <Diff cell={cell} money={c.money} goodWhenUp={c.goodWhenUp} /> : "—"}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {ytd && (
              <tr className="border-t font-semibold">
                <td className="px-2 py-2 text-xs sticky left-0 bg-card">Year to date</td>
                {CATS.map((c) => {
                  const cell: Cell = (ytd as any)[c.field];
                  return (
                    <td key={c.key} colSpan={3} className="border-l px-1 py-2">
                      <div className="grid grid-cols-3 items-center gap-1">
                        <span className="text-right tabular-nums px-1">{fmt(cell.target, c.money)}</span>
                        <span className="text-right tabular-nums px-1">{fmt(cell.actual, c.money)}</span>
                        <span className="text-right px-1"><Diff cell={cell} money={c.money} goodWhenUp={c.goodWhenUp} /></span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
        {report.isLoading && <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Loading actuals…</p>}
        {save.isPending && <p className="text-xs text-muted-foreground mt-2">Saving…</p>}
        {ytd && ytd.income.target == null && ytd.expenses.target == null && ytd.newPolicies.target == null && (
          <p className="text-xs text-muted-foreground mt-2">No targets set for {year} yet — the actual figures are shown so you can set realistic ones.</p>
        )}
        {(report.data?.unconvertible?.length ?? 0) > 0 && (
          <p className="text-xs text-amber-700 mt-2">No exchange rate for {report.data!.unconvertible.join(", ")} — those amounts are left out of the USD figures. Set the rate under Settings.</p>
        )}
      </div>
    </CardSection>
  );
}
