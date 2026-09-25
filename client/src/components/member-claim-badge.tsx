import { Badge } from "@/components/ui/badge";

/** policy_members.claim_status — the claim verdict recorded against a covered life
 *  (written by server/claim-workflow.ts). */
const MEMBER_CLAIM_LABEL: Record<string, { label: string; className: string }> = {
  claim_pending: { label: "Claim pending", className: "bg-sky-500/10 text-sky-800 border-sky-200" },
  under_investigation: { label: "Under investigation", className: "bg-violet-500/10 text-violet-800 border-violet-200" },
  claimed: { label: "Claimed — approved", className: "bg-emerald-500/10 text-emerald-800 border-emerald-200" },
  claim_declined: { label: "Claim declined", className: "bg-rose-500/10 text-rose-800 border-rose-200" },
};

export function MemberClaimBadge({ status }: { status: string | null | undefined }) {
  if (!status || !MEMBER_CLAIM_LABEL[status]) return null;
  const s = MEMBER_CLAIM_LABEL[status];
  return <Badge variant="outline" className={`text-[10px] ${s.className}`}>{s.label}</Badge>;
}
