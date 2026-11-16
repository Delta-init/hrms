"use client";
import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Link2, Loader2, MessageSquare, PlayCircle, Plus, Upload, Video, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_VIDEO_MB } from "@/components/firstDays/AddHomeworkDialog";
import { useAddExtra, useExtraFeedback, useExtraNewVersion } from "@/hooks/useFirstDays";
import { cn } from "@/lib/utils";
import type { FirstDaysExtra, FirstDaysView } from "@/types";

/** What phones record in: MP4, an iPhone's MOV, WebM. */
const CLIP_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm";
const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
const withDownload = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download`;

/**
 * Additional homework: the joiner's own presentation videos, handed in on any
 * day of their fifteen — uploaded, or linked from Google Drive, YouTube or
 * Vimeo. Optional, so never counted. Their head and HR watch it and can leave
 * feedback; the joiner can hand in a new version.
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
            ? "Optional — hand in your presentation video here on any day, and your department head can give you feedback."
            : "Nothing handed in."}
        </p>
      ) : extras.items.map((x) => <ExtraRow key={x.id} item={x} view={view} />)}
      {adding && <ExtraForm onClose={() => setAdding(false)} />}
    </section>
  );
}

function ExtraRow({ item: x, view }: { item: FirstDaysExtra; view: FirstDaysView }) {
  const joiner = view.viewer.isJoiner;
  const [watching, setWatching] = useState(false);
  const [unplayable, setUnplayable] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const given = x.feedback.length > 0;
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
            {x.versions > 1 ? `Version ${x.versions}, handed in ${fmtDate(x.updatedAt)}` : `Handed in ${fmtDate(x.addedAt)}`}
          </p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
          given ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
          {given ? "Feedback given" : joiner ? "Waiting for feedback" : "No feedback yet"}
        </span>
      </div>

      <div className="mt-3 space-y-3 pl-6">
        {x.video && (watching ? (
          <div className="space-y-1.5">
            <video src={x.video.url} controls autoPlay playsInline preload="metadata" className="max-h-96 w-full rounded-lg bg-black"
              onError={() => setUnplayable(true)} />
            {unplayable && <p className="text-xs text-muted-foreground">This browser can&apos;t play this format — download it to watch.</p>}
          </div>
        ) : null)}
        <div className="flex flex-wrap items-center gap-2">
          {x.video && (
            <>
              <Button size="sm" variant={watching ? "outline" : "default"} onClick={() => setWatching((w) => !w)}>
                {watching ? <><X className="h-3.5 w-3.5" />Close the video</> : <><PlayCircle className="h-3.5 w-3.5" />Watch</>}
              </Button>
              <a href={withDownload(x.video.url)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs hover:bg-muted">
                <Download className="h-3.5 w-3.5" />Download
              </a>
            </>
          )}
          {x.link && (
            <a href={x.link.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-primary hover:bg-muted">
              <ExternalLink className="h-3.5 w-3.5" />Open on {x.link.host}
            </a>
          )}
          {x.can.includes("newVersion") && (
            <Button size="sm" variant="outline" onClick={() => setVersioning(true)}><Upload className="h-3.5 w-3.5" />Upload a new version</Button>
          )}
        </div>

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
      {versioning && <ExtraForm extra={x} onClose={() => setVersioning(false)} />}
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

/** Hand in a presentation, or a new version of one: an uploaded video, or a link to it. */
function ExtraForm({ extra, onClose }: { extra?: FirstDaysExtra; onClose: () => void }) {
  const add = useAddExtra();
  const version = useExtraNewVersion();
  const busy = add.isPending || version.isPending;
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setError(null); }, [mode]);

  const pick = (f: File) => {
    if (f.size > MAX_VIDEO_MB * 1024 * 1024) { setError(`That video is over ${MAX_VIDEO_MB} MB — put it on Google Drive, YouTube or Vimeo and paste the link instead.`); return; }
    setError(null); setFile(f);
  };
  const submit = () => {
    setError(null);
    if (!extra && !title.trim()) { setError("Give it a title"); return; }
    if (mode === "upload" ? !file : !link.trim()) { setError(mode === "upload" ? "Choose your video" : "Paste the link"); return; }
    const input = mode === "upload" ? { file, onProgress: setPct } : { link: link.trim() };
    setPct(mode === "upload" ? 0 : null);
    const done = { onSuccess: onClose, onSettled: () => setPct(null) };
    if (extra) version.mutate({ extraId: extra.id, ...input }, done);
    else add.mutate({ title: title.trim(), ...input }, done);
  };

  return (
    <ResponsiveDialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{extra ? `New version of “${extra.title}”` : "Add additional homework"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="min-w-0 space-y-4 px-4 sm:px-0">
          {!extra && (
            <div className="space-y-1.5">
              <Label htmlFor="extra-title">Title</Label>
              <Input id="extra-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. My sales pitch presentation" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Your presentation video</Label>
            <div className="grid grid-cols-2 gap-2">
              {([["upload", "Upload a video", Upload], ["link", "Paste a link", Link2]] as const).map(([m, label, Icon]) => (
                <button key={m} type="button" disabled={busy} onClick={() => setMode(m)}
                  className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-sm transition", mode === m ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50")}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </div>
          </div>
          {mode === "upload" ? (
            <div className="space-y-1.5">
              <input ref={input} type="file" className="hidden" accept={CLIP_ACCEPT}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }} />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
                  <Upload className="h-3.5 w-3.5" />{file ? "Choose another" : "Choose video"}
                </Button>
                {file && <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm">
                  <Video className="h-4 w-4 shrink-0" /><span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(file.size < 10 * 1024 * 1024 ? 1 : 0)} MB</span>
                </span>}
              </div>
              <p className="text-xs text-muted-foreground">MP4 or MOV from your phone, up to {MAX_VIDEO_MB} MB. Bigger? Put it on Google Drive or YouTube (unlisted) and paste the link.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/file/d/…" inputMode="url" />
              <p className="text-xs text-muted-foreground">A Google Drive, YouTube or Vimeo link. Make sure anyone with the link can view it.</p>
            </div>
          )}
          {extra && <p className="text-xs text-muted-foreground">The new video replaces the old one. Feedback already given stays.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy && pct !== null && pct < 100 ? `Uploading ${pct}%` : "Hand in"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
