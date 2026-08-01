"use client";
import { useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Stars } from "@/components/performance/Stars";
import { goalsFormSchema, type GoalsFormValues } from "@/lib/validations/performanceSchema";
import { useSetMyGoals, useSubmitMySelfReview } from "@/hooks/usePerformance";
import { APPRAISAL_STATUS_LABELS, type Appraisal } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appraisal: Appraisal | null;
}

const EMPTY_GOAL = { title: "", description: "", weight: 0, selfRating: "" as const };

export function MyAppraisalDialog({ open, onOpenChange, appraisal }: Props) {
  const { mutate: saveGoals, isPending: saving } = useSetMyGoals();
  const { mutate: submitReview, isPending: submitting } = useSubmitMySelfReview();
  const [selfComment, setSelfComment] = useState("");

  const isDraft = appraisal?.status === "draft";
  const cycle = appraisal && typeof appraisal.cycle === "object" ? appraisal.cycle : null;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<GoalsFormValues>({
    resolver: zodResolver(goalsFormSchema),
    defaultValues: { goals: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "goals" });

  useEffect(() => {
    if (!open || !appraisal) return;
    reset({
      goals: appraisal.goals.length
        ? appraisal.goals.map((g) => ({ _id: g._id, title: g.title, description: g.description ?? "", weight: g.weight, selfRating: g.selfRating ?? "" }))
        : [EMPTY_GOAL],
    });
    setSelfComment(appraisal.selfComment ?? "");
  }, [open, appraisal, reset]);

  if (!appraisal) return null;

  const onSaveGoals = (data: GoalsFormValues) => {
    if (!appraisal) return;
    const goals = data.goals.map((g) => ({ ...g, selfRating: g.selfRating === "" ? null : Number(g.selfRating) }));
    saveGoals({ id: appraisal._id, goals });
  };

  const onSubmitReview = () => {
    if (!appraisal) return;
    submitReview({ id: appraisal._id, selfComment });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex flex-wrap items-center gap-2">
            {cycle?.title ?? "Appraisal"}
            <Badge variant="outline">{APPRAISAL_STATUS_LABELS[appraisal.status]}</Badge>
            {appraisal.overallRating != null && <Badge variant="outline">Overall {appraisal.overallRating.toFixed(1)}/5</Badge>}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {isDraft ? (
          <form onSubmit={handleSubmit(onSaveGoals)} className="space-y-4 px-4 sm:px-0">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Goals</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => append(EMPTY_GOAL)}>
                  <Plus className="h-3.5 w-3.5" />Add goal
                </Button>
              </div>
              {errors.goals?.root?.message && <p className="text-xs text-destructive">{errors.goals.root.message}</p>}
              {errors.goals?.message && <p className="text-xs text-destructive">{errors.goals.message}</p>}

              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={f.id} className="space-y-2 rounded-md border border-border p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-1">
                        <Input placeholder="Goal title" {...register(`goals.${i}.title`)} />
                        {errors.goals?.[i]?.title && <p className="text-[11px] text-destructive">{errors.goals[i]?.title?.message}</p>}
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <Textarea rows={2} placeholder="Description (optional)" {...register(`goals.${i}.description`)} />
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-xs text-muted-foreground">Weight %</Label>
                        <Input type="number" min={0} max={100} className="h-8 w-20" {...register(`goals.${i}.weight`)} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-xs text-muted-foreground">Self rating</Label>
                        <Controller name={`goals.${i}.selfRating`} control={control} render={({ field }) => (
                          <Stars value={field.value === "" ? null : Number(field.value)} onChange={field.onChange} />
                        )} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="selfComment">Self-review comment</Label>
              <Textarea id="selfComment" rows={3} placeholder="Summarize your performance this cycle…" value={selfComment} onChange={(e) => setSelfComment(e.target.value)} />
            </div>

            <ResponsiveDialogFooter className="flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button type="submit" variant="outline" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save Goals</Button>
              <Button type="button" onClick={onSubmitReview} disabled={submitting || !appraisal.goals.length}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}Submit Self-Review
              </Button>
            </ResponsiveDialogFooter>
          </form>
        ) : (
          <div className="space-y-3 px-4 pb-4 sm:px-0">
            {appraisal.goals.map((g) => (
              <div key={g._id} className="space-y-1.5 rounded-md border border-border p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{g.title}</p>
                  <span className="text-xs text-muted-foreground">{g.weight}%</span>
                </div>
                {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">Self</span><Stars value={g.selfRating} readOnly /></div>
                  <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">Manager</span><Stars value={g.managerRating} readOnly /></div>
                </div>
              </div>
            ))}
            {appraisal.selfComment && (
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Your comment</Label><p className="rounded-md bg-muted/50 p-2.5 text-sm">{appraisal.selfComment}</p></div>
            )}
            {appraisal.managerComment && (
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Manager comment</Label><p className="rounded-md bg-muted/50 p-2.5 text-sm">{appraisal.managerComment}</p></div>
            )}
            <ResponsiveDialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </ResponsiveDialogFooter>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
