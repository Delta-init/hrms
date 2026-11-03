"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Loader2, CalendarPlus, Sparkles, Wallet, Check, X, Hourglass, Send } from "lucide-react";
import {
  useMyCompOffBalance, useMyCompOffCredits, useCompOffCredits, useCompOffSuggestions, useRevokeCompOff,
  useApproveCompOff, useApproveManyCompOff, useRejectCompOff,
} from "@/hooks/useCompOff";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GrantCompOffDialog } from "@/components/leave/GrantCompOffDialog";
import { RequestCompOffDialog } from "@/components/leave/RequestCompOffDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { getInitials, cn } from "@/lib/utils";
import type { CompOffCredit, CompOffSuggestion } from "@/types";

interface Props {
  /** Whether the caller can manage credits (leave.approve). */
  canManage: boolean;
}

/**
 * The day worked. A credit's date is midnight where the person works — 18:30Z
 * the evening before for India, 20:00Z for Dubai — or plain UTC midnight when
 * HR typed it, so reading it in the browser's zone put India's Sundays on
 * Saturday. Rounding to the nearest UTC midnight lands every form on its day.
 */
const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const day = new Date(Math.round(new Date(iso).getTime() / 86_400_000) * 86_400_000);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(day);
};
const empOf = (c: CompOffCredit) => (c.employee && typeof c.employee === "object" ? c.employee : null);

const STATUS: Record<CompOffCredit["status"], { label: string; className: string }> = {
  pending: { label: "Waiting for HR", className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  available: { label: "Approved", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  rejected: { label: "Rejected", className: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" },
  revoked: { label: "Revoked", className: "border-border bg-muted text-muted-foreground" },
};

function StatusBadge({ status }: { status: CompOffCredit["status"] }) {
  const s = STATUS[status] ?? STATUS.revoked;
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", s.className)}>{s.label}</span>;
}

const sourceLabel = (c: CompOffCredit) =>
  c.source === "employee" ? "Asked by employee" : c.source === "hr" ? "Added by HR" : c.source === "attendance" || !c.createdBy ? "From attendance" : "Added by HR";

/**
 * HR's yes or no on one request. A yes can change the amount — attendance
 * guesses half or full from hours worked, and HR may know better; a no needs
 * a reason, which the person is shown.
 */
function ReviewCompOffDialog({ target, onClose }: { target: { credit: CompOffCredit; action: "approve" | "reject" } | null; onClose: () => void }) {
  const { mutate: approve, isPending: approving } = useApproveCompOff();
  const { mutate: reject, isPending: rejecting } = useRejectCompOff();
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  // Kept through the closing animation, so the text does not blank as it fades.
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (target) { setShown(target); setAmount(String(target.credit.amount)); setNote(""); }
  }, [target]);

  const isApprove = shown?.action === "approve";
  const days = Number(amount);
  const validAmount = days >= 0.5 && days <= 5 && Number.isInteger(days * 2);
  const ready = !!target && (isApprove ? validAmount : note.trim().length >= 3);
  const busy = approving || rejecting;

  const submit = () => {
    if (!target || !ready) return;
    if (isApprove) approve({ id: target.credit._id, amount: days, note: note.trim() || undefined }, { onSuccess: onClose });
    else reject({ id: target.credit._id, note: note.trim() }, { onSuccess: onClose });
  };

  const e = shown ? empOf(shown.credit) : null;
  return (
    <ResponsiveDialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isApprove ? "Approve comp-off" : "Reject comp-off"}</ResponsiveDialogTitle>
          {shown && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{e?.name ?? "—"} · worked {fmtDate(shown.credit.date)}</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>
        {shown && (
          <div className="space-y-4 px-4 sm:px-0">
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {shown.credit.reason || "No reason given"} · <span className="font-medium text-foreground">{shown.credit.amount} day{shown.credit.amount === 1 ? "" : "s"}</span> asked
            </p>
            {isApprove && (
              <div className="space-y-1.5">
                <Label htmlFor="co-amount">Days to credit</Label>
                <Input id="co-amount" type="number" min={0.5} max={5} step={0.5} value={amount} onChange={(ev) => setAmount(ev.target.value)} className="w-24 tabular-nums" />
                {!validAmount && <p className="text-xs text-destructive">Whole or half days, from 0.5 to 5.</p>}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="co-note">{isApprove ? "Note (optional)" : "Reason"}</Label>
              <Textarea id="co-note" rows={2} maxLength={300} value={note} onChange={(ev) => setNote(ev.target.value)}
                placeholder={isApprove ? "" : "Shown to the employee — e.g. not asked to work that day"} />
            </div>
          </div>
        )}
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={isApprove ? "default" : "destructive"} onClick={submit} disabled={!ready || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{isApprove ? "Approve" : "Reject"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function CompOffLedger({ canManage }: Props) {
  const { data: myBalance, isLoading: balanceLoading } = useMyCompOffBalance();
  const { data: myCredits, isLoading: myCreditsLoading } = useMyCompOffCredits();
  const { data: credits, isLoading: creditsLoading } = useCompOffCredits(canManage);
  const { data: suggestions, isLoading: suggestionsLoading } = useCompOffSuggestions(canManage);
  const { mutate: revoke, isPending: revoking } = useRevokeCompOff();
  const { mutate: approveMany, isPending: approvingMany } = useApproveManyCompOff();

  const [grantOpen, setGrantOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [prefill, setPrefill] = useState<CompOffSuggestion | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CompOffCredit | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ credit: CompOffCredit; action: "approve" | "reject" } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmMany, setConfirmMany] = useState(false);
  // What the confirmation was opened for — kept as it fades out, after the
  // selection itself has been cleared.
  const [confirmIds, setConfirmIds] = useState<string[]>([]);

  const openGrant = (s?: CompOffSuggestion) => { setPrefill(s ?? null); setGrantOpen(true); };

  const myPending = (myCredits ?? []).filter((c) => c.status === "pending").reduce((a, c) => a + c.amount, 0);
  // Oldest first — the order they were earned in, and the order to work through them.
  const waiting = useMemo(
    () => (credits ?? []).filter((c) => c.status === "pending").sort((a, b) => a.date.localeCompare(b.date)),
    [credits]
  );
  const decided = useMemo(() => (credits ?? []).filter((c) => c.status !== "pending"), [credits]);
  // Only what is still waiting stays picked — an approved row leaves the list.
  const pickedIds = waiting.filter((c) => picked.has(c._id)).map((c) => c._id);
  const allPicked = waiting.length > 0 && pickedIds.length === waiting.length;
  const togglePick = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const confirmDays = waiting.filter((c) => confirmIds.includes(c._id)).reduce((a, c) => a + c.amount, 0);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">My Comp-Off Balance</h3></div>
          <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}><Send className="h-3.5 w-3.5" />Request comp-off</Button>
        </div>
        {balanceLoading ? (
          <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="max-w-xs rounded-xl border border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", (myBalance?.balance ?? 0) < 0 ? "text-red-500" : "text-primary")}>
              {myBalance?.balance ?? 0}<span className="ml-1 text-sm font-normal text-muted-foreground">days</span>
            </p>
            {myPending > 0 && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <Hourglass className="h-3 w-3" />{myPending} day{myPending === 1 ? "" : "s"} waiting for HR
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Earned by working a weekend or holiday, once HR approves it. Apply for leave with type &quot;Comp-Off&quot; to redeem.</p>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">My Comp-Off History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Date worked</th>
                <th className="px-4 py-3 font-medium">Days</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {myCreditsLoading ? (
                <tr><td colSpan={4} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
              ) : !myCredits?.length ? (
                <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">No comp-off credits yet.</td></tr>
              ) : myCredits.map((c) => (
                <tr key={c._id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(c.date)}</td>
                  <td className="px-4 py-3 tabular-nums">{c.amount}</td>
                  <td className="px-4 py-3 max-w-[260px] text-xs text-muted-foreground">
                    <p className="truncate">{c.reason || "—"}</p>
                    {c.status === "rejected" && c.reviewNote && <p className="truncate text-red-600 dark:text-red-400">HR: {c.reviewNote}</p>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {canManage && (
        <>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Hourglass className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Waiting for approval</h3>
                {waiting.length > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">{waiting.length}</span>}
              </div>
              <Button size="sm" disabled={!pickedIds.length || approvingMany} onClick={() => { setConfirmIds(pickedIds); setConfirmMany(true); }}>
                {approvingMany ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve selected{pickedIds.length ? ` (${pickedIds.length})` : ""}
              </Button>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="w-10 px-4 py-3">
                      <Checkbox aria-label="Select all" checked={allPicked} disabled={!waiting.length}
                        onCheckedChange={(v) => setPicked(v ? new Set(waiting.map((c) => c._id)) : new Set())} />
                    </th>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Date worked</th>
                    <th className="px-4 py-3 font-medium">Days</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {creditsLoading ? (
                    <tr><td colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
                  ) : !waiting.length ? (
                    <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">Nothing waiting — every request has been decided.</td></tr>
                  ) : waiting.map((c) => {
                    const e = empOf(c);
                    return (
                      <tr key={c._id} className={cn("border-b border-border/60 last:border-0 hover:bg-muted/30", picked.has(c._id) && "bg-primary/5")}>
                        <td className="px-4 py-3"><Checkbox aria-label={`Select ${e?.name ?? "request"}`} checked={picked.has(c._id)} onCheckedChange={() => togglePick(c._id)} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(e?.name ?? "?")}</div>
                            <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(c.date)}</td>
                        <td className="px-4 py-3 tabular-nums">{c.amount}</td>
                        <td className="px-4 py-3 max-w-[240px] text-xs">
                          <p className="truncate text-muted-foreground">{c.reason || "—"}</p>
                          <p className="text-[11px] text-muted-foreground/80">{sourceLabel(c)}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="h-8 text-destructive" onClick={() => setReviewTarget({ credit: c, action: "reject" })}><X className="h-3.5 w-3.5" />Reject</Button>
                            <Button size="sm" className="h-8" onClick={() => setReviewTarget({ credit: c, action: "approve" })}><Check className="h-3.5 w-3.5" />Approve</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

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
                  ) : !decided.length ? (
                    <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No comp-off credits yet.</td></tr>
                  ) : decided.map((c) => {
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
                        <td className="px-4 py-3 max-w-[220px] text-xs text-muted-foreground">
                          <p className="truncate">{c.reason || "—"}</p>
                          {c.reviewNote && <p className={cn("truncate", c.status === "rejected" && "text-red-600 dark:text-red-400")}>HR: {c.reviewNote}</p>}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
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
      <RequestCompOffDialog open={requestOpen} onOpenChange={setRequestOpen} />
      <ReviewCompOffDialog target={reviewTarget} onClose={() => setReviewTarget(null)} />
      <ResponsiveDialog open={confirmMany} onOpenChange={setConfirmMany}>
        <ResponsiveDialogContent desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Approve {confirmIds.length} comp-off request{confirmIds.length === 1 ? "" : "s"}?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
              {confirmDays} day{confirmDays === 1 ? "" : "s"} in all, each as asked. The days reach each person&apos;s balance straight away and they are told.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setConfirmMany(false)} disabled={approvingMany}>Cancel</Button>
            <Button disabled={approvingMany || !confirmIds.length}
              onClick={() => approveMany(confirmIds, { onSuccess: () => { setConfirmMany(false); setPicked(new Set()); } })}>
              {approvingMany && <Loader2 className="h-4 w-4 animate-spin" />}Approve
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ConfirmDialog
        open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}
        title="Revoke comp-off credit" description="This credit will no longer count toward the employee's comp-off balance." isPending={revoking}
        onConfirm={() => revokeTarget && revoke(revokeTarget._id, { onSuccess: () => setRevokeTarget(null) })}
      />
    </div>
  );
}
