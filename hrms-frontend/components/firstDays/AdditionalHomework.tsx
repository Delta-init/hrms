"use client";
import { useRef, useState } from "react";
import { Download, ExternalLink, FileText, Link2, Loader2, MessageSquare, PlayCircle, Plus, Upload, Video, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_VIDEO_MB } from "@/components/firstDays/AddHomeworkDialog";
import { MAX_FILES, PickedFiles } from "@/components/firstDays/FirstDaysFiles";
import { FolderField, FolderHeading, MoveToFolder, groupByFolder } from "@/components/firstDays/Folders";
import { useAddExtra, useAddToExtra, useExtraFeedback, useMoveExtra, useRemoveFromExtra } from "@/hooks/useFirstDays";
import { cn } from "@/lib/utils";
import type { FirstDaysExtra, FirstDaysView } from "@/types";

/** What phones record in — MP4, an iPhone's MOV, WebM — and the slides or documents that go with it. */
const EXTRA_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.txt,image/*";
const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
const withDownload = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download`;

/**
 * Additional homework: the joiner's own presentation videos — and the slides
 * that go with them — handed in on any day of their fifteen, several files and
 * links to each, grouped in folders of their own. Optional, so never counted.
 * Their head and HR watch it and can leave feedback.
 */
export function AdditionalHomework({ view }: { view: FirstDaysView }) {
  const extras = view.extras;
  const joiner = view.viewer.isJoiner;
  const [adding, setAdding] = useState(false);
  if (!extras || (!joiner && !extras.items.length)) return null;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional homework</h3>
        {extras.canAdd && (
          <Button size="sm" variant="outline" className="h-8" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" />Add additional homework</Button>
        )}
      </div>
      {extras.items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          {extras.canAdd
            ? "Optional — hand in your presentation videos and slides here on any day, and your department head can give you feedback."
            : "Nothing handed in."}
        </p>
      ) : groupByFolder(extras.items).map((g) => (
        <div key={g.folder || "-"} className="space-y-2">
          {g.folder && <FolderHeading name={g.folder} count={g.items.length} />}
          {g.items.map((x) => <ExtraRow key={x.id} item={x} view={view} />)}
        </div>
      ))}
      {adding && <ExtraForm folders={extras.folders} onClose={() => setAdding(false)} />}
    </section>
  );
}

function ExtraRow({ item: x, view }: { item: FirstDaysExtra; view: FirstDaysView }) {
  const joiner = view.viewer.isJoiner;
  const remove = useRemoveFromExtra();
  const move = useMoveExtra();
  const [watching, setWatching] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const given = x.feedback.length > 0;
  const count = x.files.length + x.links.length;
  // One always stays: the last file or link can't be taken out.
  const canTrim = x.can.includes("remove") && count > 1;
  const playing = x.files.find((f) => f.key === watching);
  const take = (what: { key?: string; link?: string }, id: string) => {
    setRemoving(id);
    remove.mutate({ extraId: x.id, ...what }, { onSettled: () => setRemoving(null) });
  };

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start gap-2">
        <Video className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {x.title}
            <span className="font-normal text-muted-foreground"> · Day {x.dayNumber}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {/* A batch's files arrive a moment apart; only a later addition counts as "added to". */}
            {x.updatedAt && x.addedAt && Date.parse(x.updatedAt) - Date.parse(x.addedAt) > 5 * 60 * 1000
              ? `Handed in ${fmtDate(x.addedAt)} · last added to ${fmtDate(x.updatedAt)}`
              : `Handed in ${fmtDate(x.addedAt)}`}
          </p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
          given ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
          {given ? "Feedback given" : joiner ? "Waiting for feedback" : "No feedback yet"}
        </span>
      </div>

      <div className="mt-3 space-y-3 pl-6">
        {playing && (
          <div className="space-y-1.5">
            <video key={playing.key} src={playing.url} controls autoPlay playsInline preload="metadata" className="max-h-96 w-full rounded-lg bg-black"
              onError={() => setUnplayable(true)} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-7" onClick={() => { setWatching(null); setUnplayable(false); }}><X className="h-3.5 w-3.5" />Close the video</Button>
              {unplayable && <span className="text-xs text-muted-foreground">This browser can&apos;t play this format — download it to watch.</span>}
            </div>
          </div>
        )}
        <ul className="space-y-1.5">
          {x.files.map((f) => (
            <li key={f.key} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              {f.isVideo ? <Video className="h-4 w-4 shrink-0 text-muted-foreground" /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {f.isVideo
                ? <Button size="sm" variant="ghost" className="h-7" onClick={() => { setWatching(f.key); setUnplayable(false); }}><PlayCircle className="h-3.5 w-3.5" />Watch</Button>
                : <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-muted"><ExternalLink className="h-3.5 w-3.5" />Open</a>}
              <a href={withDownload(f.url)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted"><Download className="h-3.5 w-3.5" />Download</a>
              {canTrim && (
                <button type="button" onClick={() => take({ key: f.key }, f.key)} disabled={removing === f.key} aria-label={`Remove ${f.name}`}
                  className="text-muted-foreground hover:text-destructive">{removing === f.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}</button>
              )}
            </li>
          ))}
          {x.links.map((l) => (
            <li key={l.url} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">Open on {l.host}</a>
              {canTrim && (
                <button type="button" onClick={() => take({ link: l.url }, l.url)} disabled={removing === l.url} aria-label="Remove the link"
                  className="text-muted-foreground hover:text-destructive">{removing === l.url ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}</button>
              )}
            </li>
          ))}
        </ul>
        {x.can.includes("addFiles") && (
          <div className="flex flex-wrap items-center gap-1">
            {count < MAX_FILES && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Upload className="h-3.5 w-3.5" />Add files or a link</Button>}
            {x.can.includes("move") && (
              <MoveToFolder current={x.folder} options={view.extras.folders} busy={move.isPending}
                onMove={(folder, done) => move.mutate({ extraId: x.id, folder }, { onSuccess: done })} />
            )}
          </div>
        )}

        {given && (
          <ul className="space-y-1.5">
            {x.feedback.map((f, i) => (
              <li key={i} className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <span className="font-medium">{f.byName}</span>
                <span className="text-xs text-muted-foreground"> · {fmtDate(f.at)}</span>
                <p className="mt-0.5 whitespace-pre-wrap">{f.text}</p>
              </li>
            ))}
          </ul>
        )}
        {x.can.includes("feedback") && <FeedbackBox employeeId={view.employee._id} extraId={x.id} />}
      </div>
      {adding && <ExtraForm extra={x} folders={view.extras.folders} onClose={() => setAdding(false)} />}
    </div>
  );
}

function FeedbackBox({ employeeId, extraId }: { employeeId: string; extraId: string }) {
  const send = useExtraFeedback();
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <Textarea rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="What went well, and what to work on next time." />
      <Button size="sm" variant="outline" disabled={text.trim().length < 2 || send.isPending}
        onClick={() => send.mutate({ employeeId, extraId, text: text.trim() }, { onSuccess: () => setText("") })}>
        {send.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}Send feedback
      </Button>
    </div>
  );
}

/**
 * Hand in an additional homework — title, folder, files and/or a link — or
 * add files or a link to one already there. Files go up one at a time.
 */
function ExtraForm({ extra, folders, onClose }: { extra?: FirstDaysExtra; folders: string[]; onClose: () => void }) {
  const add = useAddExtra();
  const addTo = useAddToExtra();
  const busy = add.isPending || addTo.isPending;
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const already = extra ? extra.files.length + extra.links.length : 0;
  const room = MAX_FILES - already - files.length - (link.trim() ? 1 : 0);

  const pick = (picked: File[]) => {
    const big = picked.find((f) => f.size > MAX_VIDEO_MB * 1024 * 1024);
    if (big) { setError(`“${big.name}” is over ${MAX_VIDEO_MB} MB — put it on Google Drive, YouTube or Vimeo and paste the link instead.`); return; }
    if (picked.length > room) { setError(`Up to ${MAX_FILES} files and links in all.`); return; }
    setError(null); setFiles((fs) => [...fs, ...picked]);
  };
  const submit = () => {
    setError(null);
    if (!extra && !title.trim()) { setError("Give it a title"); return; }
    if (!files.length && !link.trim()) { setError("Choose a file, or paste a link"); return; }
    const input = { files, link: link.trim() || undefined, onProgress: files.length ? setPct : undefined };
    setPct(files.length ? 0 : null);
    const done = { onSuccess: onClose, onSettled: () => setPct(null) };
    if (extra) addTo.mutate({ extraId: extra.id, ...input }, done);
    else add.mutate({ title: title.trim(), folder: folder.trim(), ...input }, done);
  };

  return (
    <ResponsiveDialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{extra ? `Add to “${extra.title}”` : "Add additional homework"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="min-w-0 space-y-4 px-4 sm:px-0">
          {!extra && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="extra-title">Title</Label>
                <Input id="extra-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. My sales pitch presentation" />
              </div>
              <FolderField value={folder} onChange={setFolder} options={folders} disabled={busy} />
            </>
          )}
          <div className="space-y-1.5">
            <Label>Files</Label>
            <input ref={input} type="file" className="hidden" accept={EXTRA_ACCEPT} multiple
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) pick(fs); }} />
            <PickedFiles files={files} disabled={busy} onRemove={(i) => setFiles((fs) => fs.filter((_, j) => j !== i))} />
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy || room <= 0}>
              <Upload className="h-3.5 w-3.5" />{files.length ? "Add more files" : "Choose files"}
            </Button>
            <p className="text-xs text-muted-foreground">Videos (MP4 or MOV from your phone, up to {MAX_VIDEO_MB} MB each) and slides or documents.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="extra-link">Or a link <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="extra-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/file/d/…" inputMode="url" disabled={busy} />
            <p className="text-xs text-muted-foreground">Google Drive, YouTube or Vimeo — for a video too big to upload. Make sure anyone with the link can view it.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy && pct !== null && pct < 100 ? `Uploading ${pct}%` : extra ? "Add" : "Hand in"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
