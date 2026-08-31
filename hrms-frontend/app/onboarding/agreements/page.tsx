"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PlayCircle, FileText, PenLine, CheckCircle2, Loader2, AlertTriangle, Clock, ScanFace } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/onboarding/SignaturePad";
import { FaceEnrollmentPanel } from "@/components/face/FaceEnrollmentPanel";
import {
  useMyAgreements, useStartInduction, useInductionHeartbeat, useSignAgreements,
} from "@/hooks/useAgreements";
import { AGREEMENT_KIND_LABELS } from "@/types";
import { cn } from "@/lib/utils";

/** How often the player tells the server where it is. */
const BEAT_MS = 5_000;

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
  const [signature, setSignature] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");

  useEffect(() => { startInduction(); }, [startInduction]);
  useEffect(() => {
    if (data?.videoCompleted) { setVideoDone(true); setPercent(100); }
    if (session?.user?.name && !typedName) setTypedName(session.user.name);
  }, [data, session, typedName]);

  // The server is the one that decides; this only reports where the playhead is.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || videoDone) return;
    const id = setInterval(() => {
      if (el.paused || el.ended) return;
      beat(el.currentTime, {
        onSuccess: (p) => { setPercent(p.percent); if (p.completed) setVideoDone(true); },
      });
    }, BEAT_MS);
    return () => clearInterval(id);
  }, [beat, videoDone]);

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

  if (data.cleared) {
    return (
      <Shell>
        <Card className="flex items-start gap-3 p-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-medium">All done</p>
            <p className="mt-1 text-sm text-muted-foreground">Your agreements are signed and approved.</p>
            <Button className="mt-4" onClick={() => router.replace("/dashboard")}>Go to your dashboard</Button>
          </div>
        </Card>
      </Shell>
    );
  }

  if (data.agreement?.status === "pending") {
    return (
      <Shell>
        <Card className="flex items-start gap-3 p-6">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">With HR for verification</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You signed on {new Date(data.agreement.signedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}.
              You&apos;ll get access once HR has checked it.
            </p>
          </div>
        </Card>
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
            <video
              ref={videoRef}
              src={induction.video.url}
              /**
               * Always. This read `controls={videoDone}`, which showed them
               * only once the video was already finished — so there was no play
               * button until after the thing had been watched, and no way to
               * start it. Skipping ahead is prevented twice over already: the
               * handler below snaps the playhead back, and the server credits
               * elapsed time rather than position, so a dragged bar earns
               * nothing. Neither of those needs the play button hidden.
               */
              controls
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
              // Dragging the bar is pointless — the server credits elapsed time,
              // not playhead position — but snapping back says so immediately
              // instead of letting someone reach the end and be told no.
              onSeeking={(e) => {
                const el = e.currentTarget;
                if (!videoDone && el.currentTime > (induction.progress?.lastPosition ?? 0) + 2) {
                  el.currentTime = induction.progress?.lastPosition ?? 0;
                }
              }}
              onEnded={() => beat(videoRef.current?.duration ?? 0, {
                onSuccess: (p) => { setPercent(p.percent); if (p.completed) setVideoDone(true); },
              })}
              className="w-full rounded-xl bg-black"
            />
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {videoDone
                ? "Watched in full — thank you."
                : `${percent}% watched. The bar tracks time actually watched, so skipping ahead won't move it.`}
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
        <div className="space-y-2">
          {data.documents.map((d) => (
            <a
              key={d.kind} href={d.url} target="_blank" rel="noreferrer"
              onClick={() => setOpened((o) => ({ ...o, [d.kind]: true }))}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                videoDone ? "hover:border-primary/40 hover:bg-muted/40" : "pointer-events-none opacity-50",
                opened[d.kind] ? "border-emerald-500/30 bg-emerald-500/5" : "border-border"
              )}
            >
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="flex-1 text-sm font-medium">{AGREEMENT_KIND_LABELS[d.kind]}</span>
              <span className="text-xs text-muted-foreground">v{d.version}</span>
              {opened[d.kind] && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            </a>
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
          muted={data.agreement?.status !== "approved"}
        >
          {data.agreement?.status === "approved" ? (
            <FaceEnrollmentPanel userId={session?.user?._id ?? null} userName={session?.user?.name ?? "You"} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Available once HR has approved your signed documents.
            </p>
          )}
        </Step>
      )}
    </Shell>
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
