"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { InterviewQuestionsEditor } from "@/components/hiring/InterviewQuestionsEditor";
import { useRequisition, useSetRequisitionQuestions } from "@/hooks/useHiring";
import { blankQuestion, isBlankQuestion, questionsReady } from "@/lib/interviewQuestions";
import type { InterviewQuestion } from "@/types";

/**
 * The questions on their own, for a role already raised — approved or not.
 *
 * Saving them reopens no approval: the approvers signed off the role and its
 * budget, not the questions. A sheet already submitted keeps the questions it
 * was marked against.
 */
export function InterviewQuestionsDialog({ open, onOpenChange, requisitionId, title }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requisitionId: string;
  title?: string;
}) {
  const { data: full, isLoading } = useRequisition(open ? requisitionId : undefined);
  const { mutate: save, isPending } = useSetRequisitionQuestions();
  const [questions, setQuestions] = useState<InterviewQuestion[]>([blankQuestion()]);
  const [touched, setTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setShowErrors(false);
  }, [open]);

  useEffect(() => {
    if (!open || touched || !full) return;
    setQuestions(full.interviewQuestions?.length
      ? full.interviewQuestions.map((q) => ({ _id: q._id, question: q.question, expectedAnswer: q.expectedAnswer, maxMarks: q.maxMarks }))
      : [blankQuestion()]);
  }, [open, full, touched]);

  const problem = questionsReady(questions);
  const submit = () => {
    setShowErrors(true);
    if (problem) return;
    save(
      {
        id: requisitionId,
        interviewQuestions: questions.filter((q) => !isBlankQuestion(q)).map((q) => ({
          ...q, question: q.question.trim(), expectedAnswer: q.expectedAnswer.trim(),
        })),
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Interview questions{title ? ` — ${title}` : ""}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            Asked in every interview round. Changing them does not send the role back for approval, and sheets already
            submitted keep the questions they were marked against.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="px-4 sm:px-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <InterviewQuestionsEditor
              value={questions}
              onChange={(next) => { setQuestions(next); setTouched(true); }}
              showErrors={showErrors}
            />
          )}
          {showErrors && problem && <p className="mt-3 text-xs text-destructive">{problem}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={isPending || isLoading}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save questions
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
