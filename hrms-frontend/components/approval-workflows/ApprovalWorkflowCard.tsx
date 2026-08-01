"use client";
import { useEffect } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2, ChevronUp, ChevronDown, GitBranch } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { approvalWorkflowFormSchema, type ApprovalWorkflowFormValues } from "@/lib/validations/approvalWorkflowSchema";
import { useUpsertApprovalWorkflow } from "@/hooks/useApprovalWorkflows";
import type { ApprovableModule, ApprovalWorkflow, RoleSimple } from "@/types";

interface Props {
  module: ApprovableModule;
  title: string;
  description: string;
  workflow?: ApprovalWorkflow;
  roles: RoleSimple[];
  canEdit: boolean;
}

const DEFAULTS: ApprovalWorkflowFormValues = { enabled: false, steps: [] };

export function ApprovalWorkflowCard({ module, title, description, workflow, roles, canEdit }: Props) {
  const { mutate: save, isPending } = useUpsertApprovalWorkflow();
  const { register, handleSubmit, control, reset, watch, formState: { isDirty, errors } } = useForm<ApprovalWorkflowFormValues>({
    resolver: zodResolver(approvalWorkflowFormSchema),
    defaultValues: DEFAULTS,
  });
  const { fields, append, remove, move } = useFieldArray({ control, name: "steps" });

  useEffect(() => {
    if (workflow) {
      reset({
        enabled: workflow.enabled,
        steps: workflow.steps.map((s) => ({ role: typeof s.role === "object" ? s.role._id : s.role, label: s.label ?? "" })),
      });
    } else {
      reset(DEFAULTS);
    }
  }, [workflow, reset]);

  const enabled = watch("enabled");
  const onSubmit = (data: ApprovalWorkflowFormValues) => save({ module, data });

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2"><GitBranch className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">{title}</h3></div>
      <p className="mb-4 text-xs text-muted-foreground">{description}</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">Enable multi-step approval</p>
            <p className="text-[11px] text-muted-foreground">When off, any approver reviews it in a single step (today&apos;s default).</p>
          </div>
          <Controller name="enabled" control={control} render={({ field }) => (
            <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
          )} />
        </div>

        {enabled && (
          <div className="space-y-2">
            <Label>Approval steps, in order</Label>
            {fields.length === 0 && (
              <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">No steps yet — add at least one role to enable this workflow.</p>
            )}
            {fields.map((f, i) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{i + 1}</span>
                <Controller name={`steps.${i}.role`} control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
                    <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="Select role" /></SelectTrigger>
                    <SelectContent>{roles.map((r) => <SelectItem key={r._id} value={r._id}>{r.roleName}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
                <Input placeholder="Label (optional)" className="h-8 w-40" disabled={!canEdit} {...register(`steps.${i}.label` as const)} />
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!canEdit || i === 0} onClick={() => move(i, i - 1)}><ChevronUp className="h-3.5 w-3.5" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={!canEdit || i === fields.length - 1} onClick={() => move(i, i + 1)}><ChevronDown className="h-3.5 w-3.5" /></Button>
                  {canEdit && <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </div>
              </div>
            ))}
            {errors.steps?.message && <p className="text-xs text-destructive">{errors.steps.message}</p>}
            {canEdit && fields.length < 5 && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => append({ role: roles[0]?._id ?? "", label: "" })} disabled={roles.length === 0}>
                <Plus className="h-3.5 w-3.5" />Add step
              </Button>
            )}
          </div>
        )}

        {canEdit && (
          <Button type="submit" disabled={isPending || !isDirty} className="w-full sm:w-auto">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save Changes
          </Button>
        )}
      </form>
    </Card>
  );
}
