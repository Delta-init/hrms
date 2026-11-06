"use client";
import { useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  MAX_QUESTIONS, blankQuestion, downloadQuestionsTemplate, isBlankQuestion, questionErrors, readQuestionsFile,
} from "@/lib/interviewQuestions";
import type { InterviewQuestion } from "@/types";

/**
 * The questions the panel will ask, each with the answer a good candidate
 * gives and the marks it is worth.
 *
 * Typed in here, or filled into the Excel template and imported — imported
 * rows land in the same boxes, to be read over before anything is saved.
 * Errors show once `showErrors` is set, which the form does on its first
 * attempt to save: a red box before anyone has typed is just noise.
 */
export function InterviewQuestionsEditor({ value, onChange, showErrors = false }: {
  value: InterviewQuestion[];
  onChange: (next: InterviewQuestion[]) => void;
  showErrors?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const errors = questionErrors(value);
  const kept = value.filter((q) => !isBlankQuestion(q));
  const totalMarks = kept.reduce((n, q) => n + (Number.isFinite(q.maxMarks) ? q.maxMarks : 0), 0);

  const set = (i: number, patch: Partial<InterviewQuestion>) =>
    onChange(value.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const remove = (i: number) => onChange(value.length === 1 ? [blankQuestion()] : value.filter((_, j) => j !== i));
  const move = (i: number, by: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const { questions, problems: found } = await readQuestionsFile(file);
      const merged = [...kept, ...questions];
      const notes = [...found];
      if (merged.length > MAX_QUESTIONS) notes.push(`Only the first ${MAX_QUESTIONS} questions were kept`);
      setProblems(notes);
      if (questions.length) {
        onChange(merged.slice(0, MAX_QUESTIONS));
        toast.success(`Imported ${questions.length} question${questions.length === 1 ? "" : "s"} — read them over before saving`);
      } else if (!found.length) {
        toast.error("No questions found. Use the template's columns: Question, Expected answer, Max marks.");
      }
    } catch {
      toast.error("Could not read that file. Save it as .xlsx or .csv and try again.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {kept.length} question{kept.length === 1 ? "" : "s"} · {totalMarks} mark{totalMarks === 1 ? "" : "s"} in total
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={downloadQuestionsTemplate}>
            <Download className="h-3.5 w-3.5" />Excel template
          </Button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }}
          />
          <Button type="button" variant="outline" size="sm" disabled={importing} onClick={() => fileInput.current?.click()}>
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}Import from Excel
          </Button>
        </div>
      </div>

      {problems.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium">Some rows were left out</p>
            <ul className="mt-1 list-disc pl-4">
              {problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}
              {problems.length > 6 && <li>and {problems.length - 6} more</li>}
            </ul>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {value.map((q, i) => {
          const e = showErrors && !(value.length > 1 && isBlankQuestion(q)) ? errors[i] : {};
          return (
            <div key={q._id ?? `new-${i}`} className="rounded-xl border border-border bg-muted/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Question {i + 1}</span>
                <div className="flex items-center gap-0.5">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(i)} aria-label={`Remove question ${i + 1}`}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_6rem]">
                <div className="space-y-1">
                  <Label htmlFor={`q-${i}`} className="text-xs">Question</Label>
                  <Textarea id={`q-${i}`} rows={2} maxLength={1000} value={q.question}
                    className={cn(e.question && "border-destructive")}
                    placeholder="What will the panel ask?"
                    onChange={(ev) => set(i, { question: ev.target.value })} />
                  {e.question && <p className="text-[11px] text-destructive">{e.question}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`a-${i}`} className="text-xs">Expected answer</Label>
                  <Textarea id={`a-${i}`} rows={2} maxLength={4000} value={q.expectedAnswer}
                    className={cn(e.expectedAnswer && "border-destructive")}
                    placeholder="What a good answer covers"
                    onChange={(ev) => set(i, { expectedAnswer: ev.target.value })} />
                  {e.expectedAnswer && <p className="text-[11px] text-destructive">{e.expectedAnswer}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`m-${i}`} className="text-xs">Max marks</Label>
                  <Input id={`m-${i}`} type="number" min={1} max={100} step={1} inputMode="numeric"
                    value={Number.isFinite(q.maxMarks) && q.maxMarks !== 0 ? q.maxMarks : ""}
                    className={cn(e.maxMarks && "border-destructive")}
                    onChange={(ev) => set(i, { maxMarks: ev.target.value === "" ? 0 : Number(ev.target.value) })} />
                  {e.maxMarks && <p className="text-[11px] text-destructive">{e.maxMarks}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Button type="button" variant="outline" size="sm" disabled={value.length >= MAX_QUESTIONS}
        onClick={() => onChange([...value, blankQuestion()])}>
        <Plus className="h-3.5 w-3.5" />Add question
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Every interview round asks all of these. Each interviewer writes down what the candidate said and gives marks out of
        the maximum. Expected answers are shown only to the interview panel, HR and you.
      </p>
    </div>
  );
}
