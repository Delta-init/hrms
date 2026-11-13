"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Upload, XCircle } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useSendHomeworkToMany, type HomeworkDay } from "@/hooks/useFirstDays";
import { cn } from "@/lib/utils";
import type { FirstDaysView, HomeworkSendResult } from "@/types";

const DOC_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The joiners this person looks after — the server still checks each one. */
  joiners: FirstDaysView[];
}

/** What a joiner already has for that day, to show beside their name. */
function current(v: FirstDaysView, day: HomeworkDay) {
  const step = v.steps.find((s) => s.key === (day === 2 ? "homework2" : "homework"));
  if (!step) return null;
  return step.file ? `has “${step.file.name}”` : null;
}

/**
 * The same homework to several new joiners in one go — one file, chosen once,
 * for the day-1 or the day-2 homework. A joiner who already has one gets it
 * replaced and is told; what they handed in still counts.
 */
export function SendHomeworkDialog({ open, onOpenChange, joiners }: Props) {
  const send = useSendHomeworkToMany();
  const [day, setDay] = useState<HomeworkDay>(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<HomeworkSendResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Only joiners this person can send homework to (the server says so per step).
  const eligible = useMemo(
    () => joiners.filter((v) => v.steps.some((s) => s.key === (day === 2 ? "homework2" : "homework") && (s.can.includes("send") || s.can.includes("replace")))),
    [joiners, day]
  );

  useEffect(() => {
    if (!open) return;
    setDay(1); setFile(null); setResults(null); setError(null);
  }, [open]);
  // Default to everyone who has nothing for that day yet — chosen when the
  // dialog opens or the day changes, not every time the list refreshes behind
  // it, which would wipe the choice and the results of a send just made.
  const eligibleRef = useRef(eligible);
  eligibleRef.current = eligible;
  useEffect(() => {
    if (!open) return;
    setPicked(new Set(eligibleRef.current.filter((v) => !current(v, day)).map((v) => v.employee._id)));
    setResults(null);
  }, [open, day]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = eligible.length > 0 && eligible.every((v) => picked.has(v.employee._id));

  const submit = () => {
    setError(null);
    if (!picked.size) { setError("Pick at least one new joiner"); return; }
    if (!file) { setError("Choose the homework file"); return; }
    // All sent: done, and the toast says so. Any refused: stay open and say who and why.
    send.mutate({ employeeIds: Array.from(picked), file, day }, {
      onSuccess: ({ results: r }) => { if (r.every((x) => x.ok)) onOpenChange(false); else setResults(r); },
    });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Send homework to several</ResponsiveDialogTitle></ResponsiveDialogHeader>
        <div className="min-w-0 space-y-5 px-4 sm:px-0">
          <div className="space-y-2">
            <Label>Which homework</Label>
            <div className="grid grid-cols-2 gap-2">
              {([1, 2] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDay(d)}
                  className={cn("rounded-lg border px-3 py-2 text-left text-sm transition", day === d ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50")}>
                  <div className="font-medium">Day {d}</div>
                  <div className="text-xs text-muted-foreground">{d === 1 ? "Handed back on day 2" : "Optional · handed back on day 3"}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>New joiners</Label>
              {eligible.length > 1 && (
                <button type="button" className="text-xs text-primary hover:underline"
                  onClick={() => setPicked(allOn ? new Set() : new Set(eligible.map((v) => v.employee._id)))}>
                  {allOn ? "Clear all" : "Select all"}
                </button>
              )}
            </div>
            {eligible.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody you look after is waiting for this homework.</p>
            ) : (
              <div className="max-h-64 min-w-0 space-y-1 overflow-y-auto overflow-x-hidden rounded-lg border p-2">
                {eligible.map((v) => {
                  const id = v.employee._id;
                  const has = current(v, day);
                  const r = results?.find((x) => x.employeeId === id);
                  return (
                    <label key={id} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                      <Checkbox checked={picked.has(id)} onCheckedChange={() => toggle(id)} disabled={send.isPending} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{v.employee.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[v.employee.department?.name, v.redActive ? `day ${v.day}` : null].filter(Boolean).join(" · ")}
                          {has ? ` · ${has} — will be replaced` : ""}
                        </div>
                      </div>
                      {r && (r.ok
                        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Sent" />
                        : <span className="flex shrink-0 items-center gap-1 text-xs text-destructive"><XCircle className="h-4 w-4" />{r.message}</span>)}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>File</Label>
            <input ref={input} type="file" className="hidden" accept={DOC_ACCEPT}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setFile(f); setResults(null); } }} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={send.isPending}>
                <Upload className="h-3.5 w-3.5" />{file ? "Choose another" : "Choose file"}
              </Button>
              {file && <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{file.name}</span></span>}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{results ? "Close" : "Cancel"}</Button>
          <Button onClick={submit} disabled={send.isPending || eligible.length === 0}>
            {send.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Send to {picked.size} {picked.size === 1 ? "joiner" : "joiners"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
