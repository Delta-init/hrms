"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCreateOrganization, useUpdateOrganization } from "@/hooks/useOrganizations";
import type { Organization } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization?: Organization | null;
}

interface FormValues {
  name: string;
  code: string;
  status: "active" | "inactive";
  currency: string;
  timeZone: string;
  mailFrom: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  enforceWorkMode: boolean;
  bindRemoteDevice: boolean;
}

const empty: FormValues = { name: "", code: "", status: "active", currency: "AED", timeZone: "Asia/Dubai", mailFrom: "", smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", enforceWorkMode: false, bindRemoteDevice: false };

export function OrganizationDialog({ open, onOpenChange, organization }: Props) {
  const isEditing = !!organization;
  const { mutate: create, isPending: creating } = useCreateOrganization();
  const { mutate: update, isPending: updating } = useUpdateOrganization();
  const isPending = creating || updating;

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<FormValues>({ defaultValues: empty });

  useEffect(() => {
    if (!open) return;
    if (organization) {
      const s = organization.settings ?? {};
      reset({
        name: organization.name, code: organization.code, status: organization.status,
        currency: s.currency ?? "AED", timeZone: s.timeZone ?? "Asia/Dubai", mailFrom: s.mailFrom ?? "",
        smtpHost: s.smtpHost ?? "", smtpPort: s.smtpPort ?? "587", smtpUser: s.smtpUser ?? "", smtpPass: s.smtpPass ?? "",
        enforceWorkMode: s.enforceWorkMode ?? false,
        bindRemoteDevice: s.bindRemoteDevice ?? false,
      });
    } else reset(empty);
  }, [open, organization, reset]);

  const onSubmit = (v: FormValues) => {
    const payload = {
      name: v.name, code: v.code, status: v.status,
      settings: { currency: v.currency, timeZone: v.timeZone, mailFrom: v.mailFrom || undefined, smtpHost: v.smtpHost || undefined, smtpPort: v.smtpPort || undefined, smtpUser: v.smtpUser || undefined, smtpPass: v.smtpPass || undefined, enforceWorkMode: v.enforceWorkMode, bindRemoteDevice: v.bindRemoteDevice },
    };
    if (isEditing) update({ id: organization._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Organization" : "New Organization"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Name *</Label><Input {...register("name", { required: "Required" })} />{errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}</div>
            <div className="space-y-1.5"><Label>Code *</Label><Input className="uppercase" {...register("code", { required: "Required" })} />{errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}</div>
          </div>

          <div className="rounded-xl border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Defaults</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Currency</Label><Input className="uppercase" {...register("currency")} /></div>
              <div className="space-y-1.5"><Label>Time zone</Label><Input {...register("timeZone")} /></div>
            </div>
          </div>

          <div className="rounded-xl border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Attendance</p>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="enforceWorkMode">Office staff check in at a kiosk</Label>
                <p className="text-[11px] text-muted-foreground">
                  Takes clock-in and clock-out off the dashboard for everyone whose work mode is Office.
                  Set each person&apos;s work mode first — everybody counts as office until told otherwise.
                </p>
              </div>
              <Controller
                control={control}
                name="enforceWorkMode"
                render={({ field }) => (
                  <Switch id="enforceWorkMode" checked={field.value} onCheckedChange={field.onChange} className="mt-0.5 shrink-0" />
                )}
              />
            </div>

            <div className="mt-4 flex items-start justify-between gap-4 border-t border-border pt-4">
              <div className="space-y-0.5">
                <Label htmlFor="bindRemoteDevice">Remote staff punch from one device</Label>
                <p className="text-[11px] text-muted-foreground">
                  The first browser a remote employee punches from is registered to them; punches
                  from any other are refused until an admin resets it, from the employee&apos;s page.
                  Turn it on at the start of a day — whatever device somebody is holding when they
                  next punch is the one they get.
                </p>
              </div>
              <Controller
                control={control}
                name="bindRemoteDevice"
                render={({ field }) => (
                  <Switch id="bindRemoteDevice" checked={field.value} onCheckedChange={field.onChange} className="mt-0.5 shrink-0" />
                )}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Email (SMTP)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2"><Label>From address</Label><Input placeholder="HRMS <no-reply@org.com>" {...register("mailFrom")} /></div>
              <div className="space-y-1.5"><Label>Host</Label><Input {...register("smtpHost")} /></div>
              <div className="space-y-1.5"><Label>Port</Label><Input {...register("smtpPort")} /></div>
              <div className="space-y-1.5"><Label>User</Label><Input {...register("smtpUser")} /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input type="password" {...register("smtpPass")} /></div>
            </div>
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
