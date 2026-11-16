"use client";
import { useState } from "react";
import { Check, Loader2, RefreshCw, Search, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useRefreshVimeo, useVimeoVideos } from "@/hooks/useFirstDays";
import { cn } from "@/lib/utils";
import type { VimeoVideo } from "@/types";

export type VideoSource = "upload" | "vimeo";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Upload an MP4, or pick one from the company's Vimeo folder. */
export function VideoSourceToggle({ source, onChange, disabled }: { source: VideoSource; onChange: (s: VideoSource) => void; disabled?: boolean }) {
  const opts: { s: VideoSource; label: string; icon: React.ElementType }[] = [
    { s: "upload", label: "Upload an MP4", icon: Upload },
    { s: "vimeo", label: "Pick from Vimeo", icon: VimeoMark },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {opts.map((o) => (
        <button key={o.s} type="button" disabled={disabled} onClick={() => onChange(o.s)}
          className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-sm transition", source === o.s ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50")}>
          <o.icon className="h-4 w-4" />{o.label}
        </button>
      ))}
    </div>
  );
}

/** A plain "v" mark — lucide has no Vimeo logo, and brand marks aren't ours to draw. */
function VimeoMark({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center justify-center rounded-sm border text-[10px] font-semibold leading-none", className)}>v</span>;
}

/**
 * The videos in the company's Vimeo folder, searchable. Ones Vimeo won't let
 * play inside HRMS are listed but can't be picked, with what to change in
 * Vimeo; "Check again" asks Vimeo afresh once that's done.
 */
export function VimeoPicker({ value, onPick, disabled }: { value: VimeoVideo | null; onPick: (v: VimeoVideo) => void; disabled?: boolean }) {
  const { data, isLoading, error } = useVimeoVideos();
  const refresh = useRefreshVimeo();
  const [q, setQ] = useState("");

  if (isLoading) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the Vimeo folder…</p>;
  }
  if (error || !data) {
    const message = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;
    return <p className="text-sm text-destructive">{message ?? "Couldn't load the Vimeo folder."}</p>;
  }
  if (!data.connected) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Vimeo isn&apos;t connected to HRMS yet — whoever manages the server adds the Vimeo access token and folder. Until then, upload the MP4.
      </p>
    );
  }

  const term = q.trim().toLowerCase();
  const list = data.videos
    .filter((v) => !term || v.name.toLowerCase().includes(term))
    // What can be picked first; Vimeo's order otherwise.
    .sort((a, b) => Number(b.playable) - Number(a.playable));

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8" placeholder="Search the folder" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline disabled:opacity-60">
          <RefreshCw className={cn("h-3.5 w-3.5", refresh.isPending && "animate-spin")} />Check again
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{data.videos.length ? "No video matches that." : "The Vimeo folder has no videos yet."}</p>
      ) : (
        <div className="max-h-64 min-w-0 space-y-1 overflow-y-auto overflow-x-hidden rounded-lg border p-1.5">
          {list.map((v) => {
            const picked = value?.id === v.id;
            return (
              <button key={v.id} type="button" disabled={disabled || !v.playable} onClick={() => onPick(v)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left transition",
                  picked ? "bg-primary/10" : v.playable ? "hover:bg-muted/60" : "cursor-not-allowed opacity-60"
                )}>
                <div className="h-9 w-16 shrink-0 overflow-hidden rounded bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {v.thumbnail && <img src={v.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{v.name}</div>
                  <div className={cn("truncate text-xs", v.playable ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
                    {v.playable ? clock(v.durationSeconds) : v.reason}
                  </div>
                </div>
                {picked && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
