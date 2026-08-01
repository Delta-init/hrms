"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Stars } from "@/components/performance/Stars";
import { useReviewAppraisal } from "@/hooks/usePerformance";
import { APPRAISAL_STATUS_LABELS, type Appraisal } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appraisal: Appraisal | null;
}

export function ReviewAppraisalDialog({ open, onOpenChange, appraisal }: Props) {
  const { mutate: review, isPending } = useReviewAppraisal();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [managerComment, setManagerComment] = useState("");

  const employee = appraisal?.employee && typeof appraisal.employee === "object" ? appraisal.employee : null;
  const canReview = appraisal?.status === "submitted";

  useEffect(() => {
    if (!open || !appraisal) return;
    setRatings(Object.fromEntries(appraisal.goals.filter((g) => g.managerRating != null).map((g) => [g._id, g.managerRating as number])));
    setManagerComment(appraisal.managerComment ?? "");
  }, [open, appraisal]);

  if (!appraisal) return null;

  const submit = () => {
    review({
      id: appraisal._id, managerComment,
      goalRatings: Object.entries(ratings).map(([goalId, managerRating]) => ({ goalId, managerRating })),
    }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex flex-wrap items-center gap-2">
            {employee?.name ?? "Appraisal"}
            <Badge variant="outline">{APPRAISAL_STATUS_LABELS[appraisal.status]}</Badge>
            {appraisal.overallRating != null && <Badge variant="outline">Overall {appraisal.overallRating.toFixed(1)}/5</Badge>}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-3 px-4 pb-2 sm:px-0">
          {!canReview && appraisal.status === "draft" && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">This employee hasn&apos;t submitted their self-review yet.</p>
          )}
          {appraisal.goals.map((g) => (
            <div key={g._id} className="space-y-1.5 rounded-md border border-border p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{g.title}</p>
                <span className="text-xs text-muted-foreground">{g.weight}%</span>
              </div>
              {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">Self</span><Stars value={g.selfRating} readOnly /></div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Manager</span>
                  <Stars
                    value={ratings[g._id] ?? null} readOnly={!canReview}
                    onChange={(n) => setRatings((r) => ({ ...r, [g._id]: n }))}
                  />
                </div>
              </div>
            </div>
          ))}

          {appraisal.selfComment && (
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">Employee&apos;s comment</Label><p className="rounded-md bg-muted/50 p-2.5 text-sm">{appraisal.selfComment}</p></div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="managerComment">Manager comment</Label>
            <Textarea
              id="managerComment" rows={3} value={managerComment} onChange={(e) => setManagerComment(e.target.value)}
              disabled={!canReview} placeholder={canReview ? "Feedback for this cycle…" : undefined}
            />
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canReview && (
            <Button type="button" onClick={submit} disabled={isPending || Object.keys(ratings).length === 0}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Finalize Review
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
