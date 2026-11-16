"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAddHomework } from "@/hooks/useFirstDays";
import type { FirstDaysView } from "@/types";

export const DOC_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*";

const fmtDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));

/** What the joiner will see, for the day picked. */
export function whenText(day: string, today: string, who: string) {
  if (day < today) return `A day already gone — ${who} can answer it today, and it's due today.`;
  if (day > today) return `${who} will see it on ${fmtDay(day)} and answer it that day.`;
  return `${who} can answer it today.`;
}

interface Props {
  view: FirstDaysView;
  /** The day the form opens on; null keeps it closed. */
  day: string | null;
  onClose: () => void;
}

/**
 * A homework for one joiner: a title, which of their fifteen days it is for,
 * and the question document — required, since there is nothing to answer
 * without it.
 */
export function AddHomeworkDialog({ view, day: openOn, onClose }: Props) {
  const add = useAddHomework();
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(view.today);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const first = view.employee.name.split(" ")[0] || view.employee.name;

  useEffect(() => {
    if (openOn === null) return;
    setTitle(""); setDay(openOn); setFile(null); setError(null);
  }, [openOn]);

  const submit = () => {
    setError(null);
    if (!title.trim()) { setError("Give the homework a title"); return; }
    if (!file) { setError("Choose the question document"); return; }
    add.mutate({ employeeId: view.employee._id, title: title.trim(), day, file }, { onSuccess: onClose });
  };

  return (
    <ResponsiveDialog open={openOn !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Add homework</ResponsiveDialogTitle></ResponsiveDialogHeader>
        <div className="min-w-0 space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="hw-title">Title</Label>
            <Input id="hw-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Objection handling — fees" />
          </div>
          <div className="space-y-1.5">
            <Label>For which day</Label>
            <Select value={day} onValueChange={setDay}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {view.homework.days.map((d) => (
                  <SelectItem key={d.key} value={d.key}>
                    {d.key === view.today ? "Today · " : ""}Day {d.number} · {fmtDay(d.key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{whenText(day, view.today, first)}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Question document</Label>
            <input ref={input} type="file" className="hidden" accept={DOC_ACCEPT}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setFile(f); }} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={add.isPending}>
                <Upload className="h-3.5 w-3.5" />{file ? "Choose another" : "Choose file"}
              </Button>
              {file && <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{file.name}</span></span>}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={add.isPending}>
            {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Send to {first}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
