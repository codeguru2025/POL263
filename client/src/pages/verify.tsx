import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Clock, FileText, Receipt } from "lucide-react";
import { getApiBase } from "@/lib/queryClient";

interface VerifyResult {
  valid: boolean;
  type?: "receipt" | "policy" | "form";
  ref?: string;
  policyNumber?: string;
  status?: string;
  startDate?: string;
  amount?: string;
  currency?: string;
  date?: string;
  org?: string;
  message?: string;
}

export default function VerifyPage() {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    const id = params.get("id");
    if (!type || !id) {
      setResult({ valid: false, message: "Invalid verification link." });
      setLoading(false);
      return;
    }
    fetch(`${getApiBase()}/api/public/verify?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => setResult(data))
      .catch(() => setResult({ valid: false, message: "Could not reach the verification server." }))
      .finally(() => setLoading(false));
  }, []);

  const fmtDate = (d?: string) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }); } catch { return d; }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Header band */}
        <div className="bg-teal-700 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Document Verification</p>
          <p className="text-lg font-bold mt-0.5">{result?.org || "POL263"}</p>
        </div>

        <div className="px-6 py-8">
          {loading ? (
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <Clock className="w-12 h-12 animate-pulse text-teal-600" />
              <p className="text-sm">Verifying document…</p>
            </div>
          ) : result?.valid ? (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3 text-teal-700">
                <CheckCircle className="w-8 h-8 shrink-0" />
                <div>
                  <p className="font-bold text-base">Document Verified</p>
                  <p className="text-xs text-gray-500">This document is authentic and was issued by {result.org || "POL263"}.</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-2.5 text-sm">
                {result.type === "receipt" && (
                  <>
                    <Row icon={<Receipt className="w-4 h-4" />} label="Receipt No." value={result.ref} />
                    <Row label="Amount" value={result.amount && result.currency ? `${result.currency} ${Number(result.amount).toLocaleString("en", { minimumFractionDigits: 2 })}` : undefined} />
                    <Row label="Date" value={fmtDate(result.date)} />
                  </>
                )}
                {result.type === "policy" && (
                  <>
                    <Row icon={<FileText className="w-4 h-4" />} label="Policy No." value={result.policyNumber} />
                    <Row label="Status" value={result.status?.replace(/_/g, " ").toUpperCase()} />
                    <Row label="Start Date" value={fmtDate(result.startDate)} />
                  </>
                )}
                {result.type === "form" && (
                  <p className="text-gray-600 text-sm">{result.message || "This form reference is valid."}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <XCircle className="w-12 h-12 text-red-500" />
              <div>
                <p className="font-bold text-gray-800">Verification Failed</p>
                <p className="text-sm text-gray-500 mt-1">{result?.message || "This document could not be verified. It may have been voided or the link is invalid."}</p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t px-6 py-3 bg-gray-50 text-center">
          <p className="text-xs text-gray-400">Powered by POL263 · Document Integrity System</p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      {icon && <span className="mt-0.5 text-teal-600">{icon}</span>}
      <span className="text-gray-500 min-w-[90px]">{label}</span>
      <span className="font-medium text-gray-800 break-all">{value || "—"}</span>
    </div>
  );
}
