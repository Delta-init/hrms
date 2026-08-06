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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/pickers";
import { createChecklistFormSchema, type CreateChecklistFormValues } from "@/lib/validations/onboardingChecklistSchema";
import { useCreateOnboardingChecklist, useOnboardingTemplates } from "@/hooks/useOnboardingChecklists";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateChecklistDialog({ open, onOpenChange }: Props) {
  const { data: templates } = useOnboardingTemplates();
  const { mutate: create, isPending } = useCreateOnboardingChecklist();

  const { handleSubmit, control, reset, formState: { errors } } = useForm<CreateChecklistFormValues>({
    resolver: zodResolver(createChecklistFormSchema),
    defaultValues: { employee: "", templateId: "" },
  });

  useEffect(() => {
    if (open) reset({ employee: "", templateId: "" });
  }, [open, reset]);

  const onSubmit = (data: CreateChecklistFormValues) => create(data, { onSuccess: () => onOpenChange(false) });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New Onboarding Checklist</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            <Controller name="employee" control={control} render={({ field }) => (
              <EmployeeSelect value={field.value} onChange={field.onChange} placeholder="Select employee" />
            )} />
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Template *</Label>
            <Controller name="templateId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>{(templates ?? []).map((t) => <SelectItem key={t._id} value={t._id}>{t.name} ({t.tasks.length} tasks)</SelectItem>)}</SelectContent>
              </Select>
            )} />
            {errors.templateId && <p className="text-xs text-destructive">{errors.templateId.message}</p>}
            {templates?.length === 0 && <p className="text-xs text-muted-foreground">No templates yet — create one under the Templates tab first.</p>}
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !templates?.length}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
