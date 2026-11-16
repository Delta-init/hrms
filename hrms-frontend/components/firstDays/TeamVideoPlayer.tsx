"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useStartWatching, useWatchBeat } from "@/hooks/useFirstDays";
import type VimeoPlayer from "@vimeo/player";
import { cn } from "@/lib/utils";
import type { WatchProgress } from "@/types";

/** How often the player tells the server where it is. */
const BEAT_MS = 5_000;
const clock = (s: number) =>
  Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00";

/**
 * A video the joiner must watch in full — the team's, or a video homework when
 * `homeworkId` is given — watched the way the induction is: the server decides
 * how much has been seen from where the playhead is every few seconds, it
 * opens where they got to, and it can be scrubbed back but not ahead of the
 * furthest point reached. The native controls come back once it counts as watched.
 */
export function TeamVideoPlayer({ homeworkId, doneText }: { homeworkId?: string; doneText?: string } = {}) {
  const { mutate: start, data: opened, isPending: opening, error } = useStartWatching(homeworkId);
  const { mutate: beat } = useWatchBeat(homeworkId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const furthest = useRef(0);
  const [progress, setProgress] = useState<WatchProgress | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => { start(); }, [start]);
  useEffect(() => { if (opened?.progress) setProgress(opened.progress); }, [opened]);
  const done = !!progress?.completed;

  const url = opened?.video.url;
  useEffect(() => {
    if (!url || done) return;
    const id = setInterval(() => {
      const el = videoRef.current;
      if (!el || el.paused || el.ended) return;
      beat(el.currentTime, { onSuccess: setProgress });
    }, BEAT_MS);
    return () => clearInterval(id);
  }, [beat, done, url]);

  if (opening || (!opened && !error)) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (error || !opened) {
    const message = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;
    return <p className="text-sm text-muted-foreground">{message ?? "The video could not be opened."}</p>;
  }

  if (opened.video.vimeo) {
    return (
      <VimeoWatch embedUrl={opened.video.vimeo.embedUrl} title={opened.video.title} durationSeconds={opened.video.durationSeconds}
        initial={opened.progress} homeworkId={homeworkId} doneText={doneText} />
    );
  }

  const seekTo = (fraction: number) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const target = Math.max(0, Math.min(el.duration, fraction * el.duration));
    if (!done && target > furthest.current) return;
    el.currentTime = target;
    setElapsed(target);
  };
  const togglePlay = () => { const el = videoRef.current; if (el) { if (el.paused) void el.play(); else el.pause(); } };

  return (
    <div className="space-y-2">
      <div className="group relative overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          src={opened.video.url}
          controls={done}
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          playsInline
          onContextMenu={(e) => e.preventDefault()}
          onClick={done ? undefined : togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setElapsed(t);
            if (t > furthest.current) furthest.current = t;
          }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            setTotal(el.duration);
            const resume = opened.progress.resumeAt ?? 0;
            furthest.current = Math.max(furthest.current, opened.progress.furthest ?? 0, resume);
            if (resume > 1 && resume < el.duration - 1) { el.currentTime = resume; setElapsed(resume); }
          }}
          onSeeking={(e) => {
            const el = e.currentTarget;
            if (!done && el.currentTime > furthest.current + 2) el.currentTime = furthest.current;
          }}
          onEnded={() => beat(videoRef.current?.duration ?? 0, { onSuccess: setProgress })}
          className="w-full"
        />
        {!done && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/90 to-black/40 px-3 py-2.5">
            <button type="button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/90 text-black transition hover:bg-white">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
            </button>
            <button type="button" aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => { const el = videoRef.current; if (el) { el.muted = !el.muted; setMuted(el.muted); } }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:text-white">
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <div
              role="slider" tabIndex={0} aria-label="Position"
              aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(elapsed)}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width); }}
              className="relative h-4 flex-1 cursor-pointer"
            >
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20">
                <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${total ? Math.min(100, (furthest.current / total) * 100) : 0}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${total ? (elapsed / total) * 100 : 0}%` }} />
              </div>
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-white/80">{clock(elapsed)} / {clock(total)}</span>
          </div>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full bg-primary transition-[width] duration-500")} style={{ width: `${progress?.percent ?? 0}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {done ? doneText ?? "Watched in full — this step is done." : `${progress?.percent ?? 0}% watched. You can go back, but not skip ahead — play it through to the end.`}
      </p>
    </div>
  );
}

/**
 * A video from the company's Vimeo folder, held to the same rules in Vimeo's
 * own player: its play bar may show (the free plan can't hide it), but a jump
 * past the furthest point reached is sent straight back, speed is held at 1×,
 * and the server still counts only what played from where the playhead is
 * every few seconds. The player library loads only when a Vimeo video opens.
 */
function VimeoWatch({ embedUrl, title, durationSeconds, initial, homeworkId, doneText }: {
  embedUrl: string; title: string; durationSeconds: number; initial: WatchProgress; homeworkId?: string; doneText?: string;
}) {
  const { mutate: beat } = useWatchBeat(homeworkId);
  const frame = useRef<HTMLIFrameElement>(null);
  const [progress, setProgress] = useState<WatchProgress>(initial);
  const done = !!progress.completed;
  const doneRef = useRef(done);
  doneRef.current = done;
  const furthest = useRef(Math.max(initial.furthest ?? 0, initial.resumeAt ?? 0));

  useEffect(() => {
    let cancelled = false;
    let player: VimeoPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const back = () => { player?.setCurrentTime(furthest.current).catch(() => {}); };
    (async () => {
      const { default: Player } = await import("@vimeo/player");
      if (cancelled || !frame.current) return;
      player = new Player(frame.current);
      await player.ready().catch(() => {});
      if (cancelled) return;
      const resume = initial.resumeAt ?? 0;
      if (!initial.completed && resume > 1 && resume < durationSeconds - 1) player.setCurrentTime(resume).catch(() => {});
      // Normal play moves a fraction of a second between updates; anything
      // further ahead than that is a jump, and goes back.
      player.on("timeupdate", ({ seconds }: { seconds: number }) => {
        if (doneRef.current) return;
        if (seconds > furthest.current + 2) back();
        else if (seconds > furthest.current) furthest.current = seconds;
      });
      player.on("seeked", ({ seconds }: { seconds: number }) => { if (!doneRef.current && seconds > furthest.current + 2) back(); });
      player.on("playbackratechange", ({ playbackRate }: { playbackRate: number }) => {
        if (playbackRate !== 1) player?.setPlaybackRate(1).catch(() => {});
      });
      player.on("ended", () => { if (!doneRef.current) beat(durationSeconds, { onSuccess: setProgress }); });
      timer = setInterval(async () => {
        if (doneRef.current || !player) return;
        if (await player.getPaused().catch(() => true)) return;
        const t = await player.getCurrentTime().catch(() => null);
        if (t !== null) beat(t, { onSuccess: setProgress });
      }, BEAT_MS);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      player?.destroy().catch(() => {});
    };
    // The player is set up once per video; what it reads changes through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedUrl]);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl bg-black">
        <iframe ref={frame} src={embedUrl} title={title} className="aspect-video w-full" allow="autoplay; fullscreen" allowFullScreen />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progress.percent ?? 0}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {done ? doneText ?? "Watched in full — this step is done." : `${progress.percent ?? 0}% watched. You can go back, but not skip ahead — play it through to the end.`}
      </p>
    </div>
  );
}
