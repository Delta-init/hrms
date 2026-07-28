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
import { reimbursementFormSchema, type ReimbursementFormValues } from "@/lib/validations/reimbursementSchema";
import { useCreateReimbursement, useUpdateReimbursement } from "@/hooks/useReimbursements";
import { useEmployees } from "@/hooks/useEmployees";
import { REIMBURSEMENT_CATEGORY_LABELS, type Reimbursement, type ReimbursementCategory } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim?: Reimbursement | null;
  /** Admins filing for others get an employee picker; self-service doesn't. */
  canFileForOthers?: boolean;
  defaultMonth?: string;
}

const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");
const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

export function ReimbursementDialog({ open, onOpenChange, claim, canFileForOthers, defaultMonth }: Props) {
  const isEditing = !!claim;
  const { data: empData } = useEmployees({ limit: "200" }, { enabled: !!canFileForOthers && !isEditing });
  const employees = (empData?.data ?? []).filter((e) => e.status !== "terminated");
  const { mutate: create, isPending: creating } = useCreateReimbursement();
  const { mutate: update, isPending: updating } = useUpdateReimbursement();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<ReimbursementFormValues>({
    resolver: zodResolver(reimbursementFormSchema),
    defaultValues: { employee: "", category: "travel", title: "", amount: 0, expenseDate: today(), month: defaultMonth || thisMonth(), description: "", receiptUrl: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (claim) {
      reset({
        employee: idOf(claim.employee), category: claim.category, title: claim.title, amount: claim.amount,
        expenseDate: claim.expenseDate?.slice(0, 10) || today(), month: claim.month,
        description: claim.description ?? "", receiptUrl: claim.receiptUrl ?? "",
      });
    } else {
      reset({ employee: "", category: "travel", title: "", amount: 0, expenseDate: today(), month: defaultMonth || thisMonth(), description: "", receiptUrl: "" });
    }
  }, [open, claim, defaultMonth, reset]);

  const onSubmit = (data: ReimbursementFormValues) => {
    const payload: Record<string, unknown> = {
      ...data,
      description: data.description || undefined,
      receiptUrl: data.receiptUrl || undefined,
    };
    if (!canFileForOthers || !payload.employee) delete payload.employee;
    if (isEditing) {
      delete payload.employee;
      update({ id: claim._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Claim" : "New Reimbursement Claim"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          {canFileForOthers && !isEditing && (
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Controller name="employee" control={control} render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Myself (leave empty) or pick an employee" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={e._id} value={e._id}>{e.name} ({e.employeeCode})</SelectItem>)}</SelectContent>
                </Select>
              )} />
              <p className="text-[11px] text-muted-foreground">Leave empty to file for yourself.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Controller name="category" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REIMBURSEMENT_CATEGORY_LABELS) as ReimbursementCategory[]).map((k) => <SelectItem key={k} value={k}>{REIMBURSEMENT_CATEGORY_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount *</Label>
              <Input id="amount" type="number" min="0" step="0.01" {...register("amount")} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" placeholder="e.g. Client visit taxi" {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="expenseDate">Expense date *</Label>
              <Input id="expenseDate" type="date" {...register("expenseDate")} />
              {errors.expenseDate && <p className="text-xs text-destructive">{errors.expenseDate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="month">Payout month *</Label>
              <Input id="month" type="month" {...register("month")} />
              {errors.month && <p className="text-xs text-destructive">{errors.month.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="receiptUrl">Receipt link</Label>
            <Input id="receiptUrl" placeholder="https://… (optional)" {...register("receiptUrl")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={2} placeholder="Optional details" {...register("description")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Submit Claim"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
