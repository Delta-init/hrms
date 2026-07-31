"use client";
import { useEffect } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { templateFormSchema, type TemplateFormValues } from "@/lib/validations/onboardingChecklistSchema";
import { useCreateOnboardingTemplate, useUpdateOnboardingTemplate } from "@/hooks/useOnboardingChecklists";
import {
  ONBOARDING_CATEGORY_LABELS, ONBOARDING_ASSIGNEE_LABELS,
  type OnboardingTemplate, type OnboardingTaskCategory, type OnboardingAssigneeRole,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: OnboardingTemplate | null;
}

const EMPTY: TemplateFormValues = { name: "", description: "", tasks: [] };
const EMPTY_TASK = { title: "", description: "", category: "documentation" as const, assigneeRole: "hr" as const, dueDayOffset: 0 };

export function OnboardingTemplateDialog({ open, onOpenChange, template }: Props) {
  const isEditing = !!template;
  const { mutate: create, isPending: creating } = useCreateOnboardingTemplate();
  const { mutate: update, isPending: updating } = useUpdateOnboardingTemplate();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: EMPTY,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "tasks" });

  useEffect(() => {
    if (!open) return;
    if (template) {
      reset({
        name: template.name, description: template.description ?? "",
        tasks: template.tasks.map((t) => ({
          title: t.title, description: t.description ?? "", category: t.category,
          assigneeRole: t.assigneeRole, dueDayOffset: t.dueDayOffset,
        })),
      });
    } else {
      reset(EMPTY);
    }
  }, [open, template, reset]);

  const onSubmit = (data: TemplateFormValues) => {
    const payload = { ...data, description: data.description || undefined };
    if (isEditing) update({ id: template._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Template" : "New Onboarding Template"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" placeholder="e.g. Standard New Hire" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Input id="description" placeholder="Optional" {...register("description")} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Tasks</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => append(EMPTY_TASK)}>
                <Plus className="h-3.5 w-3.5" />Add task
              </Button>
            </div>
            {errors.tasks?.root?.message && <p className="text-xs text-destructive">{errors.tasks.root.message}</p>}
            {errors.tasks?.message && <p className="text-xs text-destructive">{errors.tasks.message}</p>}

            {fields.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">No tasks yet — add at least one.</div>
            ) : (
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={f.id} className="space-y-2 rounded-md border border-border p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-1">
                        <Input placeholder="Task title" {...register(`tasks.${i}.title`)} />
                        {errors.tasks?.[i]?.title && <p className="text-[11px] text-destructive">{errors.tasks[i]?.title?.message}</p>}
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <Textarea rows={1} placeholder="Description (optional)" {...register(`tasks.${i}.description`)} />
                    <div className="grid grid-cols-3 gap-2">
                      <Controller name={`tasks.${i}.category`} control={control} render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>{(Object.keys(ONBOARDING_CATEGORY_LABELS) as OnboardingTaskCategory[]).map((k) => <SelectItem key={k} value={k}>{ONBOARDING_CATEGORY_LABELS[k]}</SelectItem>)}</SelectContent>
                        </Select>
                      )} />
                      <Controller name={`tasks.${i}.assigneeRole`} control={control} render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>{(Object.keys(ONBOARDING_ASSIGNEE_LABELS) as OnboardingAssigneeRole[]).map((k) => <SelectItem key={k} value={k}>{ONBOARDING_ASSIGNEE_LABELS[k]}</SelectItem>)}</SelectContent>
                        </Select>
                      )} />
                      <div>
                        <Input type="number" step="1" placeholder="Due (days)" className="h-9" {...register(`tasks.${i}.dueDayOffset`)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">&quot;Due (days)&quot; is relative to the employee&apos;s joining date — 0 means due on day one, negative means before joining.</p>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Create Template"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
