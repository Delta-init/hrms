"use client";
import { useEffect, useState } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2, Wand2, Undo2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/pickers";
import { payslipFormSchema, type PayslipFormValues } from "@/lib/validations/payslipSchema";
import { useCreatePayslip, useUpdatePayslip, usePayslipSummary, useDeletePayslip } from "@/hooks/usePayslips";
import { toast } from "@/lib/toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { Payslip, PayslipSummary } from "@/types";

interface Preset {
  employeeId: string;
  month: string;
  currency?: string;
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
}
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payslip?: Payslip | null;
  /** Create a payslip pre-filled from a payroll-run row (employee + month locked). */
  preset?: Preset | null;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Where the month's figures come from, day by day.
 *
 * The one-line strip could not be reconciled by looking at it: "working days
 * 26 · paid days 7.5 · present 2" are three counts against three different
 * denominators, and nothing said how they met. Attendance is now separated
 * from pay, and the arithmetic that turns one into the other is written out
 * rather than left to be inferred.
 */
function DayBreakdown({ summary, money }: { summary: PayslipSummary; money: (n: number) => string }) {
  const salaryDays = summary.salaryDays ?? 0;
  const paidDays = summary.paidDays ?? 0;
  const lop = summary.lopDays ?? 0;
  const penalty = summary.latePenaltyDays ?? 0;
  // The same sum the payslip does, spelled out. Pennies apart from the line
  // below it at worst: both sides round to the fils independently.
  const salaryForMonth = salaryDays ? (summary.salary * paidDays) / 30 : 0;

  const attendance: Array<{ label: string; value: string; note?: string; tone?: string }> = [];
  if (summary.present) attendance.push({ label: "Present", value: String(summary.present) });
  if (summary.late) attendance.push({ label: "Late", value: String(summary.late), tone: "text-amber-600" });
  if (summary.half) attendance.push({ label: "Half day", value: String(summary.half), note: `counts ${summary.half * 0.5} unpaid`, tone: "text-amber-600" });
  if (summary.paidLeaveDays) attendance.push({ label: "On leave", value: String(summary.paidLeaveDays), note: "paid" });
  if (summary.unpaidLeaveDays) attendance.push({ label: "Unpaid leave", value: String(summary.unpaidLeaveDays), tone: "text-red-600" });
  if (summary.holidayDays) attendance.push({ label: "Holiday", value: String(summary.holidayDays), note: "paid" });
  if (summary.absent) attendance.push({ label: "Marked absent", value: String(summary.absent), tone: "text-red-600" });
  if (summary.unrecordedDays)
    attendance.push({
      label: "Not marked",
      value: String(summary.unrecordedDays),
      note: summary.unrecordedFutureDays ? `${summary.unrecordedFutureDays} not yet happened` : undefined,
      tone: summary.unrecordedDaysUnpaid ? "text-red-600" : "text-muted-foreground",
    });

  const Row = ({ label, value, note, tone, strong }: { label: string; value: string; note?: string; tone?: string; strong?: boolean }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn("truncate", strong && "font-medium text-foreground")}>
        {label}
        {note && <span className="ml-1.5 text-[10px] text-muted-foreground">({note})</span>}
      </span>
      <span className={cn("shrink-0 tabular-nums", strong ? "font-semibold text-foreground" : tone ?? "text-foreground")}>{value}</span>
    </div>
  );

  return (
    <div className="mb-3 grid grid-cols-1 gap-x-6 gap-y-3 border-b border-border pb-3 text-xs text-muted-foreground sm:grid-cols-2">
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Attendance</p>
        {attendance.length ? attendance.map((r) => <Row key={r.label} {...r} />) : <p className="text-[11px]">Nothing recorded this month.</p>}
        <div className="mt-1 border-t border-border pt-1">
          <Row label="Working days" value={String(summary.workingDays ?? 0)} strong />
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pay</p>
        <Row label="Days of salary" value={String(salaryDays)} note={salaryDays !== 30 ? "part month" : undefined} />
        {lop > 0 && <Row label="Loss of pay" value={`− ${lop}`} tone="text-red-600" />}
        {penalty > 0 && <Row label="Late penalty" value={`− ${penalty}`} tone="text-amber-600" />}
        {lop === 0 && penalty === 0 && <Row label="Nothing unpaid" value="− 0" tone="text-emerald-600" />}
        <div className="mt-1 border-t border-border pt-1">
          <Row label="Paid days" value={`${paidDays} / ${salaryDays}`} strong />
        </div>
        {/* The sum itself. Somebody checking a payslip should not have to
            reconstruct it from three numbers on a different line. */}
        {salaryDays > 0 && summary.salary > 0 && (
          <p className="mt-1.5 rounded-md bg-muted px-2 py-1 text-[11px] leading-relaxed text-foreground">
            {money(summary.salary)} × {paidDays} ÷ 30 = <span className="font-semibold">{money(salaryForMonth)}</span>
            <span className="block text-[10px] text-muted-foreground">salary for the month, before anything added or recovered</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function PayslipDialog({ open, onOpenChange, payslip, preset }: Props) {
  const isEditing = !!payslip;
  const locked = !!preset;
  const { mutate: create, isPending: creating } = useCreatePayslip();
  const { hasPermission } = useAuth();
  const { mutate: remove, isPending: reverting } = useDeletePayslip();
  const [revertOpen, setRevertOpen] = useState(false);
  const canDelete = hasPermission("payroll", "delete");
  const { mutate: update, isPending: updating } = useUpdatePayslip();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<PayslipFormValues>({
    resolver: zodResolver(payslipFormSchema),
    defaultValues: { employee: "", month: thisMonth(), currency: "AED", earnings: [{ label: "Basic", amount: 0 }], deductions: [], status: "draft" },
  });
  const earnings = useFieldArray({ control, name: "earnings" });
  const deductions = useFieldArray({ control, name: "deductions" });

  const employee = watch("employee");
  const month = watch("month");
  const { data: summary } = usePayslipSummary(!isEditing ? employee : undefined, !isEditing ? month : undefined);

  useEffect(() => {
    if (!open) return;
    if (payslip) {
      reset({
        employee: typeof payslip.employee === "object" ? payslip.employee._id : payslip.employee,
        month: payslip.month, currency: payslip.currency,
        earnings: payslip.earnings.length ? payslip.earnings : [{ label: "Basic", amount: 0 }],
        deductions: payslip.deductions,
        status: payslip.status, notes: payslip.notes ?? "",
      });
    } else if (preset) {
      reset({
        employee: preset.employeeId, month: preset.month, currency: preset.currency ?? "AED",
        earnings: preset.earnings.length ? preset.earnings : [{ label: "Basic", amount: 0 }],
        deductions: preset.deductions, status: "draft", notes: "",
      });
    } else {
      reset({ employee: "", month: thisMonth(), currency: "AED", earnings: [{ label: "Basic", amount: 0 }], deductions: [], status: "draft" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payslip]);

  const watchedEarnings = watch("earnings");
  const watchedDeductions = watch("deductions");
  const currency = watch("currency");
  // Reimbursements, overtime and one-time items are added by the server when
  // the payslip is created. Previewing without them showed a net pay lower than
  // the payslip that followed, so they are folded into the totals here — but
  // kept out of the form arrays, because sending them back would double them.
  const autoEarnings = (!isEditing && summary?.autoEarnings) || [];
  const autoDeductions = (!isEditing && summary?.autoDeductions) || [];
  const autoIn = autoEarnings.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const autoOut = autoDeductions.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  const gross = (watchedEarnings ?? []).reduce((a, l) => a + (Number(l.amount) || 0), 0) + autoIn;
  const totalDed = (watchedDeductions ?? []).reduce((a, l) => a + (Number(l.amount) || 0), 0) + autoOut;
  const net = gross - totalDed;

  const prefill = () => {
    if (!summary) { toast.info("Select an employee & month first"); return; }
    // The breakup's own lines, not one collapsed "Basic": a structure with
    // allowances was flattened into a single figure, and the amount used was
    // the full monthly salary even for somebody who joined halfway through it.
    const lines = summary.earnings?.length ? summary.earnings : summary.salary > 0 ? [{ label: "Basic", amount: summary.salary }] : [];
    if (!lines.length) { toast.info("This employee has no salary to fill from"); return; }
    earnings.replace(lines);
    // Loss of pay and late penalties are no longer appended here — the payslip
    // derives them itself, so adding them would double them.
    toast.success(
      summary.employedShare && summary.employedShare < 1
        ? "Earnings filled, cut to the part of the month they were employed"
        : "Earnings filled from the salary breakup"
    );
  };

  const onSubmit = (data: PayslipFormValues) => {
    const payload = { ...data, notes: data.notes || undefined };
    if (isEditing) update({ id: payslip._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  const money = (n: number) => `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  /** Bare number — the currency is already on the total these sit under. */
  const amount = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // What each total is made of. Zero lines are dropped: a row of 0.00 for every
  // allowance nobody claimed buries the figures that matter.
  const grossLines = [...(watchedEarnings ?? []), ...autoEarnings].filter((l) => Number(l.amount) !== 0);
  const dedLines = [...(watchedDeductions ?? []), ...autoDeductions].filter((l) => Number(l.amount) !== 0);

  /**
   * The components of a total, as a column that adds up.
   *
   * Written inline as "Basic AED 2,000.00 + bonus AED 100.00 + …" first, which
   * repeated the currency on every term, truncated any label longer than a few
   * words and wrapped onto three lines. A column needs none of that: the labels
   * can run their natural length and the figures line up under the total.
   */
  const Parts = ({ lines, tone }: { lines: Array<{ label: string; amount: number }>; tone: string }) => (
    <ul className="mb-1.5 space-y-0.5 pl-3 text-[11px] text-muted-foreground">
      {lines.map((l, i) => (
        <li key={`${l.label}-${i}`} className="flex items-baseline justify-between gap-3">
          <span className="truncate">{l.label}</span>
          <span className={cn("shrink-0 tabular-nums", tone)}>{amount(Number(l.amount) || 0)}</span>
        </li>
      ))}
    </ul>
  );

  /**
   * Lines the payslip derives itself, shown in the column they belong to.
   *
   * They sit with the editable rows because that is where someone looks for
   * them — a reimbursement is an earning and a loan instalment is a deduction,
   * and listing them only in the totals made both columns look empty. They stay
   * read-only: the payslip recomputes all of them on generate, so an edit here
   * would be silently discarded.
   */
  const autoRows = (lines: { label: string; amount: number }[], tone: "earning" | "deduction") =>
    lines.map((l, i) => (
      <div key={`auto-${tone}-${i}`} className="flex items-start justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
        {/* Wraps rather than truncates: the detail in the label — "(31d)", which
            reimbursement — is the part worth reading. */}
        <span className="min-w-0 flex-1 break-words text-sm leading-snug text-muted-foreground">{l.label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn("text-sm font-medium tabular-nums", tone === "earning" ? "text-emerald-600" : "text-red-600")}>
            {tone === "earning" ? "+" : "−"} {money(l.amount)}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">auto</span>
        </span>
      </div>
    ));

  const lineRows = (
    fa: { fields: { id: string }[]; append: (v: { label: string; amount: number }) => void; remove: (i: number) => void },
    name: "earnings" | "deductions",
    addLabel: string,
    auto: { label: string; amount: number }[],
  ) => (
    <div className="space-y-2">
      {fa.fields.map((f, i) => (
        <div key={f.id} className="flex items-center gap-2">
          <Input placeholder="Label" className="flex-1" {...register(`${name}.${i}.label` as const)} />
          <Input type="number" step="0.01" placeholder="0.00" className="w-32" {...register(`${name}.${i}.amount` as const)} />
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => fa.remove(i)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      {autoRows(auto, name === "earnings" ? "earning" : "deduction")}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fa.append({ label: "", amount: 0 })}><Plus className="h-3.5 w-3.5" />{addLabel}</Button>
    </div>
  );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Payslip" : "Generate Payslip"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Employee *</Label>
              <Controller name="employee" control={control} render={({ field }) => (
                <EmployeeSelect
                  value={field.value}
                  onChange={field.onChange}
                  disabled={isEditing || !!locked}
                  placeholder="Select employee"
                />
              )} />
              {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="month">Month *</Label>
              <Input id="month" type="month" disabled={locked} {...register("month")} />
              {errors.month && <p className="text-xs text-destructive">{errors.month.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" className="uppercase" {...register("currency")} />
            </div>
          </div>

          {!isEditing && !locked && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={prefill}>
              <Wand2 className="h-3.5 w-3.5" />Fill earnings from salary
            </Button>
          )}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-emerald-600">Earnings</Label>
              {lineRows(earnings, "earnings", "Add earning", autoEarnings)}
            </div>
            <div className="space-y-2">
              <Label className="text-red-600">Deductions</Label>
              {lineRows(deductions, "deductions", "Add deduction", autoDeductions)}
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            {!isEditing && summary && (
              /* The attendance behind the figures. Loss of pay and late
                 penalties are applied by the payslip itself, so this explains
                 deduction lines the form never shows as editable. */
              <DayBreakdown summary={summary} money={money} />
            )}
            {!isEditing && !!summary?.employedShare && summary.employedShare < 1 && (
              /* A part month is the difference between a right and a very wrong
                 figure, and nothing else on the form says the salary was cut. */
              <div className="mb-2 rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-700 dark:text-sky-400">
                On the payroll for {Math.round(summary.employedShare * 100)}% of this month
                {summary.employment?.from && <> — from {summary.employment.from}</>}
                {summary.employment?.to && <> until {summary.employment.to}</>}.
                Salary is cut to that share; a full month would be {money(summary.salary)}.
              </div>
            )}
            {!isEditing && !!summary?.unrecordedDays && (
              /* A payslip is only as good as its attendance coverage. Without
                 this, one record in a 31-day month reads exactly like a full
                 one — the figures look complete when they are not.
                 Unrecorded days cover the whole month, so a run started early
                 counts days that have not happened. That is worth saying out
                 loud rather than leaving somebody to work out why the figure
                 moved between two runs of the same month. */
              <div className={cn(
                "mb-2 rounded-lg px-2.5 py-1.5 text-xs",
                summary.unrecordedDaysUnpaid
                  ? "bg-red-500/10 text-red-700 dark:text-red-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              )}>
                Attendance recorded for {summary.recordedDays} of {summary.workingDays} working days.
                The other {summary.unrecordedDays} have no attendance, leave or holiday against them
                {!!summary.unrecordedFutureDays && (
                  <> — {summary.unrecordedFutureDays} of which {summary.unrecordedFutureDays === 1 ? "has" : "have"} not happened yet</>
                )}.{" "}
                {summary.unrecordedDaysUnpaid
                  ? `All ${summary.unrecordedDays} are charged as loss of pay. Generate once the month is complete, or the figure will be higher than it should be.`
                  : "They are being paid in full — check the month is complete before generating."}
              </div>
            )}
            <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Gross</span><span className="font-medium text-emerald-600">{money(gross)}</span></div>
            {/* What the total is made of. Everything here is visible above as a
                row or an AUTO chip, but nobody should have to add up two
                columns by eye to see where a figure came from. */}
            {grossLines.length > 0 && <Parts lines={grossLines} tone="text-emerald-600" />}
            <div className="mt-1 flex items-center justify-between text-sm"><span className="text-muted-foreground">Deductions</span><span className="font-medium text-red-600">− {money(totalDed)}</span></div>
            {dedLines.length > 0 && <Parts lines={dedLines} tone="text-red-500" />}
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base font-bold">
              <span>Net Pay</span>
              <span className="text-primary">{money(Math.max(0, net))}</span>
            </div>
            {net < 0 && (
              /* Loans and one-time deductions are recovered only as far as the
                 pay reaches; the rest comes off the next payslip that has room.
                 The server does the same arithmetic, so this only previews it. */
              <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                Deductions exceed earnings by {money(Math.abs(net))}. Take-home is held at zero and the
                shortfall carries to next month — but only loans and one-time deductions can be carried.
                Anything typed in by hand has to fit.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="issued">Issued</SelectItem><SelectItem value="paid">Paid</SelectItem></SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" placeholder="Optional" {...register("notes")} />
            </div>
          </div>

          <ResponsiveDialogFooter>
            {/* There is no "not generated" status to pick — the row reads that
                way when no payslip exists, so going back means deleting it. */}
            {isEditing && canDelete && (
              <Button type="button" variant="ghost" className="mr-auto gap-2 text-destructive hover:text-destructive"
                disabled={reverting} onClick={() => setRevertOpen(true)}>
                {reverting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                Back to not generated
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Generate"}</Button>
          </ResponsiveDialogFooter>
        </form>

        <ConfirmDialog
          open={revertOpen}
          onOpenChange={(o) => { if (!o) setRevertOpen(false); }}
          title="Back to not generated?"
          description={
            "This payslip is deleted and the row goes back to not generated. Anything collected against loans, " +
            "advances and one-time adjustments is handed back, so those balances return to what they were before payroll ran."
          }
          isPending={reverting}
          onConfirm={() => payslip && remove(payslip._id, { onSuccess: () => { setRevertOpen(false); onOpenChange(false); } })}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
