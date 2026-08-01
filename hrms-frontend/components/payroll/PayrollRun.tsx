"use client";
import { useState } from "react";
import { Loader2, Play, CalendarDays, Plus, Pencil } from "lucide-react";
import { usePayrollRun, useGeneratePayroll, usePayslip } from "@/hooks/usePayslips";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PayslipDialog } from "@/components/payroll/PayslipDialog";
import { PayrollChecklistDialog } from "@/components/payroll/PayrollChecklistDialog";
import { getInitials, cn } from "@/lib/utils";
import { PAYSLIP_STATUS_LABELS, type PayrollRunRow, type PayslipStatus } from "@/types";

const statusStyles: Record<PayslipStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  issued: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};
const curMonth = () => new Date().toISOString().slice(0, 7);
const money = (n: number, c: string) => `${c} ${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PayrollRun() {
  const { hasPermission } = useAuth();
  const canGenerate = hasPermission("payroll", "create");
  const canEdit = hasPermission("payroll", "edit");
  const [month, setMonth] = useState(curMonth());
  const { data, isLoading, isFetching } = usePayrollRun(month);
  const { mutate: generate, isPending: generating } = useGeneratePayroll();

  const [checklistOpen, setChecklistOpen] = useState(false);
  const [createRow, setCreateRow] = useState<PayrollRunRow | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const { data: editPayslip } = usePayslip(editId ?? undefined);

  const rows = data?.rows ?? [];
  const pending = rows.filter((r) => r.status === null).length;
  const totalNet = rows.reduce((a, r) => a + r.netPay, 0);
  const currency = rows[0]?.currency ?? "AED";

  const preset = createRow
    ? {
        employeeId: createRow.employee._id,
        month,
        currency: createRow.currency,
        earnings: createRow.earnings?.length ? createRow.earnings : [{ label: "Basic", amount: createRow.salary }],
        deductions: [
          ...(createRow.structureDeductions ?? []),
          ...(createRow.lopAmount > 0 ? [{ label: `Loss of Pay (${createRow.lopDays}d)`, amount: createRow.lopAmount }] : []),
          ...(createRow.latePenaltyAmount > 0 ? [{ label: `Late Penalty (${createRow.latePenaltyDays}d)`, amount: createRow.latePenaltyAmount }] : []),
          ...(createRow.loanTotal > 0 ? [{ label: "Loan repayment", amount: createRow.loanTotal }] : []),
        ],
      }
    : null;
  const closeDialog = () => { setCreateRow(null); setEditId(null); };

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Payroll month</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-[170px]" />
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Employees</p>
            <p className="font-semibold">{rows.length} · <span className="text-amber-600">{pending} pending</span></p>
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total net pay</p>
            <p className="font-semibold tabular-nums text-primary">{money(totalNet, currency)}</p>
          </div>
        </div>
        {canGenerate && (
          <Button onClick={() => setChecklistOpen(true)} disabled={pending === 0} className="shadow-sm">
            <Play className="h-4 w-4" />Process Payroll ({pending})
          </Button>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 text-right font-medium">Base salary</th>
                <th className="px-4 py-3 text-right font-medium">LOP</th>
                <th className="px-4 py-3 text-right font-medium">Loan</th>
                <th className="px-4 py-3 text-right font-medium">Add-ons</th>
                <th className="px-4 py-3 text-right font-medium">Deductions</th>
                <th className="px-4 py-3 text-right font-medium">Net pay</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading || isFetching ? (
                <tr><td colSpan={9} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="py-16 text-center text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-7 w-7" />No active employees for this month.</td></tr>
              ) : rows.map((r) => (
                <Row
                  key={r.employee._id}
                  r={r}
                  canEdit={canEdit}
                  canGenerate={canGenerate}
                  onAdd={() => setCreateRow(r)}
                  onEdit={() => r.payslipId && setEditId(r.payslipId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <PayslipDialog
        open={!!createRow || (!!editId && !!editPayslip)}
        onOpenChange={(o) => { if (!o) closeDialog(); }}
        payslip={editId ? editPayslip : null}
        preset={preset}
      />

      <PayrollChecklistDialog
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
        pendingCount={pending}
        processing={generating}
        onProcess={() => generate(month, { onSuccess: () => setChecklistOpen(false) })}
      />
    </div>
  );
}

function Row({ r, canEdit, canGenerate, onAdd, onEdit }: { r: PayrollRunRow; canEdit: boolean; canGenerate: boolean; onAdd: () => void; onEdit: () => void }) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(r.employee.name)}</div>
          <div className="min-w-0"><p className="truncate font-medium">{r.employee.name}</p><p className="truncate text-xs text-muted-foreground">{r.employee.employeeCode}</p></div>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {money(r.salary, r.currency)}
        {r.structureName && <p className="text-[11px] font-normal text-muted-foreground" title="Salary structure in force">{r.structureName}</p>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">
        {r.lopAmount > 0 && <div>-{money(r.lopAmount, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">({r.lopDays}d LOP)</span></div>}
        {r.latePenaltyAmount > 0 && <div title="Late-arrival penalty">-{money(r.latePenaltyAmount, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">({r.latePenaltyDays}d late)</span></div>}
        {r.lopAmount === 0 && r.latePenaltyAmount === 0 && <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">{r.loanTotal > 0 ? `-${money(r.loanTotal, r.currency)}` : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {r.oneTimePayments > 0 && <span className="text-emerald-600">+{money(r.oneTimePayments, r.currency)}</span>}
        {r.oneTimePayments > 0 && r.oneTimeDeductions > 0 && <span className="text-muted-foreground"> / </span>}
        {r.oneTimeDeductions > 0 && <span className="text-red-500">-{money(r.oneTimeDeductions, r.currency)}</span>}
        {r.reimbursements > 0 && <div className="text-emerald-600" title="Approved reimbursements">+{money(r.reimbursements, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">reimb</span></div>}
        {r.overtime > 0 && <div className="text-emerald-600" title="Overtime">+{money(r.overtime, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">OT</span></div>}
        {r.oneTimePayments === 0 && r.oneTimeDeductions === 0 && r.reimbursements === 0 && r.overtime === 0 && <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">{r.totalDeductions > 0 ? `-${money(r.totalDeductions, r.currency)}` : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-primary">{money(r.netPay, r.currency)}</td>
      <td className="px-4 py-3">
        {r.status ? (
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[r.status])}>{PAYSLIP_STATUS_LABELS[r.status]}</span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600">Not generated</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {r.status ? (
          canEdit && <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />Edit</Button>
        ) : (
          canGenerate && <Button variant="outline" size="sm" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add</Button>
        )}
      </td>
    </tr>
  );
}
