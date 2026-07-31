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
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateLetterFormSchema, type GenerateLetterFormValues } from "@/lib/validations/letterSchema";
import { useGenerateLetter, useLetterTemplates } from "@/hooks/useLetters";
import { useEmployees } from "@/hooks/useEmployees";
import { LETTER_CATEGORY_LABELS, type GeneratedLetter } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated?: (letter: GeneratedLetter) => void;
}

export function GenerateLetterDialog({ open, onOpenChange, onGenerated }: Props) {
  const { data: empData } = useEmployees({ limit: "200" }, { enabled: open });
  const employees = (empData?.data ?? []).filter((e) => e.status !== "terminated");
  const { data: templates } = useLetterTemplates();
  const activeTemplates = (templates ?? []).filter((t) => t.status === "active");
  const { mutate: generate, isPending } = useGenerateLetter();

  const { handleSubmit, control, register, reset, formState: { errors } } = useForm<GenerateLetterFormValues>({
    resolver: zodResolver(generateLetterFormSchema),
    defaultValues: { employee: "", templateId: "", notes: "" },
  });

  useEffect(() => {
    if (open) reset({ employee: "", templateId: "", notes: "" });
  }, [open, reset]);

  const onSubmit = (data: GenerateLetterFormValues) => {
    const payload = { ...data, notes: data.notes || undefined };
    generate(payload, { onSuccess: (letter) => { onOpenChange(false); onGenerated?.(letter); } });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Generate Letter</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            <Controller name="employee" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>{employees.map((e) => <SelectItem key={e._id} value={e._id}>{e.name} ({e.employeeCode})</SelectItem>)}</SelectContent>
              </Select>
            )} />
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Template *</Label>
            <Controller name="templateId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>{activeTemplates.map((t) => <SelectItem key={t._id} value={t._id}>{t.name} · {LETTER_CATEGORY_LABELS[t.category]}</SelectItem>)}</SelectContent>
              </Select>
            )} />
            {errors.templateId && <p className="text-xs text-destructive">{errors.templateId.message}</p>}
            {activeTemplates.length === 0 && <p className="text-xs text-muted-foreground">No active templates yet — create one under the Templates tab first.</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional (internal note, not shown on the letter)" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || activeTemplates.length === 0}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Generate</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
