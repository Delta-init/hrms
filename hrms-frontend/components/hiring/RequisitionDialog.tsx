"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { Loader2, AlertTriangle } from "lucide-react";
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
import { useCreateRequisition } from "@/hooks/useHiring";
import { useDepartments } from "@/hooks/useDepartments";
import { useEmployee } from "@/hooks/useEmployees";
import {
  EMPLOYMENT_TYPE_LABELS, LOCATION_LABELS, REQUISITION_TYPE_LABELS,
  type EmployeeLocation, type EmploymentType, type RequisitionType,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormValues {
  type: RequisitionType;
  replacing: string;
  title: string;
  department: string;
  designation: string;
  location: EmployeeLocation | "";
  employmentType: EmploymentType;
  headcount: number;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  justification: string;
  targetStartDate: string;
}

const EMPTY: FormValues = {
  type: "replacement", replacing: "", title: "", department: "", designation: "",
  location: "", employmentType: "full_time", headcount: 1,
  salaryMin: "", salaryMax: "", currency: "AED", justification: "", targetStartDate: "",
};

/**
 * Raising a request to fill a role.
 *
 * The form says who will have to approve it before it is submitted, because the
 * answer depends on what is typed into it: new headcount always goes to
 * Finance, and a replacement does only when it costs more than the person
 * leaving. Discovering that after submitting would make the rule feel arbitrary.
 */
export function RequisitionDialog({ open, onOpenChange }: Props) {
  const { mutate: create, isPending } = useCreateRequisition();
  const { data: departmentData } = useDepartments();
  const departments = departmentData?.data ?? [];

  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<FormValues>({
    defaultValues: EMPTY,
  });

  const type = watch("type");
  const replacing = watch("replacing");
  const salaryMax = watch("salaryMax");

  // The outgoing salary is the number the budget rule compares against, so it
  // is fetched to show the comparison rather than describe it.
  const { data: outgoing } = useEmployee(type === "replacement" ? replacing : undefined);
  const outgoingSalary = outgoing?.salary ?? null;
  const proposed = Number(salaryMax) || null;

  // Mirrors requiresBudgetApproval() on the server, including failing closed
  // when the comparison cannot be made.
  const needsFinance =
    type === "new_headcount" || !proposed || !outgoingSalary || proposed > outgoingSalary;

  useEffect(() => { if (open) reset(EMPTY); }, [open, reset]);

  const onSubmit = (data: FormValues) => {
    create(
      {
        ...data,
        replacing: data.type === "replacement" ? data.replacing : null,
        department: data.department || null,
        location: (data.location || undefined) as EmployeeLocation | undefined,
        salaryMin: data.salaryMin ? Number(data.salaryMin) : undefined,
        salaryMax: data.salaryMax ? Number(data.salaryMax) : undefined,
        headcount: Number(data.headcount) || 1,
        targetStartDate: data.targetStartDate || null,
      } as never,
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Raise a hiring requisition</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Why are you hiring? *</Label>
              <Controller name="type" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REQUISITION_TYPE_LABELS) as RequisitionType[]).map((t) => (
                      <SelectItem key={t} value={t}>{REQUISITION_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>

            {type === "replacement" && (
              <div className="space-y-1.5">
                <Label>Replacing *</Label>
                <Controller name="replacing" control={control} rules={{ required: type === "replacement" }} render={({ field }) => (
                  <EmployeeSelect value={field.value} onChange={field.onChange} placeholder="Who is leaving?" allowClear />
                )} />
                {errors.replacing && <p className="text-xs text-destructive">Say who is being replaced</p>}
                {outgoingSalary != null && (
                  <p className="text-[11px] text-muted-foreground">Currently paid {outgoingSalary}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Role title *</Label>
              <Input id="title" placeholder="e.g. Senior Accountant" {...register("title", { required: true })} />
              {errors.title && <p className="text-xs text-destructive">Give the role a title</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="designation">Designation</Label>
              <Input id="designation" {...register("designation")} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Controller name="department" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Controller name="location" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LOCATION_LABELS) as EmployeeLocation[]).map((l) => (
                      <SelectItem key={l} value={l}>{LOCATION_LABELS[l]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label>Employment type</Label>
              <Controller name="employmentType" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((t) => (
                      <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="headcount">Headcount</Label>
              <Input id="headcount" type="number" min={1} {...register("headcount")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" className="uppercase" {...register("currency")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="salaryMin">Budget from</Label>
              <Input id="salaryMin" type="number" min={0} {...register("salaryMin")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="salaryMax">Budget up to</Label>
              <Input id="salaryMax" type="number" min={0} {...register("salaryMax")} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="targetStartDate">Wanted by</Label>
              <Input id="targetStartDate" type="date" {...register("targetStartDate")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="justification">Justification</Label>
            <Textarea id="justification" rows={3} placeholder="Why is this role needed?" {...register("justification")} />
          </div>

          {/* Said before submitting, not discovered afterwards. */}
          <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${needsFinance ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {needsFinance ? (
                <>
                  This goes to <strong>Accounts first</strong>, then HR.{" "}
                  {type === "new_headcount"
                    ? "New headcount is not in an existing budget."
                    : !proposed || !outgoingSalary
                      ? "Without both the budget and the outgoing salary it cannot be shown to cost no more, so it is treated as an increase."
                      : `${proposed} is above the ${outgoingSalary} currently paid.`}
                </>
              ) : (
                <>This goes <strong>straight to HR</strong> — a like-for-like replacement is already budgeted.</>
              )}
            </span>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Raise requisition
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
