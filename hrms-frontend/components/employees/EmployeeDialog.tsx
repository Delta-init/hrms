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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { employeeFormSchema, type EmployeeFormValues } from "@/lib/validations/employeeSchema";
import { useCreateEmployee, useUpdateEmployee } from "@/hooks/useEmployees";
import { useDepartmentsSimple } from "@/hooks/useDepartments";
import { useWorkSchedulesSimple } from "@/hooks/useWorkSchedules";
import { useUsers } from "@/hooks/useUsers";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYEE_STATUS_LABELS, LOCATION_LABELS, type Employee, type EmploymentType, type EmployeeStatus, type EmployeeLocation } from "@/types";

const NONE = "__none__";
const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");
const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: Employee | null;
  /** Prefill a new employee's name + linked login when creating from a user. */
  defaultName?: string;
  defaultUserId?: string;
}

export function EmployeeDialog({ open, onOpenChange, employee, defaultName, defaultUserId }: Props) {
  const isEditing = !!employee;
  const { data: departments = [] } = useDepartmentsSimple();
  const { data: schedules = [] } = useWorkSchedulesSimple();
  const { data: usersData } = useUsers({ limit: "200" });
  const users = usersData?.data ?? [];
  const { mutate: create, isPending: creating } = useCreateEmployee();
  const { mutate: update, isPending: updating } = useUpdateEmployee();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      employeeCode: "", name: "", email: "", phone: "", department: "", designation: "",
      workSchedule: "", user: "", employmentType: "full_time", joiningDate: "", status: "active", location: undefined,
      salary: 0, currency: "AED",
    },
  });

  useEffect(() => {
    if (!open) return;
    if (employee) {
      reset({
        employeeCode: employee.employeeCode,
        name: employee.name,
        email: employee.email ?? "",
        phone: employee.phone ?? "",
        department: idOf(employee.department),
        designation: employee.designation ?? "",
        workSchedule: idOf(employee.workSchedule),
        user: idOf(employee.user),
        employmentType: employee.employmentType,
        joiningDate: toDateInput(employee.joiningDate),
        status: employee.status,
        location: employee.location ?? undefined,
        salary: employee.salary ?? 0,
        currency: employee.currency ?? "AED",
      });
    } else {
      reset({ employeeCode: "", name: defaultName ?? "", email: "", phone: "", department: "", designation: "", workSchedule: "", user: defaultUserId ?? "", employmentType: "full_time", joiningDate: "", status: "active", location: undefined, salary: 0, currency: "AED" });
    }
  }, [open, employee, reset, defaultName, defaultUserId]);

  const onSubmit = (data: EmployeeFormValues) => {
    const payload: Record<string, unknown> = {
      ...data,
      department: data.department || null,
      workSchedule: data.workSchedule || null,
      user: data.user || null,
      joiningDate: data.joiningDate || null,
      email: data.email || undefined,
    };
    if (isEditing) update({ id: employee._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  const optSelect = (name: keyof EmployeeFormValues, placeholder: string, options: { _id: string; label: string }[]) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Select value={(field.value as string) || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
          <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {options.map((o) => <SelectItem key={o._id} value={o._id}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    />
  );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Employee" : "New Employee"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="employeeCode">Employee Code *</Label>
            <Input id="employeeCode" placeholder="EMP-001" {...register("employeeCode")} />
            {errors.employeeCode && <p className="text-xs text-destructive">{errors.employeeCode.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Full Name *</Label>
            <Input id="name" placeholder="Jane Doe" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="jane@company.com" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" placeholder="+971 …" {...register("phone")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="designation">Designation</Label>
            <Input id="designation" placeholder="e.g. Engineer" {...register("designation")} />
          </div>
          <div className="space-y-1.5">
            <Label>Location</Label>
            <Controller
              name="location"
              control={control}
              render={({ field }) => (
                <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? undefined : v)}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {(Object.keys(LOCATION_LABELS) as EmployeeLocation[]).map((l) => (
                      <SelectItem key={l} value={l}>{LOCATION_LABELS[l]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-[11px] text-muted-foreground">Determines which documents the employee must upload during onboarding.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Department</Label>
            {optSelect("department", "Select department", departments.map((d) => ({ _id: d._id, label: d.code ? `${d.name} (${d.code})` : d.name })))}
          </div>
          <div className="space-y-1.5">
            <Label>Work Schedule</Label>
            {optSelect("workSchedule", "Select schedule", schedules.map((s) => ({ _id: s._id, label: `${s.name} · ${s.timeZone}` })))}
          </div>

          <div className="space-y-1.5">
            <Label>Employment Type</Label>
            <Controller
              name="employmentType"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((t) => (
                      <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="joiningDate">Joining Date</Label>
            <Input id="joiningDate" type="date" {...register("joiningDate")} />
          </div>
          <div className="space-y-1.5">
            <Label>Login Account</Label>
            {optSelect("user", "Link a user (optional)", users.map((u) => ({ _id: u._id, label: `${u.name} — ${u.email}` })))}
          </div>

          <div className="col-span-2 mt-1 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">Compensation</p>
            <p className="text-xs text-muted-foreground">Monthly base salary used to prefill payslips.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salary">Monthly Salary</Label>
            <Input id="salary" type="number" min="0" step="0.01" placeholder="0.00" {...register("salary")} />
            {errors.salary && <p className="text-xs text-destructive">{errors.salary.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" className="uppercase" placeholder="AED" {...register("currency")} />
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Employee"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
