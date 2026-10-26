"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { PlayCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useMyAgreements } from "@/hooks/useAgreements";
import { useGuideSeen, useMarkGuideSeen } from "@/hooks/useGuide";

const VIDEO = "/videos/hrms-guide.mp4";
const POSTER = "/videos/hrms-guide-poster.jpg";

/**
 * The HRMS guide — a six-minute portrait video of the employee app. Full
 * screen on a phone, a tall card on a computer. Closing it, skipping it or
 * reaching the end all count as seen.
 *
 * Rendered at the root of the page: opened from the header, whose blurred
 * background would otherwise trap a fixed overlay inside the header itself.
 */
export function GuideVideoDialog({ open, onClose, welcome = false }: { open: boolean; onClose: () => void; welcome?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnded(false);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label="Delta HRMS guide">
      <div className="flex h-full w-full flex-col bg-background sm:h-auto sm:max-h-[92vh] sm:w-auto sm:overflow-hidden sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-4">
          <div className="min-w-0">
            <p className="text-base font-semibold">{welcome ? "Welcome to Delta HRMS" : "HRMS guide"}</p>
            <p className="text-xs text-muted-foreground">
              {welcome ? "Your onboarding is done. Here's a 6-minute tour of everything you'll use." : "A 6-minute tour of the app."}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black sm:flex-none">
          {/* Portrait: on a computer the card takes its width from the height it is allowed. */}
          <video
            ref={video}
            src={VIDEO}
            poster={POSTER}
            controls
            playsInline
            preload="metadata"
            onEnded={() => setEnded(true)}
            className="h-full max-h-full w-full object-contain sm:h-[min(72vh,800px)] sm:w-auto sm:aspect-[9/16]"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:pb-4">
          {ended ? (
            <Button onClick={onClose}>Get started</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>{welcome ? "Skip" : "Close"}</Button>
              <Button variant="outline" onClick={() => video.current?.play()}><PlayCircle className="h-4 w-4" />Play</Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Opens the guide once, by itself: the first time someone reaches the
 * dashboard with onboarding behind them — profile done and, where the
 * organisation asks for them, agreements signed. Watched, skipped or closed,
 * it is marked seen and never opens by itself again. Not for a kiosk login,
 * and not while impersonating somebody else.
 */
export function GuideWelcome() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { isKioskOnly } = useAuth();
  const impersonating = !!session?.impersonatedBy;
  const profileDone = (session?.user as { profileCompleted?: boolean } | undefined)?.profileCompleted === true;
  const ready = status === "authenticated" && !impersonating && !isKioskOnly && profileDone && pathname === "/dashboard";
  const { data: agreements, isError: noAgreements } = useMyAgreements({ enabled: ready });
  // As the onboarding gate reads it: no agreements to sign (no employee record,
  // no template) is not a block — only an unsigned requirement is.
  const agreementsDone = noAgreements || (!!agreements && (!agreements.required || agreements.cleared !== false));
  const { data: seen } = useGuideSeen(ready && agreementsDone);
  const { mutate: markSeen } = useMarkGuideSeen();
  const [open, setOpen] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current || !ready || !agreementsDone || !seen) return;
    if (seen.guideSeenAt === null) {
      shown.current = true;
      setOpen(true);
    }
  }, [ready, agreementsDone, seen]);

  return (
    <GuideVideoDialog
      open={open}
      welcome
      onClose={() => { setOpen(false); markSeen(); }}
    />
  );
}
