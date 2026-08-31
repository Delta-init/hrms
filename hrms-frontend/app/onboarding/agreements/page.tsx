"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PlayCircle, FileText, PenLine, CheckCircle2, Loader2, AlertTriangle, Clock, ScanFace, Play, Pause, Volume2, VolumeX, ExternalLink, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/onboarding/SignaturePad";
import { FaceEnrollmentPanel } from "@/components/face/FaceEnrollmentPanel";
import {
  useMyAgreements, useStartInduction, useInductionHeartbeat, useSignAgreements,
} from "@/hooks/useAgreements";
import { AGREEMENT_KIND_LABELS, type AgreementKind } from "@/types";
import { cn } from "@/lib/utils";

/** How often the player tells the server where it is. */
const BEAT_MS = 5_000;

/** Seconds as m:ss, for the transport's own read-out. */
const clock = (s: number) =>
  Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00";

export default function AgreementsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data, isLoading, error } = useMyAgreements();
  const { mutate: startInduction, data: induction } = useStartInduction();
  const { mutate: beat } = useInductionHeartbeat();
  const { mutate: submit, isPending: signing } = useSignAgreements();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [percent, setPercent] = useState(0);
  const [videoDone, setVideoDone] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  // The transport's own state. Held here rather than read off the element on
  // every render, so the controls repaint when it plays rather than when React
  // happens to re-render for some other reason.
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotal] = useState(0);
  const [hovering, setHovering] = useState(false);
  /** Set when they choose to draw their signature again, which reopens the flow. */
  const [resigning, setResigning] = useState(false);
  /** So the name is filled in for them once, and never re-filled after. */
  const seededName = useRef(false);
  /**
   * The furthest they have legitimately got to.
   *
   * Rewinding is allowed and re-watching earns nothing, so this only ever
   * climbs. It starts at whatever the server says was reached in an earlier
   * sitting, which is what makes going back possible on a fresh visit rather
   * than only within one.
   */
  const furthest = useRef(0);
  const [signature, setSignature] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");

  useEffect(() => { startInduction(); }, [startInduction]);
  useEffect(() => {
    if (data?.videoCompleted) { setVideoDone(true); setPercent(100); }
    /**
     * Seeded once, not kept full.
     *
     * `typedName` used to be a dependency of this effect, so clearing the field
     * re-ran it and put the name straight back — the last character could never
     * be deleted. Somebody whose account name is not the name they sign under
     * had no way to change it.
     */
    if (session?.user?.name && !seededName.current) {
      seededName.current = true;
      setTypedName(session.user.name);
    }
  }, [data, session]);

  /**
   * The server is the one that decides; this only reports where the playhead is.
   *
   * `videoUrl` is in the dependencies because the element does not exist on the
   * first run — the video is rendered only once `startInduction` has answered,
   * so this used to bail on a null ref and never run again. No heartbeat was
   * ever sent and the bar sat at 0% however long anybody watched.
   */
  /** Seek, but only backwards — forward is the thing being prevented. */
  const seekTo = (fraction: number) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const target = Math.max(0, Math.min(el.duration, fraction * el.duration));
    if (!videoDone && target > furthest.current) return;
    el.currentTime = target;
    setElapsed(target);
  };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };
  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const videoUrl = induction?.video?.url;
  useEffect(() => {
    if (!videoUrl || videoDone) return;
    const id = setInterval(() => {
      const el = videoRef.current;
      if (!el || el.paused || el.ended) return;
      beat(el.currentTime, {
        onSuccess: (p) => { setPercent(p.percent); if (p.completed) setVideoDone(true); },
      });
    }, BEAT_MS);
    return () => clearInterval(id);
  }, [beat, videoDone, videoUrl]);

  if (isLoading) {
    return <Shell><div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></Shell>;
  }

  // A missing template or an unclassified employee is not something the person
  // can fix, so it says who can rather than offering a retry.
  if (error || !data) {
    const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
      ?? "We could not load your agreements.";
    return (
      <Shell>
        <Card className="flex items-start gap-3 p-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">Not ready for you yet</p>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
            <p className="mt-3 text-sm text-muted-foreground">Please contact HR — there is nothing to do from here.</p>
          </div>
        </Card>
      </Shell>
    );
  }

  if (data.cleared && !resigning) {
    return (
      <Shell>
        <Card className="flex items-start gap-3 p-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-medium">All done</p>
            {/* "Approved" is no longer what this means. The gate lifts when
                they sign; HR verifies afterwards, and saying otherwise would
                have them believe a check has happened that has not. */}
            <p className="mt-1 text-sm text-muted-foreground">
              {data.agreement?.status === "approved"
                ? "Your agreements are signed and verified."
                : "Your agreements are signed. HR will verify them separately — nothing more is needed from you."}
            </p>
            <SignedCopies documents={data.agreement?.documents ?? []} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => router.replace("/dashboard")}>Go to your dashboard</Button>
              {data.agreement?.status === "pending" && (
                <Button variant="outline" className="gap-1.5" onClick={() => setResigning(true)}>
                  <PenLine className="h-3.5 w-3.5" />Sign again
                </Button>
              )}
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  /**
   * Signed, and no longer waiting on anybody.
   *
   * This used to be a dead end: a card saying HR would get to it, and nothing
   * else on the page. Somebody who had done everything asked of them sat locked
   * out of the system for as long as the review queue took. Verification still
   * happens — it just is not their problem, and a rejection puts them back here
   * to sign again, which is the point at which access should stop.
   */
  if (!resigning && (data.agreement?.status === "pending" || data.agreement?.status === "approved")) {
    const faceLeft = data.faceRequired && !data.faceEnrolled;
    return (
      <Shell steps={data.faceRequired ? 4 : 3}>
        <Card className="flex items-start gap-3 p-5">
          {data.agreement.status === "approved"
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            : <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />}
          <div>
            <p className="font-medium">
              {data.agreement.status === "approved" ? "Signed and verified" : "Signed — with HR for verification"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              You signed on {new Date(data.agreement.signedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}.
              {data.agreement.status === "pending"
                ? " HR will check it in their own time — you do not have to wait for that."
                : " Nothing further is needed."}
            </p>
            <SignedCopies documents={data.agreement.documents} />
            {/* A signature drawn with a trackpad is often not the one somebody
                wanted, and they usually notice on reading it back. Offered only
                while HR has not looked: replacing a verified signing would
                quietly undo the verification. */}
            {data.agreement.status === "pending" && (
              <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setResigning(true)}>
                <PenLine className="h-3.5 w-3.5" />Sign again
              </Button>
            )}
          </div>
        </Card>

        {faceLeft && (
          <Step n={data.faceRequired ? 4 : 3} icon={ScanFace} title="Set up face check-in" done={false}>
            <FaceEnrollmentPanel userId={session?.user?._id ?? null} userName={session?.user?.name ?? "You"} />
          </Step>
        )}

        {!faceLeft && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-medium">That&apos;s everything</p>
              <p className="mt-1 text-sm text-muted-foreground">Your account is ready to use.</p>
            </div>
            <Button onClick={() => router.replace("/dashboard")}>Go to the dashboard</Button>
          </Card>
        )}
      </Shell>
    );
  }

  const allOpened = data.documents.every((d) => opened[d.kind]);
  const canSign = videoDone && allOpened && !!signature && typedName.trim().length > 1;

  return (
    <Shell steps={data.faceRequired ? 4 : 3}>
      {data.agreement?.status === "rejected" && (
        <Card className="mb-6 flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-medium text-destructive">HR asked you to sign again</p>
            {data.agreement.reviewNote && <p className="mt-1 text-muted-foreground">{data.agreement.reviewNote}</p>}
          </div>
        </Card>
      )}

      {/* 1 — the induction */}
      <Step n={1} icon={PlayCircle} title="Watch the induction" done={videoDone}>
        {induction?.video ? (
          <>
            {/*
              No native controls until it has been watched.
              
              The scrub bar was the problem: dragging it fired a seek, the guard
              snapped the playhead back to the last credited position — zero, on
              a first viewing — and the video appeared to restart. Punishing a
              drag is a worse answer than not offering one, so the transport is
              play, pause and volume, and there is nothing to drag. Once the
              induction is complete the native controls come back and the video
              can be scrubbed freely, because by then there is nothing to game.
            */}
            <div
              className="group relative overflow-hidden rounded-xl bg-black"
              onMouseEnter={() => setHovering(true)}
              onMouseLeave={() => setHovering(false)}
            >
              <video
                ref={videoRef}
                src={induction.video.url}
                controls={videoDone}
                controlsList="nodownload noplaybackrate"
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
                onClick={videoDone ? undefined : togglePlay}
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
                  // Pick up where they left off. The position comes from the
                  // server rather than this browser, so it follows them to
                  // another machine and cannot be edited into a shortcut.
                  const resume = induction.progress?.lastPosition ?? 0;
                  furthest.current = Math.max(furthest.current, resume);
                  if (resume > 1 && resume < el.duration - 1) {
                    el.currentTime = resume;
                    setElapsed(resume);
                  }
                }}
                // Belt and braces: keyboard and programmatic seeks bypass the
                // absent bar, and the server would refuse the credit anyway.
                onSeeking={(e) => {
                  const el = e.currentTarget;
                  if (!videoDone && el.currentTime > furthest.current + 2) el.currentTime = furthest.current;
                }}
                onEnded={() => beat(videoRef.current?.duration ?? 0, {
                  onSuccess: (p) => { setPercent(p.percent); if (p.completed) setVideoDone(true); },
                })}
                className="w-full"
              />
              {!videoDone && (
                /*
                 * Out of the way while it plays, and back the moment the pointer
                 * arrives — or whenever it is paused, since a transport you have
                 * to hover to find is no use to somebody looking for the play
                 * button.
                 */
                <div
                  className={cn(
                    "absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/90 to-black/40 px-3 py-2.5 transition-opacity duration-200",
                    hovering || !playing ? "opacity-100" : "pointer-events-none opacity-0"
                  )}
                >
                  <button
                    type="button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/90 text-black transition hover:bg-white"
                  >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
                  </button>
                  <button
                    type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:text-white"
                  >
                    {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>

                  {/*
                    Clickable, but only backwards. The lighter section is what has
                    been reached and can be returned to; past it the bar does
                    nothing, which is quieter than snapping the playhead back and
                    says the same thing.
                  */}
                  <div
                    role="slider" tabIndex={0}
                    aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(elapsed)}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      seekTo((e.clientX - r.left) / r.width);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                      e.preventDefault();
                      const step = e.key === "ArrowLeft" ? -5 : 5;
                      if (total) seekTo((elapsed + step) / total);
                    }}
                    className="group/bar relative h-4 flex-1 cursor-pointer"
                  >
                    <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20">
                      {/* How far back you may go. */}
                      <div className="absolute inset-y-0 left-0 rounded-full bg-white/30"
                           style={{ width: `${total ? Math.min(100, (furthest.current / total) * 100) : 0}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-full bg-white"
                           style={{ width: `${total ? (elapsed / total) * 100 : 0}%` }} />
                    </div>
                  </div>

                  <span className="shrink-0 text-[11px] tabular-nums text-white/80">
                    {clock(elapsed)} / {clock(total)}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {videoDone
                ? "Watched in full — thank you."
                : `${percent}% credited. This bar counts time actually watched, so it lags the player a little and only moves while it is playing.`}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Loading the video…</p>
        )}
      </Step>

      {/* 2 — the documents */}
      <Step n={2} icon={FileText} title="Read your agreements" done={allOpened} muted={!videoDone}>
        <p className="mb-3 text-sm text-muted-foreground">
          These are the {data.variant === "remote" ? "remote" : "onsite"} versions, which apply to you.
        </p>
        <div className="space-y-3">
          {data.documents.map((d) => (
            <div
              key={d.kind}
              className={cn(
                "overflow-hidden rounded-lg border transition-colors",
                videoDone ? "" : "pointer-events-none opacity-50",
                opened[d.kind] ? "border-emerald-500/30" : "border-border"
              )}
            >
              <div className={cn("flex items-center gap-3 p-3", opened[d.kind] && "bg-emerald-500/5")}>
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="flex-1 text-sm font-medium">{AGREEMENT_KIND_LABELS[d.kind]}</span>
                <span className="text-xs text-muted-foreground">v{d.version}</span>
                {opened[d.kind] && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                <button
                  type="button"
                  onClick={() => setOpened((o) => ({ ...o, [d.kind]: !o[d.kind] }))}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                >
                  {opened[d.kind] ? "Hide" : "Read it"}
                </button>
                <a
                  href={d.url} target="_blank" rel="noreferrer"
                  onClick={() => setOpened((o) => ({ ...o, [d.kind]: true }))}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {/* Read here rather than in a tab nobody comes back from. Opening
                  it is what marks the document read, so the preview and the link
                  both count — this is a step somebody has to have done, not a
                  box to tick. */}
              {opened[d.kind] && (
                <iframe
                  src={d.url}
                  title={AGREEMENT_KIND_LABELS[d.kind]}
                  className="h-[520px] w-full border-t border-border bg-muted"
                />
              )}
            </div>
          ))}
        </div>
      </Step>

      {/* 3 — sign */}
      <Step n={3} icon={PenLine} title="Sign" done={false} muted={!videoDone || !allOpened}>
        <div className="space-y-4">
          <SignaturePad onChange={setSignature} />
          <div className="space-y-1.5">
            <Label htmlFor="typedName">Your full name</Label>
            <Input id="typedName" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="As it appears on your passport" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            One signature applies to both documents. We record the time, your IP address and that you
            watched the induction, and attach all of it to each signed copy.
          </p>
          <Button
            className="w-full" disabled={!canSign || signing}
            onClick={() => signature && submit({ signaturePng: signature, typedName })}
          >
            {signing && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign both and send to HR
          </Button>
        </div>
      </Step>

      {/* 4 — face, only where the organisation asks for one and the matching
          service is actually reachable. The server decides both; a step nothing
          can complete is worse than no step. */}
      {data.faceRequired && (
        <Step
          n={4} icon={ScanFace} title="Set up face check-in"
          done={data.faceEnrolled}
          muted={!data.agreement}
        >
          {data.agreement ? (
            <FaceEnrollmentPanel userId={session?.user?._id ?? null} userName={session?.user?.name ?? "You"} />
          ) : (
            <p className="text-sm text-muted-foreground">Available once you have signed.</p>
          )}
        </Step>
      )}
    </Shell>
  );
}

/**
 * The signed copies, to read back or keep.
 *
 * Not the templates from step 2 — these carry their name and signature. The
 * download link asks the API for it as an attachment, because the `download`
 * attribute does nothing across origins and would otherwise just reopen the
 * viewer.
 */
function SignedCopies({ documents }: { documents: Array<{ kind: AgreementKind; version: number; url: string }> }) {
  if (!documents.length) return null;
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your signed copies</p>
      {documents.map((d) => (
        <div key={`${d.kind}-${d.version}`} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1 text-sm">{AGREEMENT_KIND_LABELS[d.kind]}</span>
          <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            View <ExternalLink className="h-3 w-3" />
          </a>
          <a href={`${d.url}&download=1`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            Download <Download className="h-3 w-3" />
          </a>
        </div>
      ))}
    </div>
  );
}

function Shell({ children, steps = 3 }: { children: React.ReactNode; steps?: number }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Before you start</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {steps === 4 ? "Four things" : "Three things"} to finish, and then you&apos;re in.
      </p>
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}

function Step({ n, icon: Icon, title, done, muted, children }: {
  n: number; icon: React.ElementType; title: string; done: boolean; muted?: boolean; children: React.ReactNode;
}) {
  return (
    <Card className={cn("p-5 transition-opacity", muted && "opacity-60")}>
      <div className="mb-4 flex items-center gap-3">
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          done ? "bg-emerald-500/10 text-emerald-600" : "bg-primary/10 text-primary"
        )}>
          {done ? <CheckCircle2 className="h-4 w-4" /> : n}
        </div>
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </Card>
  );
}
