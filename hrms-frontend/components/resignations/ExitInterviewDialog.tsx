"use client";
import { useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useSaveExitInterview } from "@/hooks/useResignations";
import {
  EXIT_REASONS, EXIT_REASON_LABELS, EXIT_RATING_FIELDS,
  type ExitReason, type Resignation,
} from "@/types";

type RatingKey = (typeof EXIT_RATING_FIELDS)[number]["key"];
type Ratings = Partial<Record<RatingKey, number | null>>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  resignation: Resignation;
}

/** 1–5 stars. Clicking the current value clears it, so a question can be left unanswered. */
function StarRow({ value, onChange }: { value?: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          aria-label={`${n} out of 5`}
          className="p-0.5 transition-transform hover:scale-110"
        >
          <Star className={cn("h-5 w-5", (value ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
        </button>
      ))}
      {value ? <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{value}/5</span> : null}
    </div>
  );
}

function YesNo({ value, onChange }: { value?: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <div className="flex gap-2">
      {[{ v: true, l: "Yes" }, { v: false, l: "No" }].map(({ v, l }) => (
        <Button
          key={l}
          type="button"
          size="sm"
          variant={value === v ? "default" : "outline"}
          onClick={() => onChange(value === v ? null : v)}
        >
          {l}
        </Button>
      ))}
    </div>
  );
}

export function ExitInterviewDialog({ open, onOpenChange, resignation: r }: Props) {
  const { mutate: save, isPending } = useSaveExitInterview();
  const ei = r.exitInterview;

  const [reason, setReason] = useState<ExitReason | "">("");
  const [ratings, setRatings] = useState<Ratings>({});
  const [wentWell, setWentWell] = useState("");
  const [improve, setImprove] = useState("");
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [rehire, setRehire] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");

  // Re-seed from the record whenever the dialog opens, so reopening never shows stale edits.
  useEffect(() => {
    if (!open) return;
    setReason(ei?.primaryReason ?? "");
    setRatings(ei?.ratings ?? {});
    setWentWell(ei?.whatWentWell ?? "");
    setImprove(ei?.whatCouldImprove ?? "");
    setRecommend(ei?.wouldRecommend ?? null);
    setRehire(ei?.eligibleForRehire ?? null);
    setNotes(ei?.notes ?? "");
  }, [open, ei]);

  const onSubmit = () => {
    save(
      {
        id: r._id,
        data: {
          primaryReason: reason || undefined,
          ratings,
          whatWentWell: wentWell || undefined,
          whatCouldImprove: improve || undefined,
          wouldRecommend: recommend,
          eligibleForRehire: rehire,
          notes: notes || undefined,
        },
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Exit interview</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-5 px-4 pb-2 sm:px-0">
          <div className="space-y-1.5">
            <Label>Primary reason for leaving</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as ExitReason)}>
              <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                {EXIT_REASONS.map((x) => <SelectItem key={x} value={x}>{EXIT_REASON_LABELS[x]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2.5">
            <Label>Ratings</Label>
            <div className="space-y-2 rounded-lg border border-border p-3">
              {EXIT_RATING_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-4">
                  <span className="text-sm">{f.label}</span>
                  <StarRow value={ratings[f.key]} onChange={(v) => setRatings((p) => ({ ...p, [f.key]: v }))} />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>What went well?</Label>
            <Textarea rows={3} value={wentWell} onChange={(e) => setWentWell(e.target.value)} placeholder="In the employee's words" />
          </div>

          <div className="space-y-1.5">
            <Label>What could we improve?</Label>
            <Textarea rows={3} value={improve} onChange={(e) => setImprove(e.target.value)} placeholder="In the employee's words" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Would recommend us as an employer</Label>
              <YesNo value={recommend} onChange={setRecommend} />
            </div>
            <div className="space-y-1.5">
              <Label>Eligible for rehire <span className="text-xs font-normal text-muted-foreground">(HR view)</span></Label>
              <YesNo value={rehire} onChange={setRehire} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Internal notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Not shared with the employee" />
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {ei?.conductedAt ? "Update interview" : "Save interview"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
