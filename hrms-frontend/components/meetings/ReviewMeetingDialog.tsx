"use client";
import { useEffect, useState } from "react";
import { Loader2, Plus, Star, Trash2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSaveReview } from "@/hooks/useMeetings";
import { cn } from "@/lib/utils";
import { REVIEW_OUTCOME_LABELS, type MeetingBooking, type ReviewOutcome } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: MeetingBooking | null;
}

const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");

/**
 * The review form, written by whoever held the review meeting. Saving it marks
 * the meeting held and tells the employee, who reads it and acknowledges it.
 * It can be rewritten until they do.
 */
export function ReviewMeetingDialog({ open, onOpenChange, booking }: Props) {
  const { mutate: save, isPending } = useSaveReview();
  const [rating, setRating] = useState(0);
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [actions, setActions] = useState<Array<{ text: string; dueDate: string }>>([]);
  const [outcome, setOutcome] = useState<ReviewOutcome | "">("");
  const [recordingLink, setRecordingLink] = useState("");

  useEffect(() => {
    if (!open || !booking) return;
    const r = booking.review;
    setRating(r?.rating ?? 0);
    setStrengths(r?.strengths ?? "");
    setImprovements(r?.improvements ?? "");
    setActions((r?.actions ?? []).map((a) => ({ text: a.text, dueDate: a.dueDate ? a.dueDate.slice(0, 10) : "" })));
    setOutcome(r?.outcome ?? "");
    setRecordingLink(booking.recordingLink ?? "");
  }, [open, booking]);

  if (!booking) return null;
  const linkOk = !recordingLink || /^https?:\/\//i.test(recordingLink.trim());
  const ready = rating >= 1 && !!outcome && linkOk && actions.every((a) => a.text.trim());

  const submit = () =>
    save(
      {
        id: booking._id,
        data: {
          rating, strengths: strengths.trim(), improvements: improvements.trim(), outcome,
          actions: actions.filter((a) => a.text.trim()).map((a) => ({ text: a.text.trim(), dueDate: a.dueDate || null })),
          recordingLink: recordingLink.trim(),
        },
      },
      { onSuccess: () => onOpenChange(false) }
    );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Review — {nameOf(booking.reviewee) || nameOf(booking.revieweeUser) || booking.title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Overall rating *</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} of 5`}
                  className="rounded p-0.5 focus-visible:ring-2 focus-visible:ring-primary/40">
                  <Star className={cn("h-6 w-6", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-strengths">Strengths</Label>
            <Textarea id="rv-strengths" rows={3} value={strengths} maxLength={2000} onChange={(e) => setStrengths(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-improve">Areas to improve</Label>
            <Textarea id="rv-improve" rows={3} value={improvements} maxLength={2000} onChange={(e) => setImprovements(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Agreed actions</Label>
            {actions.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Input value={a.text} maxLength={300} placeholder="What will be done"
                  onChange={(e) => setActions((s) => s.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <Input type="date" className="w-40" value={a.dueDate}
                  onChange={(e) => setActions((s) => s.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setActions((s) => s.filter((_, j) => j !== i))} aria-label="Remove action">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {actions.length < 20 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setActions((s) => [...s, { text: "", dueDate: "" }])}>
                <Plus className="h-3.5 w-3.5" />Add an action
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Outcome *</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(REVIEW_OUTCOME_LABELS) as ReviewOutcome[]).map((o) => (
                <button key={o} type="button" onClick={() => setOutcome(o)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition",
                    outcome === o ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
                  {REVIEW_OUTCOME_LABELS[o]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-rec">Recording link</Label>
            <Input id="rv-rec" value={recordingLink} onChange={(e) => setRecordingLink(e.target.value)} placeholder="Optional — can be added later" />
            {!linkOk && <p className="text-xs text-destructive">Must start with http:// or https://</p>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            The employee is told when you save, and can read and acknowledge it. You can change it until they acknowledge.
          </p>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={isPending || !ready}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save review
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
