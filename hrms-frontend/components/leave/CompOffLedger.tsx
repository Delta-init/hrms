"use client";
import { useState } from "react";
import { Plus, Trash2, Loader2, CalendarPlus, Sparkles, Wallet } from "lucide-react";
import {
  useMyCompOffBalance, useCompOffCredits, useCompOffSuggestions, useRevokeCompOff,
} from "@/hooks/useCompOff";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GrantCompOffDialog } from "@/components/leave/GrantCompOffDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { getInitials, cn } from "@/lib/utils";
import type { CompOffCredit, CompOffSuggestion } from "@/types";

interface Props {
  /** Whether the caller can manage credits (leave.approve). */
  canManage: boolean;
}

const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");
const empOf = (c: CompOffCredit) => (c.employee && typeof c.employee === "object" ? c.employee : null);

export function CompOffLedger({ canManage }: Props) {
  const { data: myBalance, isLoading: balanceLoading } = useMyCompOffBalance();
  const { data: credits, isLoading: creditsLoading } = useCompOffCredits(canManage);
  const { data: suggestions, isLoading: suggestionsLoading } = useCompOffSuggestions(canManage);
  const { mutate: revoke, isPending: revoking } = useRevokeCompOff();

  const [grantOpen, setGrantOpen] = useState(false);
  const [prefill, setPrefill] = useState<CompOffSuggestion | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CompOffCredit | null>(null);

  const openGrant = (s?: CompOffSuggestion) => { setPrefill(s ?? null); setGrantOpen(true); };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">My Comp-Off Balance</h3></div>
        {balanceLoading ? (
          <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="max-w-xs rounded-xl border border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", (myBalance?.balance ?? 0) < 0 ? "text-red-500" : "text-primary")}>
              {myBalance?.balance ?? 0}<span className="ml-1 text-sm font-normal text-muted-foreground">days</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Earned by working a weekend or holiday. Apply for leave with type &quot;Comp-Off&quot; to redeem.</p>
          </div>
        )}
      </Card>

      {canManage && (
        <>
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Suggested credits</h3></div>
              <span className="text-xs text-muted-foreground">Attendance in the last 60 days on a weekend/holiday, not yet credited</span>
            </div>
            {suggestionsLoading ? (
              <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : !suggestions?.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No un-credited off-day attendance found.</p>
            ) : (
              <div className="space-y-2">
                {suggestions.map((s, i) => (
                  <div key={`${s.user}-${s.date}-${i}`} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(s.employee.name)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.employee.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{fmtDate(s.date)} · {s.reason === "holiday" ? "Holiday" : "Weekend"} · {Math.round(s.workedMinutes / 60)}h worked</p>
                    </div>
                    <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => openGrant(s)}><CalendarPlus className="h-3.5 w-3.5" />Grant</Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Comp-Off Credits</h3>
              <Button size="sm" onClick={() => openGrant()}><Plus className="h-4 w-4" />Credit Comp-Off</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Date worked</th>
                    <th className="px-4 py-3 font-medium">Days</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {creditsLoading ? (
                    <tr><td colSpan={6} className="py-12 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
                  ) : !credits?.length ? (
                    <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No comp-off credits yet.</td></tr>
                  ) : credits.map((c) => {
                    const e = empOf(c);
                    return (
                      <tr key={c._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(e?.name ?? "?")}</div>
                            <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(c.date)}</td>
                        <td className="px-4 py-3 tabular-nums">{c.amount}</td>
                        <td className="px-4 py-3 max-w-[220px] truncate text-xs text-muted-foreground">{c.reason || "—"}</td>
                        <td className="px-4 py-3">
                          <Badge variant={c.status === "available" ? "secondary" : "outline"} className="capitalize">{c.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {c.status === "available" && (
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setRevokeTarget(c)}><Trash2 className="h-4 w-4" /></Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <GrantCompOffDialog open={grantOpen} onOpenChange={setGrantOpen} prefill={prefill} />
      <ConfirmDialog
        open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}
        title="Revoke comp-off credit" description="This credit will no longer count toward the employee's comp-off balance." isPending={revoking}
        onConfirm={() => revokeTarget && revoke(revokeTarget._id, { onSuccess: () => setRevokeTarget(null) })}
      />
    </div>
  );
}
