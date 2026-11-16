"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Upload, XCircle } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DOC_ACCEPT } from "@/components/firstDays/AddHomeworkDialog";
import { useAddHomeworkToMany } from "@/hooks/useFirstDays";
import type { FirstDaysView, HomeworkSendResult } from "@/types";

const DAY_MS = 86_400_000;
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const fmtDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
/** Which of their fifteen days a date is for this joiner. */
const dayOf = (v: FirstDaysView, key: string) => Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${v.startDay}T00:00:00Z`)) / DAY_MS) + 1;
const setThatDay = (v: FirstDaysView, key: string) => v.homework.items.filter((h) => !h.placeholder && h.day === key).length;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The joiners this person looks after — the server still checks each one. */
  joiners: FirstDaysView[];
}

/**
 * The same homework to several new joiners in one go — one title, one date,
 * one question document. Each joiner gets it as that date's homework in their
 * own fifteen days, so only those whose fifteen days include the date are listed.
 */
export function SendHomeworkDialog({ open, onOpenChange, joiners }: Props) {
  const send = useAddHomeworkToMany();
  const canAdd = useMemo(() => joiners.filter((v) => v.homework?.canAdd), [joiners]);
  // From today to the last day anyone here can still be set homework.
  const dates = useMemo(() => {
    if (!canAdd.length) return [];
    const today = canAdd.reduce((m, v) => (v.today < m ? v.today : m), canAdd[0].today);
    const last = canAdd.reduce((m, v) => (v.endDay > m ? v.endDay : m), canAdd[0].endDay);
    const out: string[] = [];
    for (let k = today; k <= last && out.length < 30; k = addDays(k, 1)) out.push(k);
    return out;
  }, [canAdd]);
  const today = dates[0] ?? "";

  const [day, setDay] = useState("");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<HomeworkSendResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const eligible = useMemo(() => canAdd.filter((v) => v.startDay <= day && day <= v.endDay), [canAdd, day]);

  useEffect(() => {
    if (!open) return;
    setDay(today); setTitle(""); setFile(null); setResults(null); setError(null);
    // Only on opening: a refresh behind the form must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Everyone with nothing yet for that date, chosen when the dialog opens or
  // the date changes — not on every refresh, which would wipe the choice and
  // the results of a send just made.
  const eligibleRef = useRef(eligible);
  eligibleRef.current = eligible;
  useEffect(() => {
    if (!open) return;
    setPicked(new Set(eligibleRef.current.filter((v) => !setThatDay(v, day)).map((v) => v.employee._id)));
    setResults(null);
  }, [open, day]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = eligible.length > 0 && eligible.every((v) => picked.has(v.employee._id));
  const chosen = eligible.filter((v) => picked.has(v.employee._id)).map((v) => v.employee._id);

  const submit = () => {
    setError(null);
    if (!title.trim()) { setError("Give the homework a title"); return; }
    if (!chosen.length) { setError("Pick at least one new joiner"); return; }
    if (!file) { setError("Choose the question document"); return; }
    // All sent: done, and the toast says so. Any refused: stay open and say who and why.
    send.mutate({ employeeIds: chosen, title: title.trim(), day, file }, {
      onSuccess: ({ results: r }) => { if (r.every((x) => x.ok)) onOpenChange(false); else setResults(r); },
    });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Send homework to several</ResponsiveDialogTitle></ResponsiveDialogHeader>
        <div className="min-w-0 space-y-5 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="hw-many-title">Title</Label>
            <Input id="hw-many-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Objection handling — fees" />
          </div>

          <div className="space-y-1.5">
            <Label>For which day</Label>
            <Select value={day} onValueChange={setDay} disabled={!dates.length}>
              <SelectTrigger><SelectValue placeholder="No dates left" /></SelectTrigger>
              <SelectContent>
                {dates.map((k, i) => (
                  <SelectItem key={k} value={k}>{i === 0 ? "Today · " : i === 1 ? "Tomorrow · " : ""}{fmtDay(k)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {day > today ? `They'll see it on ${fmtDay(day)} and answer it that day.` : "They can answer it today."}
            </p>
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
              <p className="text-sm text-muted-foreground">Nobody you look after is in their fifteen days on that date.</p>
            ) : (
              <div className="max-h-64 min-w-0 space-y-1 overflow-y-auto overflow-x-hidden rounded-lg border p-2">
                {eligible.map((v) => {
                  const id = v.employee._id;
                  const has = setThatDay(v, day);
                  const r = results?.find((x) => x.employeeId === id);
                  return (
                    <label key={id} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                      <Checkbox checked={picked.has(id)} onCheckedChange={() => toggle(id)} disabled={send.isPending} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{v.employee.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[v.employee.department?.name, `their day ${dayOf(v, day)}`].filter(Boolean).join(" · ")}
                          {has ? ` · already has ${has} that day` : ""}
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
            <Label>Question document</Label>
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
            Send to {chosen.length} {chosen.length === 1 ? "joiner" : "joiners"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
