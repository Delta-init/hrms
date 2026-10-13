"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Ban, Check, HandCoins, ListChecks, Loader2, Plus, Receipt, ShieldCheck, Undo2, UserPlus } from "lucide-react";
import {
  useAdvanceEligibility, useMyAdvances, useAdvanceQueue,
  useRequestAdvance, useReviewAdvance, useWithdrawAdvance,
  useEmployeeAdvanceEligibility, useRaiseAdvanceForEmployee,
} from "@/hooks/useSalaryAdvances";
import { EmployeeSelect } from "@/components/pickers";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs } from "@/components/shared/Tabs";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { SALARY_ADVANCE_STATUS_LABELS, type SalaryAdvance, type SalaryAdvanceStatus } from "@/types";

const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—");
const money = (n: number, c: string) => `${c} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const nextMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
};

const STATUS_TONE: Record<SalaryAdvanceStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  hr_approved: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
};

function StatusPill({ r }: { r: SalaryAdvance }) {
  const label = r.status === "rejected" && r.rejectedBy ? `Refused by ${r.rejectedBy === "hr" ? "HR" : "finance"}` : SALARY_ADVANCE_STATUS_LABELS[r.status];
  return (
    <>
      <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[r.status])}>{label}</span>
      {r.raisedBy && (
        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground" title={`Raised by ${nameOf(r.raisedBy) || "HR"}`}>
          Raised by HR
        </span>
      )}
      {r.overLimit && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />Over one month&rsquo;s salary
        </span>
      )}
    </>
  );
}

/** How it will be taken back, once HR has said. */
function recovery(r: SalaryAdvance) {
  if (!r.months || !r.startMonth) return null;
  return `${money(r.amount / r.months, r.currency)} a month × ${r.months} from ${r.startMonth}`;
}

/**
 * Salary advances: asking for part of your salary early, and HR's panel.
 *
 * Asking needs no permission, the same as leave. HR approves and sets how it
 * is recovered; finance then approves the payment in the finance system, and only
 * then is anything taken from a payslip.
 */
export function SalaryAdvances() {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("advances", "approve");
  const [tab, setTab] = useState("mine");
  const tabs = [
    { key: "mine", label: "My Advances", icon: Receipt },
    canApprove && { key: "queue", label: "Panel", icon: ShieldCheck },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "mine";

  return (
    <div>
      <Tabs tabs={tabs} value={activeTab} onChange={setTab} layoutId="advances-tab" />
      {activeTab === "mine" && <MyAdvances />}
      {activeTab === "queue" && canApprove && <Queue />}
    </div>
  );
}

function MyAdvances() {
  const { data: elig, isLoading: eligLoading } = useAdvanceEligibility();
  const { data: mine = [], isLoading } = useMyAdvances();
  const { mutate: request, isPending: requesting } = useRequestAdvance();
  const { mutate: withdraw, isPending: withdrawing } = useWithdrawAdvance();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [withdrawTarget, setWithdrawTarget] = useState<SalaryAdvance | null>(null);

  useEffect(() => { if (open) { setAmount(""); setReason(""); setNeededBy(""); } }, [open]);
  const value = Number(amount);
  const tooMuch = !!elig && value > elig.maxAmount;

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><HandCoins className="h-4 w-4 text-primary" />Salary advance</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {eligLoading
              ? "Checking…"
              : elig?.canRequest
                ? `Ask for up to one month's salary — ${money(elig.maxAmount, elig.currency)}. HR approves and sets how it's taken back, then finance pays it.`
                : elig?.reason}
          </p>
        </div>
        <Button onClick={() => setOpen(true)} disabled={!elig?.canRequest}><Plus className="h-4 w-4" />Request an advance</Button>
      </Card>

      <Card className="p-4">
        <p className="mb-3 text-sm font-semibold">Your requests</p>
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : mine.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">You haven&rsquo;t asked for an advance yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {mine.map((r) => (
              <div key={r._id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill r={r} />
                    <span className="text-sm font-semibold tabular-nums">{money(r.amount, r.currency)}</span>
                  </div>
                  <p className="mt-1 text-sm">{r.reason}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Asked {when(r.createdAt)}{r.neededBy ? ` · needed by ${when(r.neededBy)}` : ""}
                    {recovery(r) ? ` · ${recovery(r)}` : ""}
                  </p>
                  {(r.hrNote || r.financeNote) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{[r.hrNote && `HR: ${r.hrNote}`, r.financeNote && `Finance: ${r.financeNote}`].filter(Boolean).join(" · ")}</p>
                  )}
                </div>
                {r.status === "pending" && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={() => setWithdrawTarget(r)}>
                    <Undo2 className="h-3 w-3" />Withdraw
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Request a salary advance</ResponsiveDialogTitle></ResponsiveDialogHeader>
          <div className="space-y-3 px-4 sm:px-0">
            <div className="space-y-1.5">
              <Label htmlFor="adv-amount">Amount ({elig?.currency ?? "AED"}) *</Label>
              <Input id="adv-amount" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className={cn("text-[11px]", tooMuch ? "text-destructive" : "text-muted-foreground")}>
                Up to {elig ? money(elig.maxAmount, elig.currency) : "one month's salary"}.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adv-reason">What is it for? *</Label>
              <Textarea id="adv-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adv-needed">Needed by</Label>
              <Input id="adv-needed" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </div>
            <p className="text-[11px] text-muted-foreground">HR decides how many months it&rsquo;s taken back over. Nothing is deducted until finance has paid it.</p>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={requesting || !(value > 0) || tooMuch || !reason.trim()}
              onClick={() => request({ amount: value, reason: reason.trim(), neededBy: neededBy || null }, { onSuccess: () => setOpen(false) })}
            >
              {requesting && <Loader2 className="h-4 w-4 animate-spin" />}Send request
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ConfirmDialog
        open={!!withdrawTarget} onOpenChange={(o) => !o && setWithdrawTarget(null)}
        title="Withdraw this request" description="You can always ask again." confirmLabel="Withdraw" isPending={withdrawing}
        onConfirm={() => withdrawTarget && withdraw(withdrawTarget._id, { onSuccess: () => setWithdrawTarget(null) })}
      />
    </div>
  );
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "pending", label: "Waiting on HR" },
  { key: "hr_approved", label: "With finance" },
  { key: "approved", label: "Paid" },
  { key: "rejected", label: "Refused" },
];

function Queue() {
  const [status, setStatus] = useState("pending");
  const { data: requests = [], isLoading } = useAdvanceQueue(status);
  const { mutate: review, isPending: reviewing } = useReviewAdvance();
  const [deciding, setDeciding] = useState<SalaryAdvance | null>(null);
  const [months, setMonths] = useState("1");
  const [startMonth, setStartMonth] = useState(nextMonth());
  const [note, setNote] = useState("");
  const [refusing, setRefusing] = useState<SalaryAdvance | null>(null);

  useEffect(() => { if (deciding) { setMonths("1"); setStartMonth(nextMonth()); setNote(""); } }, [deciding]);
  useEffect(() => { if (refusing) setNote(""); }, [refusing]);
  const m = Math.max(1, Math.min(12, Number(months) || 1));

  const [raising, setRaising] = useState(false);

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Button size="sm" className="order-last ml-auto" onClick={() => setRaising(true)}>
          <UserPlus className="h-4 w-4" />New advance for an employee
        </Button>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setStatus(f.key)}
            className={cn("rounded-full px-3 py-1 text-xs font-medium transition", status === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
            {f.label}
          </button>
        ))}
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : requests.length === 0 ? (
        <Card className="p-16 text-center text-muted-foreground"><ListChecks className="mx-auto mb-2 h-7 w-7" />Nothing here.</Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Card key={r._id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill r={r} />
                    <span className="text-sm font-semibold">{nameOf(r.employee) || nameOf(r.user) || "—"}</span>
                    <span className="text-sm font-semibold tabular-nums">{money(r.amount, r.currency)}</span>
                  </div>
                  <p className="mt-1.5 text-sm">{r.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Asked {when(r.createdAt)}{r.neededBy ? ` · needed by ${when(r.neededBy)}` : ""} · monthly salary {money(r.monthlySalary, r.currency)}
                    {recovery(r) ? ` · ${recovery(r)}` : ""}
                    {r.status === "approved" && r.paidOn ? ` · paid ${when(r.paidOn)}${r.paymentMethod ? ` by ${r.paymentMethod.replace(/_/g, " ")}` : ""}` : ""}
                    {r.financeRef ? ` · finance ref ${r.financeRef}` : ""}
                  </p>
                  {(r.hrNote || r.financeNote) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{[r.hrNote && `HR: ${r.hrNote}`, r.financeNote && `Finance: ${r.financeNote}`].filter(Boolean).join(" · ")}</p>
                  )}
                </div>
                {r.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-emerald-600" disabled={reviewing} onClick={() => setDeciding(r)}>
                      <Check className="h-3.5 w-3.5" />Approve
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" disabled={reviewing} onClick={() => setRefusing(r)}>
                      <Ban className="h-3.5 w-3.5" />Refuse
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ResponsiveDialog open={!!deciding} onOpenChange={(o) => !o && setDeciding(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Approve and set the recovery</ResponsiveDialogTitle></ResponsiveDialogHeader>
          {deciding && (
            <div className="space-y-3 px-4 sm:px-0">
              <p className="text-sm">{nameOf(deciding.employee)} · <strong>{money(deciding.amount, deciding.currency)}</strong></p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="adv-months">Recover over (months)</Label>
                  <Input id="adv-months" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adv-start">Starting from</Label>
                  <Input id="adv-start" type="month" min={thisMonth()} value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
                </div>
              </div>
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                {money(deciding.amount / m, deciding.currency)} a month for {m} month{m === 1 ? "" : "s"}, from {startMonth || "—"}.
                It goes to finance next; nothing is deducted until they have paid it.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="adv-note">Note (optional)</Label>
                <Input id="adv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </div>
            </div>
          )}
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button>
            <Button
              disabled={reviewing || !startMonth}
              onClick={() => deciding && review(
                { id: deciding._id, decision: "approve", months: m, startMonth, note: note.trim() || undefined },
                { onSuccess: () => setDeciding(null) }
              )}
            >
              {reviewing && <Loader2 className="h-4 w-4 animate-spin" />}Approve — send to finance
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <RaiseForEmployeeDialog open={raising} onOpenChange={setRaising} />

      <ResponsiveDialog open={!!refusing} onOpenChange={(o) => !o && setRefusing(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Refuse this advance</ResponsiveDialogTitle></ResponsiveDialogHeader>
          <div className="space-y-1.5 px-4 sm:px-0">
            <Label htmlFor="adv-refuse">Why (sent to them)</Label>
            <Textarea id="adv-refuse" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setRefusing(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={reviewing}
              onClick={() => refusing && review({ id: refusing._id, decision: "reject", note: note.trim() || undefined }, { onSuccess: () => setRefusing(null) })}
            >
              {reviewing && <Loader2 className="h-4 w-4 animate-spin" />}Refuse
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}

/**
 * HR raising an advance for an employee. HR's approval comes with it — the
 * recovery is set here — so it goes straight to finance. Over one month's
 * salary is allowed, but only with a note, and it is marked as such.
 */
function RaiseForEmployeeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [employee, setEmployee] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [months, setMonths] = useState("1");
  const [startMonth, setStartMonth] = useState(nextMonth());
  const [note, setNote] = useState("");
  const { data: elig, isFetching: checking } = useEmployeeAdvanceEligibility(employee || undefined);
  const { mutate: raise, isPending } = useRaiseAdvanceForEmployee();

  useEffect(() => {
    if (!open) return;
    setEmployee(""); setAmount(""); setReason(""); setNeededBy(""); setMonths("1"); setStartMonth(nextMonth()); setNote("");
  }, [open]);

  const value = Number(amount);
  const m = Math.max(1, Math.min(12, Number(months) || 1));
  const blocked = !!elig && (elig.open || elig.owing > 0);
  const overLimit = !!elig && value > elig.maxAmount;
  const ready = !!employee && !blocked && value > 0 && !!reason.trim() && !!startMonth && (!overLimit || !!note.trim());

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader><ResponsiveDialogTitle>New advance for an employee</ResponsiveDialogTitle></ResponsiveDialogHeader>
        <div className="space-y-3 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            <EmployeeSelect value={employee} onChange={setEmployee} placeholder="Choose an employee" />
            {employee && (
              <p className={cn("text-[11px]", blocked ? "text-destructive" : "text-muted-foreground")}>
                {checking || !elig
                  ? "Checking…"
                  : elig.open
                    ? "They already have an advance in progress."
                    : elig.owing > 0
                      ? `They are still repaying an earlier advance (${money(elig.owing, elig.currency)} left).`
                      : elig.maxAmount > 0
                        ? `One month's salary: ${money(elig.maxAmount, elig.currency)}.`
                        : "No salary on record — any amount needs a note."}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="raise-amount">Amount ({elig?.currency ?? "AED"}) *</Label>
              <Input id="raise-amount" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="raise-needed">Needed by</Label>
              <Input id="raise-needed" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="raise-reason">What is it for? *</Label>
            <Textarea id="raise-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="raise-months">Recover over (months)</Label>
              <Input id="raise-months" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="raise-start">Starting from</Label>
              <Input id="raise-start" type="month" min={thisMonth()} value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
            </div>
          </div>
          {value > 0 && (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
              {money(value / m, elig?.currency ?? "AED")} a month for {m} month{m === 1 ? "" : "s"}, from {startMonth || "—"}. It goes straight to
              finance — HR&rsquo;s approval is this — and nothing is deducted until finance has paid it.
            </p>
          )}
          {overLimit && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This is more than one month&rsquo;s salary. Say why in the note — finance will see it marked as over the limit.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="raise-note">Note{overLimit ? " *" : " (optional)"}</Label>
            <Input id="raise-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="Sent to the employee and to finance" />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={isPending || !ready}
            onClick={() => raise(
              { employee, amount: value, reason: reason.trim(), neededBy: neededBy || null, months: m, startMonth, note: note.trim() || undefined },
              { onSuccess: () => onOpenChange(false) }
            )}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Raise — send to finance
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
