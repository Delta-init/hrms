"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, LogIn, LogOut, ScanFace,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchKioskSession, getKioskToken, setKioskToken, submitPunch, type KioskSession,
} from "@/lib/kioskClient";
import { cn } from "@/lib/utils";
import type { KioskPunchResult } from "@/types";

/** How long a result stays on screen before the kiosk resets for the next person. */
const RESULT_MS = 5000;
/** Frames sent per punch — a blink or half-turn then costs nothing. */
const FRAMES = 3;
const FRAME_GAP_MS = 220;

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

type CameraState = "starting" | "ready" | "insecure" | "denied" | "unavailable";

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
  const [now, setNow] = useState<Date | null>(null);

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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamera("ready");
    } catch {
      setCamera("denied");
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [startCamera]);

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
      // A short burst rather than one frame: people blink, and the service
      // keeps whichever frame scores best.
      const frames: string[] = [];
      for (let i = 0; i < FRAMES; i += 1) {
        const frame = grab();
        if (frame) frames.push(frame);
        if (i < FRAMES - 1) await new Promise((resolve) => setTimeout(resolve, FRAME_GAP_MS));
      }
      if (frames.length === 0) {
        setResult({ status: "refused", message: "The camera isn't ready yet." });
        return;
      }
      setResult(await submitPunch(frames));
    } catch (error) {
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

        <div className="flex flex-1 flex-col items-center justify-center gap-8 py-8">
          {camera !== "ready" ? (
            <CameraProblem state={camera} onRetry={() => void startCamera()} />
          ) : result ? (
            <Result result={result} />
          ) : (
            <p className="max-w-md text-center text-lg text-neutral-300">
              Stand in front of the camera and tap below.
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
                Checking…
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

function CameraProblem({ state, onRetry }: { state: CameraState; onRetry: () => void }) {
  const message =
    state === "insecure"
      ? "The camera needs a secure connection. Open this page over https://."
      : state === "denied"
        ? "Camera access is blocked. Allow it in the browser settings for this site."
        : state === "unavailable"
          ? "No camera is available on this device."
          : "Starting the camera…";

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {state === "starting" ? (
        <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
      ) : (
        <AlertTriangle className="h-8 w-8 text-amber-400" />
      )}
      <p className="max-w-md text-lg text-neutral-300">{message}</p>
      {state !== "starting" && (
        <Button variant="outline" onClick={onRetry}>Try again</Button>
      )}
    </div>
  );
}
