"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Upload, Video } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAddHomework, type HomeworkKind } from "@/hooks/useFirstDays";
import { VideoSourceToggle, VimeoPicker, type VideoSource } from "@/components/firstDays/VimeoPicker";
import { cn } from "@/lib/utils";
import type { FirstDaysView, VimeoVideo } from "@/types";

import { DOC_ACCEPT, MAX_DOC_MB, MAX_FILES, PickedFiles } from "@/components/firstDays/FirstDaysFiles";
import { FolderField } from "@/components/firstDays/Folders";
export { DOC_ACCEPT };
export const VIDEO_ACCEPT = "video/mp4,.mp4";
/** The server's limit for a homework video. */
export const MAX_VIDEO_MB = 250;

/** Document or video: what the homework is, and so what the joiner does with it. */
export function KindPicker({ kind, onChange, disabled }: { kind: HomeworkKind; onChange: (k: HomeworkKind) => void; disabled?: boolean }) {
  const opts: { k: HomeworkKind; label: string; hint: string; icon: React.ElementType }[] = [
    { k: "document", label: "Document", hint: "They upload an answer", icon: FileText },
    { k: "video", label: "Video", hint: "Watched in full, then written up", icon: Video },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {opts.map((o) => (
        <button key={o.k} type="button" disabled={disabled} onClick={() => onChange(o.k)}
          className={cn("rounded-lg border px-3 py-2 text-left text-sm transition", kind === o.k ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50")}>
          <div className="flex items-center gap-1.5 font-medium"><o.icon className="h-4 w-4" />{o.label}</div>
          <div className="text-xs text-muted-foreground">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}

/** A file the form will send, refused here if it is not what the kind needs. */
export function checkFile(kind: HomeworkKind, f: File): string | null {
  if (kind !== "video") return null;
  if (f.type !== "video/mp4" && !f.name.toLowerCase().endsWith(".mp4")) return "The video must be an MP4.";
  if (f.size > MAX_VIDEO_MB * 1024 * 1024) return `The video is too large — ${MAX_VIDEO_MB} MB at most.`;
  return null;
}

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
  /** Folder names to offer — those on this guide, and on the others this person sees. */
  folderOptions?: string[];
}

/**
 * Documents chosen for a homework, added to those already picked: up to the
 * cap, each within the size limit. Returns the new list, or the reason not.
 */
export function addDocs(current: File[], picked: File[]): { files: File[]; error: string | null } {
  const big = picked.find((f) => f.size > MAX_DOC_MB * 1024 * 1024);
  if (big) return { files: current, error: `“${big.name}” is over ${MAX_DOC_MB} MB.` };
  const files = [...current, ...picked];
  if (files.length > MAX_FILES) return { files: current, error: `Up to ${MAX_FILES} files.` };
  return { files, error: null };
}

/**
 * A homework for one joiner: a document or a video, a title, which of their
 * fifteen days it is for, a folder if it belongs in one, and the files —
 * required, since there is nothing to answer without them. A document
 * homework takes several question files; a video is one, uploaded or picked
 * from the company's Vimeo folder.
 */
export function AddHomeworkDialog({ view, day: openOn, onClose, folderOptions = [] }: Props) {
  const add = useAddHomework();
  const [kind, setKind] = useState<HomeworkKind>("document");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(view.today);
  const [file, setFile] = useState<File | null>(null);
  const [docs, setDocs] = useState<File[]>([]);
  const [folder, setFolder] = useState("");
  const [source, setSource] = useState<VideoSource>("upload");
  const [vimeo, setVimeo] = useState<VimeoVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const first = view.employee.name.split(" ")[0] || view.employee.name;
  const fromVimeo = kind === "video" && source === "vimeo";

  useEffect(() => {
    if (openOn === null) return;
    setKind("document"); setTitle(""); setDay(openOn); setFile(null); setDocs([]); setFolder(""); setSource("upload"); setVimeo(null); setError(null); setSent(null);
  }, [openOn]);
  const folders = Array.from(new Set([...view.homework.folders, ...folderOptions]));

  const pickKind = (k: HomeworkKind) => { if (k !== kind) { setKind(k); setFile(null); setDocs([]); setError(null); } };
  const pickVimeo = (v: VimeoVideo) => { setVimeo(v); setError(null); if (!title.trim()) setTitle(v.name.slice(0, 160)); };
  const submit = () => {
    setError(null);
    if (!title.trim()) { setError("Give the homework a title"); return; }
    if (fromVimeo ? !vimeo : kind === "video" ? !file : !docs.length) {
      setError(fromVimeo ? "Pick a video from the Vimeo folder" : kind === "video" ? "Choose the video" : "Choose the question documents"); return;
    }
    setSent(kind === "video" && !fromVimeo ? 0 : null);
    add.mutate(
      {
        employeeId: view.employee._id, title: title.trim(), day, kind, folder: folder.trim(),
        ...(fromVimeo ? { vimeoId: vimeo!.id } : kind === "video" ? { file, onProgress: setSent } : { files: docs }),
      },
      { onSuccess: onClose, onSettled: () => setSent(null) }
    );
  };

  return (
    <ResponsiveDialog open={openOn !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Add homework</ResponsiveDialogTitle></ResponsiveDialogHeader>
        <div className="min-w-0 space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <KindPicker kind={kind} onChange={pickKind} disabled={add.isPending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hw-title">Title</Label>
            <Input id="hw-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Objection handling — fees" />
          </div>
          <FolderField value={folder} onChange={setFolder} options={folders} disabled={add.isPending} />
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
          {kind === "video" && (
            <div className="space-y-1.5">
              <Label>The video</Label>
              <VideoSourceToggle source={source} onChange={(s) => { setSource(s); setError(null); }} disabled={add.isPending} />
            </div>
          )}
          {fromVimeo ? (
            <div className="space-y-1.5">
              <VimeoPicker value={vimeo} onPick={pickVimeo} disabled={add.isPending} />
              <p className="text-xs text-muted-foreground">{first} watches it inside HRMS and can go back but not skip ahead; once it&apos;s watched to the end, they write what they learned.</p>
            </div>
          ) : kind === "document" ? (
          <div className="space-y-1.5">
            <Label>Question files</Label>
            <input ref={input} type="file" className="hidden" accept={DOC_ACCEPT} multiple
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []); e.target.value = "";
                if (!picked.length) return;
                const next = addDocs(docs, picked);
                setDocs(next.files); setError(next.error);
              }} />
            <PickedFiles files={docs} disabled={add.isPending} onRemove={(i) => setDocs((d) => d.filter((_, j) => j !== i))} />
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={add.isPending || docs.length >= MAX_FILES}>
              <Upload className="h-3.5 w-3.5" />{docs.length ? "Add more files" : "Choose files"}
            </Button>
            <p className="text-xs text-muted-foreground">Up to {MAX_FILES} — documents, sheets, slides or images, {MAX_DOC_MB} MB each.</p>
          </div>
          ) : (
          <div className="space-y-1.5">
            <Label>{`Video (MP4, up to ${MAX_VIDEO_MB} MB)`}</Label>
            <input ref={input} type="file" className="hidden" accept={VIDEO_ACCEPT}
              onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = "";
                if (!f) return;
                const bad = checkFile(kind, f);
                if (bad) { setError(bad); setFile(null); } else { setError(null); setFile(f); }
              }} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={add.isPending}>
                <Upload className="h-3.5 w-3.5" />{file ? "Choose another" : "Choose file"}
              </Button>
              {file && <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm">
                {kind === "video" ? <Video className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
                <span className="truncate">{file.name}</span>
                {kind === "video" && <span className="shrink-0 text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(file.size < 10 * 1024 * 1024 ? 1 : 0)} MB</span>}
              </span>}
            </div>
            {kind === "video" && <p className="text-xs text-muted-foreground">{first} can go back but not skip ahead; once it&apos;s watched to the end, they write what they learned.</p>}
          </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={add.isPending}>
            {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {add.isPending && sent !== null && sent < 100 ? `Uploading ${sent}%` : `Send to ${first}`}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
