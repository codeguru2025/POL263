import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Archive } from "lucide-react";

type Row = { id: string; name: string; location: string; serial: string };

export default function StaffAssetsRegister() {
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [serial, setSerial] = useState("");

  const add = () => {
    if (!name.trim()) return;
    setRows((r) => [{ id: crypto.randomUUID(), name: name.trim(), location: location.trim(), serial: serial.trim() }, ...r]);
    setName("");
    setLocation("");
    setSerial("");
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Asset register"
          description="Optional checklist for branches that track physical kit (terminals, printers, vehicles). Stored in this session only until a dedicated module is added."
        />
        <CardSection title="Add entry" icon={Archive}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input placeholder="Asset name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Location / branch" value={location} onChange={(e) => setLocation(e.target.value)} />
            <Input placeholder="Serial / tag" value={serial} onChange={(e) => setSerial(e.target.value)} />
          </div>
          <Button type="button" className="mt-3" onClick={add} disabled={!name.trim()}>
            Add row
          </Button>
        </CardSection>
        <CardSection title="Register" icon={Archive}>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rows yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rows.map((r) => (
                <li key={r.id} className="px-3 py-2 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground tabular-nums">{r.location || "—"} · {r.serial || "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
