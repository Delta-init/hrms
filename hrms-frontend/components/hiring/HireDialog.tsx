"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { Loader2, UserPlus } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useHirePrefill, useHireApplicant } from "@/hooks/useHire";
import { useDepartments } from "@/hooks/useDepartments";
import { useRoles } from "@/hooks/useRoles";
import { useOnboardingTemplates } from "@/hooks/useOnboardingChecklists";
import {
  EMPLOYMENT_TYPE_LABELS, LOCATION_LABELS,
  type EmployeeLocation, type EmploymentType,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string;
  candidateName?: string;
}

interface FormValues {
  employeeCode: string;
  joiningDate: string;
  name: string;
  email: string;
  designation: string;
  department: string;
  location: EmployeeLocation | "";
  employmentType: EmploymentType;
  salary: string;
  currency: string;
  createLogin: boolean;
  loginRole: string;
  onboardingTemplate: string;
}

const NONE = "__none__";

/**
 * The seam between recruiting and everything else.
 *
 * This is the step people forget: an offer is accepted, the person turns up on
 * Monday, and there is no record, no login, no document checklist and nobody on
 * payroll. Everything derivable is filled in already, so the only questions left
 * are the two nobody could have answered in advance.
 */
export function HireDialog({ open, onOpenChange, applicationId, candidateName }: Props) {
  const { data: prefill, isLoading } = useHirePrefill(applicationId, open);
  const { mutate: hire, isPending } = useHireApplicant();
  const { data: departmentData } = useDepartments();
  const { data: roleData } = useRoles();
  const { data: templates } = useOnboardingTemplates();

  const departments = departmentData?.data ?? [];
  const roles = roleData?.data ?? [];

  const { register, handleSubmit, control, reset, watch } = useForm<FormValues>({
    defaultValues: {
      employeeCode: "", joiningDate: "", name: "", email: "", designation: "",
      department: "", location: "", employmentType: "full_time", salary: "", currency: "AED",
      createLogin: false, loginRole: "", onboardingTemplate: "",
    },
  });

  const createLogin = watch("createLogin");

  useEffect(() => {
    if (!open || !prefill) return;
    reset({
      employeeCode: "",
      joiningDate: "",
      name: prefill.name,
      email: prefill.email,
      designation: prefill.designation,
      department: prefill.department ?? "",
      location: prefill.location ?? "",
      employmentType: prefill.employmentType,
      salary: prefill.salary != null ? String(prefill.salary) : "",
      currency: prefill.currency,
      createLogin: false,
      loginRole: "",
      onboardingTemplate: "",
    });
  }, [open, prefill, reset]);

  const onSubmit = (d: FormValues) => {
    hire(
      {
        id: applicationId,
        employeeCode: d.employeeCode,
        joiningDate: d.joiningDate,
        name: d.name,
        email: d.email,
        designation: d.designation || undefined,
        department: d.department || null,
        location: d.location || undefined,
        employmentType: d.employmentType,
        salary: d.salary ? Number(d.salary) : undefined,
        currency: d.currency,
        createLogin: d.createLogin,
        loginRole: d.createLogin && d.loginRole ? d.loginRole : undefined,
        onboardingTemplate: d.onboardingTemplate && d.onboardingTemplate !== NONE ? d.onboardingTemplate : undefined,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create an employee{candidateName ? ` — ${candidateName}` : ""}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
            {/* The two nobody could derive, first and on their own row. */}
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-primary/20 bg-primary/5 p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="employeeCode">Employee code *</Label>
                <Input id="employeeCode" placeholder="E0123" {...register("employeeCode", { required: true })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="joiningDate">Joining date *</Label>
                <Input id="joiningDate" type="date" {...register("joiningDate", { required: true })} />
                <p className="text-[11px] text-muted-foreground">Onboarding tasks are dated from this.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" {...register("name")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input id="email" type="email" {...register("email")} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="designation">Designation</Label>
                <Input id="designation" {...register("designation")} />
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Controller name="department" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{departments.map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}</SelectContent>
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
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" className="uppercase" {...register("currency")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="salary">Salary</Label>
                <Input id="salary" type="number" min={0} {...register("salary")} />
                <p className="text-[11px] text-muted-foreground">What was offered.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Onboarding checklist</Label>
              <Controller name="onboardingTemplate" control={control} render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Don&apos;t create one</SelectItem>
                    {(templates ?? []).map((t: { _id: string; name: string }) => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="pr-3">
                <p className="text-sm font-medium">Create a login</p>
                <p className="text-[11px] text-muted-foreground">
                  They can sign in, clock in and see their own payslips. Can be added later from their record.
                </p>
              </div>
              <Controller name="createLogin" control={control} render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              )} />
            </div>

            {createLogin && (
              <div className="space-y-1.5">
                <Label>Their role *</Label>
                <Controller name="loginRole" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                    <SelectContent>{roles.map((r) => <SelectItem key={r._id} value={r._id}>{r.roleName}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </div>
            )}

            <ResponsiveDialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                Create employee
              </Button>
            </ResponsiveDialogFooter>
          </form>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
