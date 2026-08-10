"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, Loader2, LogIn, LogOut, ScanFace,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchChallenge, fetchKioskSession, getKioskToken, setKioskToken, submitPunch,
  type KioskSession, type LivenessStep,
} from "@/lib/kioskClient";
import { cn } from "@/lib/utils";
import type { KioskPunchResult } from "@/types";

/** How long a result stays on screen before the kiosk resets for the next person. */
const RESULT_MS = 5000;
/**
 * Frames per punch when liveness is off. Two rather than one so a blink costs
 * nothing, and no more than two because every extra frame is another round of
 * inference between the person and the door.
 */
const FRAMES = 2;
const FRAME_GAP_MS = 180;
/** How long each prompt is shown before its frame is taken. */
const PROMPT_MS = 1300;

/** What the person is asked to do, per step the server picked. */
const PROMPTS: Record<LivenessStep, { title: string; hint: string }> = {
  center: { title: "Look at the camera", hint: "Face straight ahead" },
  left: { title: "Turn your head left", hint: "Your left — just a small turn" },
  right: { title: "Turn your head right", hint: "Your right — just a small turn" },
};

/**
 * The check-in screen, for a shared tablet by the door.
 *
 * It lives outside the dashboard layout because there is nobody signed in
 * here — the device authenticates as itself, and whoever walks up is identified
 * by their face. Nothing about who they are or whether this is an arrival or a
 * departure is decided on this page; it sends frames and renders what comes
 * back, so tampering with the tablet buys nothing.
 */
export default function KioskPage() {
  const [session, setSession] = useState<KioskSession | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getKioskToken();
    if (!token) {
      setChecking(false);
      return;
    }
    fetchKioskSession()
      .then(setSession)
      .catch(() => setKioskToken(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-950">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
      </main>
    );
  }

  if (!session) return <PairingScreen onPaired={setSession} />;
  return <CheckInScreen session={session} onUnpaired={() => setSession(null)} />;
}

// ─── Pairing ─────────────────────────────────────────────────────────────────

function PairingScreen({ onPaired }: { onPaired: (session: KioskSession) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await fetchKioskSession(token.trim());
      setKioskToken(token.trim());
      onPaired(session);
    } catch {
      setError("That token wasn't accepted. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center">
          <ScanFace className="mx-auto mb-3 h-10 w-10 text-neutral-400" />
          <h1 className="text-2xl font-semibold">Pair this device</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Paste the device token from HRMS → Check-in kiosks.
          </p>
        </div>

        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Device token"
          className="border-neutral-800 bg-neutral-900 text-neutral-100 placeholder:text-neutral-600"
          autoFocus
        />

        {error && <p className="text-center text-sm text-red-400">{error}</p>}

        <Button className="w-full" size="lg" onClick={pair} disabled={!token.trim() || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Pair device
        </Button>
      </div>
    </main>
  );
}

// ─── Check-in ────────────────────────────────────────────────────────────────

type CameraState =
  | "starting"
  | "ready"
  | "insecure"
  | "denied"
  | "unavailable"
  | "busy"
  | "unusable";

/**
 * Why the camera wouldn't start.
 *
 * Worth separating: "blocked" and "another app has it" need opposite actions,
 * and sending somebody to browser settings when the real problem is a video
 * call in the background leaves them stuck with the screen insisting they fix
 * a permission that was never the issue.
 */
/**
 * A one-line technical account of why the camera didn't start.
 *
 * Three separate layers can refuse — the operating system, the browser's
 * site permission, and the device itself — and they produce nearly identical
 * symptoms. "NotAllowedError · permission: prompt" means the OS or an embedding
 * frame refused before the site was ever asked; "permission: denied" means the
 * site is blocked; "no camera visible" means neither got that far.
 */
async function describeFailure(error: unknown): Promise<string> {
  const parts: string[] = [];
  const name = (error as { name?: string })?.name;
  const message = (error as { message?: string })?.message;
  parts.push(name ? `${name}${message ? ` (${message})` : ""}` : "unknown error");

  try {
    const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
    if (status) parts.push(`permission: ${status.state}`);
  } catch {
    /* Firefox and Safari don't expose the camera permission this way */
  }

  try {
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "videoinput"
    );
    parts.push(cameras.length ? `${cameras.length} camera(s) visible` : "no camera visible");
  } catch {
    /* nothing to add */
  }

  if (typeof window !== "undefined" && window.self !== window.top) {
    // An iframe without allow="camera" is refused outright, with no prompt —
    // which looks exactly like a permission the user swears they granted.
    parts.push("page is inside an iframe");
  }
  return parts.join(" · ");
}

function cameraFailure(error: unknown): CameraState {
  const name = (error as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "unavailable";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "busy";
  }
  return "unusable";
}

function CheckInScreen({
  session, onUnpaired,
}: {
  session: KioskSession;
  onUnpaired: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KioskPunchResult | null>(null);
  const [prompt, setPrompt] = useState<LivenessStep | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  // Exact browser error, the permission state, and whether a camera is even
  // visible. Shown on screen because "it just says blocked" is impossible to
  // act on — whoever is installing the kiosk needs to know which layer said no.
  const [diagnosis, setDiagnosis] = useState<string | null>(null);

  // Rendered only after mount: a server-rendered clock would mismatch the
  // client's and produce a hydration error on every load.
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setCamera("insecure");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unavailable");
      return;
    }
    setCamera("starting");
    // Release anything we already hold before asking again, or a retry hits
    // our own stream and reports the camera as busy.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const attempts: MediaStreamConstraints[] = [
      { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false },
      // Fall back to whatever the device will give us: a webcam that can't do
      // 720p should still run the kiosk.
      { video: true, audio: false },
    ];

    let lastError: unknown;
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCamera("ready");
        return;
      } catch (error) {
        lastError = error;
        // Only a constraints failure is worth retrying; a denied permission or
        // a camera in use will fail the same way again.
        const name = (error as { name?: string })?.name ?? "";
        if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError") break;
      }
    }
    setDiagnosis(await describeFailure(lastError));
    setCamera(cameraFailure(lastError));
  }, []);

  useEffect(() => {
    void startCamera();
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [startCamera]);

  /**
   * Recover by itself once the camera becomes available.
   *
   * Somebody who fixes the permission in the browser's own panel gets no
   * feedback from us otherwise — the screen sits there insisting it is blocked
   * long after it isn't, and the obvious conclusion is that the kiosk is
   * broken. Chrome fires a permission change; we take that as our cue.
   */
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;

    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        status = result;
        result.onchange = () => {
          if (result.state === "granted") void startCamera();
        };
      })
      .catch(() => {
        /* Safari and Firefox don't expose this; the focus handler covers them */
      });

    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [startCamera]);

  /**
   * The same recovery for browsers with no permission events, and for the case
   * the events don't cover: closing the video call that was holding the camera.
   * Coming back to the tab is a good moment to try again.
   */
  useEffect(() => {
    if (camera === "ready" || camera === "starting" || camera === "insecure") return;
    const retry = () => {
      if (document.visibilityState === "visible") void startCamera();
    };
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [camera, startCamera]);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const grab = (): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1] ?? null;
  };

  const punch = async () => {
    if (busy || camera !== "ready") return;
    setBusy(true);
    setResult(null);
    try {
      const frames: string[] = [];
      let challengeId: string | null = null;

      if (session.livenessRequired) {
        // The server picks the sequence; this screen only performs it. One
        // frame per prompt keeps the whole thing to about four seconds, which
        // is as long as anyone will stand at a door for.
        const challenge = await fetchChallenge();
        challengeId = challenge.id;
        for (const step of challenge.steps) {
          setPrompt(step);
          await new Promise((resolve) => setTimeout(resolve, PROMPT_MS));
          const frame = grab();
          if (frame) frames.push(frame);
        }
        setPrompt(null);
      } else {
        // A short burst rather than one frame: people blink, and the service
        // keeps whichever frame scores best.
        for (let i = 0; i < FRAMES; i += 1) {
          const frame = grab();
          if (frame) frames.push(frame);
          if (i < FRAMES - 1) await new Promise((resolve) => setTimeout(resolve, FRAME_GAP_MS));
        }
      }

      if (frames.length === 0) {
        setResult({ status: "refused", message: "The camera isn't ready yet." });
        return;
      }
      setResult(await submitPunch(frames, challengeId));
    } catch (error) {
      setPrompt(null);
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        // The device was removed or its token rotated — back to pairing.
        setKioskToken(null);
        onUnpaired();
        return;
      }
      setResult({
        status: "refused",
        message:
          status === 429
            ? "Too many attempts. Wait a moment."
            : "Couldn't reach the server. Try again.",
      });
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-neutral-950 text-neutral-100">
      <video
        ref={videoRef}
        playsInline
        muted
        className={cn(
          "absolute inset-0 h-full w-full scale-x-[-1] object-cover opacity-70",
          camera !== "ready" && "hidden"
        )}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-neutral-950/30" />

      <div className="relative flex min-h-dvh flex-col p-6 sm:p-10">
        <header className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-300">{session.name}</p>
            {session.location && <p className="text-xs text-neutral-500">{session.location}</p>}
          </div>
          {now && (
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums sm:text-4xl">
                {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="text-xs text-neutral-400">
                {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
              </p>
            </div>
          )}
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6">
          {/* Where to stand. The whole screen is a mirror, so without a target
              people drift to one side or stand too far back, and the first they
              hear of it is a refusal. */}
          {camera === "ready" && !result && <FaceGuide busy={busy} />}

          {camera !== "ready" ? (
            <CameraProblem state={camera} diagnosis={diagnosis} onRetry={() => void startCamera()} />
          ) : prompt ? (
            <Prompt step={prompt} />
          ) : result ? (
            <Result result={result} />
          ) : (
            <p className="max-w-md text-center text-lg text-neutral-300">
              Put your face in the outline, then tap below.
            </p>
          )}

          <Button
            size="lg"
            onClick={punch}
            disabled={busy || camera !== "ready"}
            className="h-20 w-full max-w-sm rounded-2xl text-lg font-semibold"
          >
            {busy ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                {prompt ? "Follow the prompts…" : "Checking…"}
              </>
            ) : (
              <>
                <ScanFace className="h-6 w-6" />
                Check in / out
              </>
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}

/**
 * The "stand here" outline.
 *
 * Corner brackets rather than a full ring: they mark the frame without drawing
 * a hard line across the person's face, and they read as a viewfinder, which is
 * a shape everyone already understands. It brightens while a punch is in
 * flight so there is some sign the tablet is doing something.
 */
function FaceGuide({ busy }: { busy: boolean }) {
  const corner = "absolute h-10 w-10 border-white/70 transition-colors sm:h-14 sm:w-14";
  return (
    <div
      className={cn(
        "relative aspect-[3/4] h-[38vh] max-h-[420px] min-h-[220px] transition-opacity",
        busy ? "opacity-100" : "opacity-80"
      )}
      aria-hidden
    >
      <div
        className={cn(
          "absolute inset-0 rounded-[50%] border-2 transition-colors",
          busy ? "animate-pulse border-sky-400/80" : "border-white/25"
        )}
      />
      <div className={cn(corner, "left-0 top-0 rounded-tl-xl border-l-2 border-t-2")} />
      <div className={cn(corner, "right-0 top-0 rounded-tr-xl border-r-2 border-t-2")} />
      <div className={cn(corner, "bottom-0 left-0 rounded-bl-xl border-b-2 border-l-2")} />
      <div className={cn(corner, "bottom-0 right-0 rounded-br-xl border-b-2 border-r-2")} />
    </div>
  );
}

/**
 * The current instruction, big enough to read while standing back from a
 * tablet. The arrow points the way the person should physically turn — the
 * preview beside it is mirrored, so words alone get read as their reflection.
 */
function Prompt({ step }: { step: LivenessStep }) {
  const { title, hint } = PROMPTS[step];
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex items-center gap-4">
        {step === "left" && <ArrowLeft className="h-12 w-12 animate-pulse text-sky-400" />}
        {step === "center" && <ScanFace className="h-12 w-12 animate-pulse text-sky-400" />}
        {step === "right" && <ArrowRight className="h-12 w-12 animate-pulse text-sky-400" />}
      </div>
      <p className="text-4xl font-semibold">{title}</p>
      <p className="text-lg text-neutral-400">{hint}</p>
    </div>
  );
}

function Result({ result }: { result: KioskPunchResult }) {
  if (result.status === "punched") {
    const isIn = result.direction === "in";
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className={cn("rounded-full p-4", isIn ? "bg-emerald-500/15" : "bg-sky-500/15")}>
          {isIn ? (
            <LogIn className="h-10 w-10 text-emerald-400" />
          ) : (
            <LogOut className="h-10 w-10 text-sky-400" />
          )}
        </div>
        <p className="text-3xl font-semibold">{result.user?.name}</p>
        <p className="text-lg text-neutral-300">
          {isIn ? "Checked in" : "Checked out"} at{" "}
          {result.at ? new Date(result.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
        </p>
        {isIn && (result.lateMinutes ?? 0) > 0 && (
          <p className="text-sm text-amber-400">{result.lateMinutes} minutes late</p>
        )}
      </div>
    );
  }

  if (result.status === "cooldown") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-full bg-neutral-500/15 p-4">
          <CheckCircle2 className="h-10 w-10 text-neutral-300" />
        </div>
        <p className="text-2xl font-semibold">{result.user?.name}</p>
        <p className="text-lg text-neutral-300">That&apos;s already recorded. You&apos;re all set.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="rounded-full bg-amber-500/15 p-4">
        {result.status === "refused" ? (
          <Clock className="h-10 w-10 text-amber-400" />
        ) : (
          <AlertTriangle className="h-10 w-10 text-amber-400" />
        )}
      </div>
      <p className="max-w-md text-2xl font-medium">{result.hint ?? result.message}</p>
    </div>
  );
}

const CAMERA_MESSAGES: Record<Exclude<CameraState, "ready">, { message: string; fix?: string }> = {
  starting: { message: "Starting the camera…" },
  insecure: {
    message: "The camera needs a secure connection.",
    fix: "Open this page over https://, or on localhost.",
  },
  denied: {
    message: "Camera access is blocked for this site.",
    fix: "Click the camera icon in the address bar and allow access, then try again.",
  },
  busy: {
    message: "Another app is using the camera.",
    fix: "Close anything else using it — a video call, or another tab — then try again.",
  },
  unavailable: {
    message: "No camera is connected to this device.",
    fix: "Plug one in, or use a device with a front camera.",
  },
  unusable: {
    message: "The camera couldn't be started.",
    fix: "Try again, or reload the page.",
  },
};

function CameraProblem({
  state, diagnosis, onRetry,
}: {
  state: CameraState;
  diagnosis: string | null;
  onRetry: () => void;
}) {
  const { message, fix } = CAMERA_MESSAGES[state as Exclude<CameraState, "ready">];

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {state === "starting" ? (
        <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
      ) : (
        <AlertTriangle className="h-8 w-8 text-amber-400" />
      )}
      <div>
        <p className="max-w-md text-lg text-neutral-300">{message}</p>
        {fix && <p className="mt-1 max-w-md text-sm text-neutral-500">{fix}</p>}
      </div>
      {state !== "starting" && (
        <Button variant="outline" onClick={onRetry}>Try again</Button>
      )}
      {diagnosis && state !== "starting" && (
        <p className="max-w-lg font-mono text-xs text-neutral-600">{diagnosis}</p>
      )}
    </div>
  );
}
