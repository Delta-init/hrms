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
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { surveyFormSchema, type SurveyFormValues } from "@/lib/validations/surveySchema";
import { useCreateSurvey, useUpdateSurvey } from "@/hooks/useSurveys";
import { SURVEY_QUESTION_TYPE_LABELS, type Survey, type SurveyQuestionType } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  survey?: Survey | null;
}

const EMPTY: SurveyFormValues = { title: "", description: "", questions: [], closesAt: "" };
const EMPTY_QUESTION = { text: "", type: "text" as const, options: [], required: true };

export function SurveyDialog({ open, onOpenChange, survey }: Props) {
  const isEditing = !!survey;
  const { mutate: create, isPending: creating } = useCreateSurvey();
  const { mutate: update, isPending: updating } = useUpdateSurvey();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<SurveyFormValues>({
    resolver: zodResolver(surveyFormSchema),
    defaultValues: EMPTY,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "questions" });

  useEffect(() => {
    if (!open) return;
    if (survey) {
      reset({
        title: survey.title, description: survey.description ?? "",
        questions: survey.questions.map((q) => ({ text: q.text, type: q.type, options: q.options, required: q.required })),
        closesAt: survey.closesAt ? survey.closesAt.slice(0, 10) : "",
      });
    } else {
      reset(EMPTY);
    }
  }, [open, survey, reset]);

  const onSubmit = (data: SurveyFormValues) => {
    const payload = { ...data, description: data.description || undefined, closesAt: data.closesAt || undefined };
    if (isEditing) update({ id: survey._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Survey" : "New Survey"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          {isEditing && survey.status !== "draft" && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              This survey is {survey.status} — close it and create a new one to change its questions.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="title">Title *</Label>
              <Input id="title" placeholder="e.g. Q3 Engagement Pulse" {...register("title")} disabled={isEditing && survey.status !== "draft"} />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" rows={2} placeholder="Optional context for respondents" {...register("description")} disabled={isEditing && survey.status !== "draft"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="closesAt">Closes on</Label>
              <Input id="closesAt" type="date" {...register("closesAt")} disabled={isEditing && survey.status !== "draft"} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Questions</Label>
              {(!isEditing || survey.status === "draft") && (
                <Button type="button" variant="outline" size="sm" onClick={() => append(EMPTY_QUESTION)}>
                  <Plus className="h-3.5 w-3.5" />Add question
                </Button>
              )}
            </div>
            {errors.questions?.root?.message && <p className="text-xs text-destructive">{errors.questions.root.message}</p>}
            {errors.questions?.message && <p className="text-xs text-destructive">{errors.questions.message}</p>}

            {fields.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">No questions yet — add at least one.</div>
            ) : (
              <div className="space-y-2">
                {fields.map((f, i) => {
                  const type = watch(`questions.${i}.type`);
                  return (
                    <div key={f.id} className="space-y-2 rounded-md border border-border p-2.5">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-1">
                          <Input placeholder="Question text" {...register(`questions.${i}.text`)} disabled={isEditing && survey.status !== "draft"} />
                          {errors.questions?.[i]?.text && <p className="text-[11px] text-destructive">{errors.questions[i]?.text?.message}</p>}
                        </div>
                        {(!isEditing || survey.status === "draft") && (
                          <Button type="button" variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Controller name={`questions.${i}.type`} control={control} render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange} disabled={isEditing && survey.status !== "draft"}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(Object.keys(SURVEY_QUESTION_TYPE_LABELS) as SurveyQuestionType[]).map((t) => (
                                <SelectItem key={t} value={t}>{SURVEY_QUESTION_TYPE_LABELS[t]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )} />
                        <div className="flex items-center justify-between rounded-md border border-border px-3">
                          <span className="text-xs text-muted-foreground">Required</span>
                          <Controller name={`questions.${i}.required`} control={control} render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isEditing && survey.status !== "draft"} />
                          )} />
                        </div>
                      </div>
                      {type === "single_choice" && (
                        <div className="space-y-1">
                          <Controller name={`questions.${i}.options`} control={control} render={({ field }) => (
                            <Textarea
                              rows={3} placeholder={"One option per line"}
                              value={field.value.join("\n")}
                              onChange={(e) => field.onChange(e.target.value.split("\n"))}
                              disabled={isEditing && survey.status !== "draft"}
                            />
                          )} />
                          {errors.questions?.[i]?.options && <p className="text-[11px] text-destructive">{errors.questions[i]?.options?.message as string}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {(!isEditing || survey.status === "draft") && (
              <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Create Survey"}</Button>
            )}
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
