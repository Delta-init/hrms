"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription,
  ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { enrollError, useEnrollFace, type FaceEnrollFailure } from "@/hooks/useFaceEnrollment";
import { cn } from "@/lib/utils";
import type { FaceSettings } from "@/types";

/**
 * Poses asked for, in order. Several angles make recognition forgiving of how
 * someone happens to stand at the kiosk; a profile enrolled from one dead-on
 * shot fails the moment they tilt their head.
 */
const POSES = [
  { title: "Look straight ahead", hint: "Face the camera square-on, eyes open." },
  { title: "Turn slightly left", hint: "Just a small turn — keep both eyes visible." },
  { title: "Turn slightly right", hint: "Same again, the other way." },
  { title: "Chin slightly up", hint: "A small lift, still looking at the camera." },
  { title: "Chin slightly down", hint: "A small drop, still looking at the camera." },
];

/** Human wording for the quality codes the recognition service reports. */
const FAILURE_LABELS: Record<string, string> = {
  FACE_TOO_SMALL: "too far from the camera",
  TOO_BLURRY: "out of focus — hold still",
  TOO_DARK: "too dark",
  TOO_BRIGHT: "too bright or backlit",
  HEAD_TURNED: "head turned too far",
  HEAD_TILTED: "head tilted too far",
  LOW_DETECTION_CONFIDENCE: "face not clear enough",
};

type CameraState =
  | "idle"
  | "starting"
  | "ready"
  | "denied"
  | "insecure"
  | "unavailable"
  | "busy"
  | "unusable";

/** "Blocked" and "another app has it" need opposite fixes — see the kiosk screen. */
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

export function FaceCaptureDialog({
  open, onOpenChange, userId, userName, settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  settings: FaceSettings;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>("idle");
  const [shots, setShots] = useState<string[]>([]);
  const [consented, setConsented] = useState(false);
  const [failure, setFailure] = useState<FaceEnrollFailure | null>(null);

  const { mutate: enroll, isPending } = useEnrollFace(userId);
  const target = Math.min(settings.maxCaptures, POSES.length);
  const pose = POSES[Math.min(shots.length, POSES.length - 1)]!;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    // getUserMedia is unavailable outside a secure context, which is the single
    // most likely reason this fails on a real deployment — say so plainly
    // rather than showing a dead black rectangle.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setCamera("insecure");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unavailable");
      return;
    }
    setCamera("starting");
    stopCamera();

    const attempts: MediaStreamConstraints[] = [
      { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false },
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
        const name = (error as { name?: string })?.name ?? "";
        if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError") break;
      }
    }
    setCamera(cameraFailure(lastError));
  }, [stopCamera]);

  useEffect(() => {
    if (open) void startCamera();
    return () => stopCamera();
  }, [open, startCamera, stopCamera]);

  // Reset between openings so a previous attempt's shots and errors don't
  // reappear on the next employee.
  useEffect(() => {
    if (!open) {
      setShots([]);
      setConsented(false);
      setFailure(null);
      setCamera("idle");
    }
  }, [open]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || camera !== "ready") return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    // JPEG at 0.92 keeps the detail the embedder needs while staying inside the
    // API's body limit for five captures.
    setShots((current) => [...current, canvas.toDataURL("image/jpeg", 0.92).split(",")[1]!]);
    setFailure(null);
  };

  const retake = (index: number) => {
    setShots((current) => current.filter((_, i) => i !== index));
    setFailure(null);
  };

  const submit = () => {
    setFailure(null);
    enroll(shots, {
      onSuccess: () => onOpenChange(false),
      onError: (error) => setFailure(enrollError(error)),
    });
  };

  const enough = shots.length >= settings.minCaptures;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Enrol {userName}&apos;s face</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-2 sm:px-0">
            {settings.minCaptures}–{target} captures from slightly different angles.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          <div className="relative overflow-hidden rounded-xl border bg-muted aspect-video">
            <video
              ref={videoRef}
              playsInline
              muted
              // Mirrored: people align themselves far more easily against a
              // mirror image than a true one.
              className={cn("h-full w-full scale-x-[-1] object-cover", camera !== "ready" && "invisible")}
            />
            {camera !== "ready" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                {camera === "starting" ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <AlertTriangle className="h-6 w-6 text-amber-500" />
                    <p className="text-sm font-medium">{CAMERA_MESSAGES[camera]?.message}</p>
                    {CAMERA_MESSAGES[camera]?.fix && (
                      <p className="text-xs text-muted-foreground">{CAMERA_MESSAGES[camera]!.fix}</p>
                    )}
                    <Button size="sm" variant="outline" onClick={() => void startCamera()}>
                      Try again
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          {shots.length < target && camera === "ready" && (
            <div className="rounded-lg bg-muted/50 px-3 py-2">
              <p className="text-sm font-medium">
                Capture {shots.length + 1} of {target} · {pose.title}
              </p>
              <p className="text-xs text-muted-foreground">{pose.hint}</p>
            </div>
          )}

          {shots.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {shots.map((shot, index) => (
                <div
                  key={index}
                  className={cn(
                    "group relative h-16 w-16 overflow-hidden rounded-lg border",
                    failure?.frame === index && "ring-2 ring-destructive"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/jpeg;base64,${shot}`} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => retake(index)}
                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Retake capture ${index + 1}`}
                  >
                    <RotateCcw className="h-4 w-4 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {failure && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-sm font-medium text-destructive">{failure.message}</p>
              {failure.failures?.length ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {failure.failures.map((code) => FAILURE_LABELS[code] ?? code).join(", ")}
                </p>
              ) : null}
              {typeof failure.frame === "number" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => retake(failure.frame!)}
                >
                  Retake that capture
                </Button>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
            <Checkbox
              checked={consented}
              onCheckedChange={(value) => setConsented(value === true)}
              className="mt-0.5"
            />
            <span className="text-xs leading-relaxed text-muted-foreground">{settings.consentText}</span>
          </label>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          {shots.length < target ? (
            <Button onClick={capture} disabled={camera !== "ready"}>
              <Camera className="h-4 w-4" />
              Capture
            </Button>
          ) : null}
          <Button onClick={submit} disabled={!enough || !consented || isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save {shots.length > 0 ? `${shots.length} capture${shots.length === 1 ? "" : "s"}` : ""}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

const CAMERA_MESSAGES: Partial<Record<CameraState, { message: string; fix?: string }>> = {
  insecure: {
    message: "The camera needs a secure connection.",
    fix: "Open this page over https://, or on localhost.",
  },
  denied: {
    message: "Camera access is blocked for this site.",
    fix: "Click the camera icon in the address bar, allow access, then try again.",
  },
  busy: {
    message: "Another app is using the camera.",
    fix: "Close anything else using it — a video call, or another tab — then try again.",
  },
  unavailable: {
    message: "No camera is connected to this device.",
    fix: "Plug one in, or use a device with a front camera.",
  },
  unusable: { message: "The camera couldn't be started.", fix: "Try again, or reload the page." },
};
