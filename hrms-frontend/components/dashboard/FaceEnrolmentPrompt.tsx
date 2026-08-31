"use client";
import { useEffect, useState } from "react";
import { ScanFace, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMyAgreements } from "@/hooks/useAgreements";
import { useFaceSettings, useFaceStatus } from "@/hooks/useFaceEnrollment";
import { FaceCaptureDialog } from "@/components/face/FaceCaptureDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Ask for a face from somebody who got in without leaving one.
 *
 * Onboarding holds new joiners at the face step, but everybody who was already
 * inside when the requirement was switched on never passed through it — and
 * they are the people who will be standing at the kiosk on Monday unable to
 * clock in. Nobody would think to visit their own profile to fix that, so the
 * ask has to come to them.
 *
 * Shown only where it can actually be acted on: the organisation asks for face
 * check-in, the matching service is reachable, and this person has no face on
 * file. All three are decided by the server.
 *
 * Dismissible, and it stays dismissed for the day. This is a reminder about a
 * thing that will bite later, not a gate — the gate is onboarding, and a
 * dialog somebody cannot close is how people learn to stop reading them.
 */

const HIDDEN_UNTIL = "hrms_face_prompt_hidden_until";

export function FaceEnrolmentPrompt() {
  const { user } = useAuth();
  const userId = user?._id ?? "";
  const { data: state } = useMyAgreements({ enabled: !!userId });
  const { data: settings } = useFaceSettings();
  const { data: status } = useFaceStatus(userId, !!settings?.enabled && !!userId);
  const [capturing, setCapturing] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  // Read on the client only: localStorage does not exist while rendering on
  // the server, and a prompt that flashes in and out is worse than a late one.
  useEffect(() => {
    try {
      const until = Number(window.localStorage.getItem(HIDDEN_UNTIL) ?? 0);
      setDismissed(Date.now() < until);
    } catch {
      setDismissed(false);
    }
  }, []);

  const hideForToday = () => {
    try {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      window.localStorage.setItem(HIDDEN_UNTIL, String(tomorrow.getTime()));
    } catch { /* a browser refusing storage just means it asks again */ }
    setDismissed(true);
  };

  const wanted = !!state?.faceRequired && !!settings?.enabled;
  const missing = status ? !status.enrolled : false;
  if (!userId || !wanted || !missing || dismissed) return null;

  return (
    <>
      <Card className="flex flex-wrap items-center gap-4 border-primary/30 bg-primary/5 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ScanFace className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Set up face check-in</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            You have no face on file yet, so the kiosk cannot recognise you. It takes about a minute
            and needs a camera.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCapturing(true)}>
            <ScanFace className="h-4 w-4" />Enrol now
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground"
                  onClick={hideForToday} aria-label="Remind me tomorrow">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {settings && (
        <FaceCaptureDialog
          open={capturing}
          onOpenChange={setCapturing}
          userId={userId}
          userName={user?.name ?? "You"}
          settings={settings}
        />
      )}
    </>
  );
}
