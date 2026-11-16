"use client";
import { useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, Paperclip, PlayCircle, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { VimeoPicker } from "@/components/firstDays/VimeoPicker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TeamVideoPlayer } from "@/components/firstDays/TeamVideoPlayer";
import { DOC_ACCEPT, VIDEO_ACCEPT, checkFile } from "@/components/firstDays/AddHomeworkDialog";
import { FileLink, UploadButton } from "@/components/firstDays/FirstDaysFiles";
import { useSetHomeworkQuestion, useSubmitWriteUp } from "@/hooks/useFirstDays";
import { toast } from "@/lib/toast";
import type { FirstDaysHomework, FirstDaysView, VimeoVideo } from "@/types";

/** Matches the server's floor for a write-up. */
const MIN_WRITE_UP = 20;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * A video homework. The joiner watches it in the guarded player — back is
 * fine, ahead is not — and once it counts as watched to the end, writes what
 * they learned, with a file if they like; that write-up is the hand-in. The
 * head sees how far they got, the write-up, and can replace the video.
 */
export function VideoHomeworkBody({ item: h, view }: { item: FirstDaysHomework; view: FirstDaysView }) {
  const joiner = view.viewer.isJoiner;
  const can = (a: string) => h.can.includes(a);
  const replace = useSetHomeworkQuestion();
  const [watching, setWatching] = useState(false);
  const [picking, setPicking] = useState(false);

  if (!joiner) {
    const length = h.durationSeconds ? ` (${clock(h.durationSeconds)})` : "";
    return (
      <div className="mt-3 space-y-2 pl-6">
        <div className="flex flex-wrap items-center gap-2">
          {h.question && <FileLink file={h.question} label={`Video${length}`} video />}
          {h.vimeo && (
            <a href={h.vimeo.link} target="_blank" rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-primary hover:bg-muted">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Vimeo{length}: {h.vimeo.name}</span>
            </a>
          )}
          {h.answer && <FileLink file={h.answer} label="Their file" />}
          {can("replaceQuestion") && (
            <>
              <UploadButton label={h.vimeo ? "Upload an MP4 instead" : "Replace the video"} busy={replace.isPending} accept={VIDEO_ACCEPT}
                onFile={(file) => {
                  const bad = checkFile("video", file);
                  if (bad) { toast.error(bad); return; }
                  replace.mutate({ employeeId: view.employee._id, itemId: h.id, file, kind: "video" });
                }} />
              <Button size="sm" variant="outline" disabled={replace.isPending} onClick={() => setPicking(true)}>
                {h.vimeo ? "Pick another from Vimeo" : "Pick from Vimeo instead"}
              </Button>
            </>
          )}
        </div>
        {picking && (
          <ReplaceFromVimeo onClose={() => setPicking(false)} busy={replace.isPending}
            onPick={(v) => replace.mutate({ employeeId: view.employee._id, itemId: h.id, vimeoId: v.id, kind: "video" }, { onSuccess: () => setPicking(false) })} />
        )}
        {!h.watched && h.status !== "waiting" && <WatchBar percent={h.percent} />}
        {h.notes
          ? <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{h.notes}</p>
          : h.status !== "waiting" && <p className="text-xs text-muted-foreground">No write-up yet.</p>}
      </div>
    );
  }

  if (!can("watch")) return null;
  return (
    <div className="mt-3 space-y-3 pl-6">
      {watching ? (
        <div className="space-y-2">
          <TeamVideoPlayer homeworkId={h.id} doneText="Watched in full — now write what you learned below." />
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setWatching(false)}><X className="h-3.5 w-3.5" />Close the video</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant={h.watched ? "outline" : "default"} onClick={() => setWatching(true)}>
            <PlayCircle className="h-3.5 w-3.5" />
            {h.watched ? "Watch again" : h.percent > 0 ? "Carry on watching" : "Watch the video"}
          </Button>
          {!h.watched && h.percent > 0 && <span className="text-xs text-muted-foreground">{h.percent}% watched</span>}
          {h.durationSeconds > 0 && <span className="text-xs text-muted-foreground">{clock(h.durationSeconds)} long</span>}
        </div>
      )}
      {can("writeUp")
        ? <WriteUp item={h} />
        : <p className="text-xs text-muted-foreground">The write-up opens once you&apos;ve watched it to the end.</p>}
    </div>
  );
}

function WatchBar({ percent }: { percent: number }) {
  return (
    <div className="flex max-w-xs items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
    </div>
  );
}

/** What they learned — required — and a file, if they want to add one. */
function WriteUp({ item: h }: { item: FirstDaysHomework }) {
  const submit = useSubmitWriteUp();
  const handedIn = !!h.notes;
  const [editing, setEditing] = useState(!handedIn);
  const [draft, setDraft] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const text = draft ?? h.notes ?? "";

  if (!editing) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">What you learned</p>
        <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{h.notes}</p>
        <div className="flex flex-wrap items-center gap-2">
          {h.answer && <FileLink file={h.answer} label="Your file" />}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Change your answer</Button>
        </div>
      </div>
    );
  }

  const short = text.trim().length < MIN_WRITE_UP;
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={`wu-${h.id}`}>What did you learn from it?</label>
      <Textarea id={`wu-${h.id}`} rows={4} maxLength={4000} value={text} onChange={(e) => setDraft(e.target.value)}
        placeholder="The main points, what surprised you, and what you'll do differently on your own calls." />
      <input ref={input} type="file" className="hidden" accept={DOC_ACCEPT}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setFile(f); }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={short || submit.isPending}
          onClick={() => submit.mutate({ itemId: h.id, notes: text.trim(), file }, {
            onSuccess: () => { setDraft(null); setFile(null); setEditing(false); },
          })}>
          {submit.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {handedIn ? "Save changes" : "Hand in"}
        </Button>
        {file ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{file.name}</span>
            <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Remove the file" onClick={() => setFile(null)}><X className="h-3.5 w-3.5" /></button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" className="h-8" onClick={() => input.current?.click()}>
            <Paperclip className="h-3.5 w-3.5" />{h.answer ? "Replace your file" : "Attach a file (optional)"}
          </Button>
        )}
        {handedIn && <Button size="sm" variant="ghost" className="h-8" onClick={() => { setDraft(null); setFile(null); setEditing(false); }}>Cancel</Button>}
        {short && <span className="text-[11px] text-muted-foreground">A sentence or two at least.</span>}
      </div>
    </div>
  );
}

/** Swap a homework's video for another from the Vimeo folder. */
function ReplaceFromVimeo({ onClose, onPick, busy }: { onClose: () => void; onPick: (v: VimeoVideo) => void; busy: boolean }) {
  const [picked, setPicked] = useState<VimeoVideo | null>(null);
  return (
    <ResponsiveDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Pick a video from Vimeo</ResponsiveDialogTitle></ResponsiveDialogHeader>
        <div className="min-w-0 space-y-2 px-4 sm:px-0">
          <VimeoPicker value={picked} onPick={setPicked} disabled={busy} />
          <p className="text-xs text-muted-foreground">They watch the new video from the start. What they already handed in still counts.</p>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!picked || busy} onClick={() => picked && onPick(picked)}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Use this video
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
