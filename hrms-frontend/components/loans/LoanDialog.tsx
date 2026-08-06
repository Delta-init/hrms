"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/pickers";
import { loanFormSchema, type LoanFormValues } from "@/lib/validations/loanSchema";
import { useCreateLoan, useUpdateLoan } from "@/hooks/useLoans";
import { LOAN_STATUS_LABELS, type Loan, type LoanStatus } from "@/types";

interface LockedEmployee { _id: string; name: string; employeeCode?: string }
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loan?: Loan | null;
  /** Preselect + lock the employee (used from the profile tab). */
  employee?: LockedEmployee | null;
}

const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");
const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const todayStr = () => new Date().toISOString().slice(0, 10);

export function LoanDialog({ open, onOpenChange, loan, employee: locked }: Props) {
  const isEditing = !!loan;
  const { mutate: create, isPending: creating } = useCreateLoan();
  const { mutate: update, isPending: updating } = useUpdateLoan();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<LoanFormValues>({
    resolver: zodResolver(loanFormSchema),
    defaultValues: { employee: locked?._id ?? "", amount: 0, purpose: "", disbursedDate: todayStr(), installments: 1, monthlyDeduction: 0, notes: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (loan) {
      reset({
        employee: idOf(loan.employee), amount: loan.amount, purpose: loan.purpose ?? "",
        disbursedDate: toDateInput(loan.disbursedDate), installments: loan.installments,
        monthlyDeduction: loan.monthlyDeduction, amountRepaid: loan.amountRepaid, status: loan.status, notes: loan.notes ?? "",
      });
    } else {
      reset({ employee: locked?._id ?? "", amount: 0, purpose: "", disbursedDate: todayStr(), installments: 1, monthlyDeduction: 0, notes: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loan, locked?._id]);

  // Suggest a monthly deduction from amount / installments (create only, before edited).
  const amount = watch("amount");
  const installments = watch("installments");
  useEffect(() => {
    if (isEditing) return;
    const a = Number(amount) || 0;
    const n = Math.max(1, Number(installments) || 1);
    setValue("monthlyDeduction", Math.round((a / n) * 100) / 100);
  }, [amount, installments, isEditing, setValue]);

  const onSubmit = (data: LoanFormValues) => {
    const payload = { ...data, purpose: data.purpose || undefined, disbursedDate: data.disbursedDate || null, notes: data.notes || undefined };
    if (isEditing) update({ id: loan._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Loan" : "New Loan"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            {locked || isEditing ? (
              <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                {locked?.name ?? (typeof loan?.employee === "object" ? loan?.employee?.name : "—")}
                {locked?.employeeCode ? ` (${locked.employeeCode})` : ""}
              </div>
            ) : (
              <Controller name="employee" control={control} render={({ field }) => (
                <EmployeeSelect value={field.value} onChange={field.onChange} />
              )} />
            )}
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Loan amount *</Label>
              <Input id="amount" type="number" min="0" step="0.01" {...register("amount")} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disbursedDate">Disbursed on</Label>
              <Input id="disbursedDate" type="date" {...register("disbursedDate")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="installments">Instalments (months) *</Label>
              <Input id="installments" type="number" min="1" {...register("installments")} />
              {errors.installments && <p className="text-xs text-destructive">{errors.installments.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monthlyDeduction">Monthly deduction *</Label>
              <Input id="monthlyDeduction" type="number" min="0" step="0.01" {...register("monthlyDeduction")} />
              <p className="text-[11px] text-muted-foreground">Deducted from each month&apos;s salary.</p>
              {errors.monthlyDeduction && <p className="text-xs text-destructive">{errors.monthlyDeduction.message}</p>}
            </div>
          </div>

          {isEditing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="amountRepaid">Amount repaid</Label>
                <Input id="amountRepaid" type="number" min="0" step="0.01" {...register("amountRepaid")} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Controller name="status" control={control} render={({ field }) => (
                  <Select value={field.value ?? "active"} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(LOAN_STATUS_LABELS) as LoanStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{LOAN_STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="purpose">Purpose</Label>
            <Input id="purpose" placeholder="e.g. Salary advance" {...register("purpose")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Create"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
