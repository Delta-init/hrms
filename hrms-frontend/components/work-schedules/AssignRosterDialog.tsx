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
import { rosterFormSchema, type RosterFormValues } from "@/lib/validations/rosterSchema";
import { useCreateRosterAssignment, useUpdateRosterAssignment } from "@/hooks/useRosterAssignments";
import { useWorkSchedulesSimple } from "@/hooks/useWorkSchedules";
import type { RosterAssignment } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment?: RosterAssignment | null;
}

const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");
const todayISO = () => new Date().toISOString().slice(0, 10);
const EMPTY: RosterFormValues = { employee: "", workSchedule: "", effectiveFrom: todayISO(), effectiveTo: "", notes: "" };

export function AssignRosterDialog({ open, onOpenChange, assignment }: Props) {
  const isEditing = !!assignment;
  const { data: schedules } = useWorkSchedulesSimple();
  const { mutate: create, isPending: creating } = useCreateRosterAssignment();
  const { mutate: update, isPending: updating } = useUpdateRosterAssignment();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<RosterFormValues>({
    resolver: zodResolver(rosterFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    if (assignment) {
      reset({
        employee: idOf(assignment.employee), workSchedule: idOf(assignment.workSchedule),
        effectiveFrom: assignment.effectiveFrom.slice(0, 10),
        effectiveTo: assignment.effectiveTo ? assignment.effectiveTo.slice(0, 10) : "",
        notes: assignment.notes ?? "",
      });
    } else {
      reset(EMPTY);
    }
  }, [open, assignment, reset]);

  const onSubmit = (data: RosterFormValues) => {
    const payload = { ...data, effectiveTo: data.effectiveTo || null, notes: data.notes || undefined };
    if (isEditing) {
      const { employee: _e, ...rest } = payload;
      update({ id: assignment._id, data: rest }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  const lockName = typeof assignment?.employee === "object" ? assignment?.employee?.name : "";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Shift Assignment" : "Assign Shift"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            {isEditing ? (
              <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">{lockName}</div>
            ) : (
              <Controller name="employee" control={control} render={({ field }) => (
                <EmployeeSelect value={field.value} onChange={field.onChange} placeholder="Select employee" />
              )} />
            )}
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Shift / work schedule *</Label>
            <Controller name="workSchedule" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                <SelectContent>{(schedules ?? []).map((s) => <SelectItem key={s._id} value={s._id}>{s.name} · {s.loginTime}–{s.logoutTime}</SelectItem>)}</SelectContent>
              </Select>
            )} />
            {errors.workSchedule && <p className="text-xs text-destructive">{errors.workSchedule.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="effectiveFrom">Start date *</Label>
              <Input id="effectiveFrom" type="date" {...register("effectiveFrom")} />
              {errors.effectiveFrom && <p className="text-xs text-destructive">{errors.effectiveFrom.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="effectiveTo">End date</Label>
              <Input id="effectiveTo" type="date" placeholder="Open-ended" {...register("effectiveTo")} />
              {errors.effectiveTo && <p className="text-xs text-destructive">{errors.effectiveTo.message}</p>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Leave the end date blank for an open-ended assignment (e.g. a permanent shift change). Give it an end date for a rotation, such as one week on nights.</p>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional (e.g. reason for the rotation)" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Assign"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
