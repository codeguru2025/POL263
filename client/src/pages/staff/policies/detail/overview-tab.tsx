import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { getApiBase } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CardSection } from "@/components/ds";
import { User, ShieldCheck, CalendarDays, Pencil, Phone, Mail, IdCard, MapPin } from "lucide-react";

interface OverviewTabProps {
  displayPolicy: any;
  policyWaiver: any;
  getClientName: (clientId: string) => string;
  onOpenEditClientDialog: (client: any) => void;
}

export function OverviewTab({ displayPolicy, policyWaiver, getClientName, onOpenEditClientDialog }: OverviewTabProps) {
  const { toast } = useToast();

  const { data: policyHolderClient, isLoading: policyHolderLoading } = useQuery<any>({
    queryKey: ["/api/clients", displayPolicy?.clientId, "policy-detail-holder"],
    enabled: !!displayPolicy?.clientId,
    queryFn: async () => {
      const cid = displayPolicy!.clientId as string;
      const res = await fetch(getApiBase() + `/api/clients/${cid}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  return (
    <>
      <CardSection
        title="Policy holder (principal)"
        description="Contact and identity for the main insured person linked to this policy."
        icon={User}
        headerRight={
          policyHolderClient ? (
            <Button size="sm" variant="outline" onClick={() => onOpenEditClientDialog(policyHolderClient)} data-testid="btn-edit-policy-holder">
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit contact details
            </Button>
          ) : undefined
        }
      >
          {!displayPolicy.clientId ? (
            <p className="text-sm text-muted-foreground">No client is linked to this policy.</p>
          ) : policyHolderLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : policyHolderClient ? (
            <>
              <div className="mb-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Full name</p>
                <p className="text-xl font-semibold tracking-tight break-words" data-testid="text-policy-client">
                  {[policyHolderClient.title, policyHolderClient.firstName, policyHolderClient.lastName].filter(Boolean).join(" ")}
                </p>
              </div>
              <Separator className="mb-5" />
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5 text-sm">
                <div className="min-w-0 space-y-1">
                  <p className="text-muted-foreground text-xs flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    Phone
                  </p>
                  {policyHolderClient.phone ? (
                    <a
                      className="font-medium text-primary hover:underline break-all"
                      href={`tel:${String(policyHolderClient.phone).replace(/\s+/g, "")}`}
                      data-testid="text-policy-holder-phone"
                    >
                      {policyHolderClient.phone}
                    </a>
                  ) : (
                    <p className="font-medium text-muted-foreground">Not on file</p>
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-muted-foreground text-xs flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    Email
                  </p>
                  {policyHolderClient.email ? (
                    <a className="font-medium text-primary hover:underline break-all" href={`mailto:${policyHolderClient.email}`}>
                      {policyHolderClient.email}
                    </a>
                  ) : (
                    <p className="font-medium text-muted-foreground">Not on file</p>
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-muted-foreground text-xs flex items-center gap-1.5">
                    <IdCard className="h-3.5 w-3.5 shrink-0" />
                    National ID
                  </p>
                  <p className="font-medium font-mono break-all">{policyHolderClient.nationalId || "—"}</p>
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-muted-foreground text-xs">Date of birth</p>
                  <p className="font-medium">
                    {policyHolderClient.dateOfBirth
                      ? new Date(policyHolderClient.dateOfBirth).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })
                      : "—"}
                  </p>
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-muted-foreground text-xs">Gender</p>
                  <p className="font-medium capitalize">{policyHolderClient.gender || "—"}</p>
                </div>
                {policyHolderClient.maritalStatus ? (
                  <div className="min-w-0 space-y-1">
                    <p className="text-muted-foreground text-xs">Marital status</p>
                    <p className="font-medium capitalize">{policyHolderClient.maritalStatus}</p>
                  </div>
                ) : null}
                {policyHolderClient.address ? (
                  <div className="min-w-0 space-y-1 sm:col-span-2 lg:col-span-3">
                    <p className="text-muted-foreground text-xs flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      Address
                    </p>
                    <p className="font-medium whitespace-pre-wrap break-words">{policyHolderClient.address}</p>
                  </div>
                ) : null}
                {policyHolderClient.location ? (
                  <div className="min-w-0 space-y-1">
                    <p className="text-muted-foreground text-xs">Location / area</p>
                    <p className="font-medium break-words">{policyHolderClient.location}</p>
                  </div>
                ) : null}
                {policyHolderClient.preferredCommMethod ? (
                  <div className="min-w-0 space-y-1">
                    <p className="text-muted-foreground text-xs">Preferred contact</p>
                    <p className="font-medium capitalize">{policyHolderClient.preferredCommMethod}</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Could not load full client details (check access to this client).</p>
              <p className="font-medium" data-testid="text-policy-client">{getClientName(displayPolicy.clientId)}</p>
            </div>
          )}
      </CardSection>

      <CardSection title="Cover & product" description="Plan version, claims gate, and client portal activation when applicable." icon={ShieldCheck}>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Product</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Plan</p>
                <p className="font-semibold">{displayPolicy.productName || "—"}</p>
                {displayPolicy.productVersionLabel && <p className="text-xs text-muted-foreground mt-0.5">{displayPolicy.productVersionLabel}</p>}
              </div>
            </div>
          </div>

          <Separator className="my-6" />

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Claims</h3>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-6">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Eligibility</p>
                <Badge variant="outline" className={displayPolicy.claimable ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : "bg-amber-500/15 text-amber-700 border-amber-200"}>
                  {displayPolicy.claimable ? "Claimable" : "Not claimable"}
                </Badge>
              </div>
              {displayPolicy.claimableReason ? (
                <p className="text-sm text-muted-foreground flex-1 leading-relaxed">{displayPolicy.claimableReason}</p>
              ) : null}
            </div>
          </div>

          {displayPolicy.clientActivationCode ? (
            <>
              <Separator className="my-6" />
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Client portal</h3>
                <p className="text-muted-foreground text-xs mb-2">Activation code (client has not claimed their portal account yet)</p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono font-bold text-primary text-lg tabular-nums" data-testid="text-activation-code">{displayPolicy.clientActivationCode}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      navigator.clipboard.writeText(displayPolicy.clientActivationCode);
                      toast({ title: "Copied", description: "Activation code copied to clipboard." });
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </>
          ) : null}
      </CardSection>

      <CardSection title="Dates & lifecycle" description="Capture, effective dates, waiting and grace windows." icon={CalendarDays}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Capture date</p>
                <p className="font-semibold tabular-nums">{displayPolicy.createdAt ? new Date(displayPolicy.createdAt).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" }) : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Effective date</p>
                <p className="font-semibold tabular-nums" data-testid="text-effective-date">{displayPolicy.effectiveDate || "Not set"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Inception date</p>
                <p className="font-semibold tabular-nums">{displayPolicy.inceptionDate || "Not set"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Waiting period</p>
                {displayPolicy.waitingPeriodEndDate ? (() => {
                  const endDate = new Date(displayPolicy.waitingPeriodEndDate);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  endDate.setHours(0, 0, 0, 0);
                  const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  const waived = policyWaiver?.status === "approved";
                  return daysRemaining > 0 ? (
                    <p className="font-semibold text-amber-600">{daysRemaining} days left</p>
                  ) : waived ? (
                    <p className="font-semibold text-emerald-600 flex items-center gap-1">Waived <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-700">WAIVER</span></p>
                  ) : (
                    <p className="font-semibold text-emerald-600">Completed</p>
                  );
                })() : (
                  <p className="font-semibold">{displayPolicy.waitingPeriodDays != null ? `${displayPolicy.waitingPeriodDays} days (product rule)` : "—"}</p>
                )}
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Waiting period ends</p>
                <p className="font-semibold tabular-nums">{displayPolicy.waitingPeriodEndDate ? new Date(displayPolicy.waitingPeriodEndDate).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" }) : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Grace period</p>
                {displayPolicy.graceEndDate ? (() => {
                  const endDate = new Date(displayPolicy.graceEndDate);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  endDate.setHours(0, 0, 0, 0);
                  const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  return daysRemaining > 0 ? (
                    <p className="font-semibold text-amber-600">{daysRemaining} days left</p>
                  ) : (
                    <p className="font-semibold text-emerald-600">Completed</p>
                  );
                })() : (
                  <p className="font-semibold">—</p>
                )}
              </div>
            </div>
      </CardSection>
    </>
  );
}
