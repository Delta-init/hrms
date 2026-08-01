"use client";
import { useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSubmitSurveyResponse } from "@/hooks/useSurveys";
import type { Survey, SurveyAnswer } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  survey: Survey | null;
}

export function SurveyResponseDialog({ open, onOpenChange, survey }: Props) {
  const { mutate: submit, isPending } = useSubmitSurveyResponse();
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setValues({}); setError(null); }
  }, [open, survey]);

  if (!survey) return null;

  const onSubmit = () => {
    setError(null);
    for (const q of survey.questions) {
      if (q.required && (values[q._id] === undefined || values[q._id] === "")) {
        setError(`"${q.text}" is required`);
        return;
      }
    }
    const answers: SurveyAnswer[] = Object.entries(values)
      .filter(([, v]) => v !== "" && v !== undefined)
      .map(([question, value]) => ({ question, value }));
    submit({ id: survey._id, answers }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{survey.title}</ResponsiveDialogTitle>
          {survey.description && <ResponsiveDialogDescription>{survey.description}</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>

        <div className="space-y-5 px-4 sm:px-0">
          {survey.questions.map((q) => (
            <div key={q._id} className="space-y-2">
              <Label>{q.text}{q.required && <span className="text-destructive"> *</span>}</Label>
              {q.type === "text" && (
                <Textarea rows={3} value={(values[q._id] as string) ?? ""} onChange={(e) => setValues((v) => ({ ...v, [q._id]: e.target.value }))} />
              )}
              {q.type === "single_choice" && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => (
                    <button
                      key={o} type="button"
                      onClick={() => setValues((v) => ({ ...v, [q._id]: o }))}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm transition-colors",
                        values[q._id] === o ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"
                      )}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
              {q.type === "rating" && (
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => setValues((v) => ({ ...v, [q._id]: n }))} className="p-0.5">
                      <Star className={cn("h-6 w-6", (values[q._id] as number) >= n ? "fill-primary text-primary" : "text-muted-foreground")} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={onSubmit} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Submit
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
