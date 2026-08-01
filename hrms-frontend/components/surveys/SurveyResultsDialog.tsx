"use client";
import { Loader2, Star } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSurveyResults } from "@/hooks/useSurveys";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surveyId: string | null;
}

export function SurveyResultsDialog({ open, onOpenChange, surveyId }: Props) {
  const { data, isLoading } = useSurveyResults(open ? surveyId : null);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            {data?.survey.title ?? "Results"}
            {data && <Badge variant="outline">{data.totalResponses} response{data.totalResponses === 1 ? "" : "s"}</Badge>}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !data || data.totalResponses === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-0">No responses yet.</p>
        ) : (
          <div className="space-y-5 px-4 pb-2 sm:px-0">
            {data.questions.map((q) => (
              <div key={q.questionId} className="space-y-2">
                <p className="text-sm font-medium">{q.text}</p>
                <p className="text-xs text-muted-foreground">{q.responseCount} answered</p>

                {q.type === "rating" && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={cn("h-4 w-4", (q.average ?? 0) >= n - 0.5 ? "fill-primary text-primary" : "text-muted-foreground")} />
                      ))}
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{q.average?.toFixed(2)}</span>
                    <div className="ml-2 flex-1 space-y-0.5">
                      {[5, 4, 3, 2, 1].map((n) => {
                        const count = q.distribution?.[n] ?? 0;
                        const pct = q.responseCount ? Math.round((count / q.responseCount) * 100) : 0;
                        return (
                          <div key={n} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="w-2 tabular-nums">{n}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                            <span className="w-6 text-right tabular-nums">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {q.type === "single_choice" && (
                  <div className="space-y-1.5">
                    {Object.entries(q.counts ?? {}).map(([option, count]) => {
                      const pct = q.responseCount ? Math.round((count / q.responseCount) * 100) : 0;
                      return (
                        <div key={option} className="space-y-0.5">
                          <div className="flex items-center justify-between text-xs">
                            <span>{option}</span>
                            <span className="tabular-nums text-muted-foreground">{count} ({pct}%)</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {q.type === "text" && (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                    {q.textAnswers?.length ? q.textAnswers.map((a, i) => (
                      <p key={i} className="rounded bg-muted px-2 py-1 text-xs">{a}</p>
                    )) : <p className="text-xs text-muted-foreground">No responses</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
