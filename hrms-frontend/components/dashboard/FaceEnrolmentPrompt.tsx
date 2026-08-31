"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ScanFace, Eye } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useFaceSettings, useFaceStatus } from "@/hooks/useFaceEnrollment";
import { FaceCaptureDialog } from "@/components/face/FaceCaptureDialog";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";

/**
 * Ask for a face from somebody who got in without leaving one.
 *
 * Onboarding holds new joiners at the face step, but everybody already inside
 * when the requirement was switched on never passed through it — and they are
 * the people who will be standing at the kiosk unable to clock in. Nobody would
 * think to visit their own profile to fix that, so the ask comes to them.
 *
 * Shown only where it can be acted on: the organisation asks for face check-in,
 * the matching service is reachable, and this person has no face on file. All
 * three are the server's answer rather than a guess made here, so turning the
 * policy off or losing the service stops the asking instead of leaving a prompt
 * nothing can satisfy.
 *
 * A dialog, and dismissible until midnight. It interrupts because a face is the
 * difference between clocking in and standing at a tablet that does not know
 * you — but it closes, because a dialog somebody cannot close is how people
 * learn to dismiss dialogs without reading them.
 */

const HIDDEN_UNTIL = "hrms_face_prompt_hidden_until";

export function FaceEnrolmentPrompt() {
  const { user } = useAuth();
  const { data: session } = useSession();
  const userId = user?._id ?? "";
  const { data: settings } = useFaceSettings();
  const { data: status } = useFaceStatus(userId, !!settings?.enabled && !!userId);
  const [capturing, setCapturing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [decided, setDecided] = useState(false);
  /**
   * Taken out of the tree on dismissal rather than left to animate away.
   *
   * Radix unmounts a closed dialog when its exit animation ends, and an
   * animation that never runs — a background tab, a device with animations
   * turned off — leaves the panel on screen with nothing to close it. Whether
   * somebody can dismiss a dialog should not rest on an animation frame.
   */
  const [gone, setGone] = useState(false);

  const wanted = !!settings?.required;
  const missing = status ? !status.enrolled : false;

  /**
   * Never enrol while impersonating.
   *
   * The captures come from whoever is at the camera while the request carries
   * the impersonated person's id, so this would file an administrator's face as
   * somebody else's in the system that decides who clocked in. The dialog still
   * opens, because hiding it leaves an admin checking the feature convinced it
   * is broken.
   */
  const impersonating = !!(session as { impersonatedBy?: unknown } | null)?.impersonatedBy;

  // Opened once the answer is actually known, and only if it was not put off
  // earlier today. Reading storage during render would differ between server
  // and client and flash the dialog open on every load.
  useEffect(() => {
    if (decided || !wanted || !missing) return;
    let until = 0;
    try { until = Number(window.localStorage.getItem(HIDDEN_UNTIL) ?? 0); } catch { /* storage refused */ }
    if (Date.now() < until) { setDecided(true); return; }
    setAsking(true);
    setDecided(true);
  }, [wanted, missing, decided]);

  const notNow = () => {
    try {
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      window.localStorage.setItem(HIDDEN_UNTIL, String(midnight.getTime()));
    } catch { /* a browser refusing storage just means it asks again */ }
    setAsking(false);
    setGone(true);
  };

  if (!userId || !wanted || !missing) return null;

  return (
    <>
      {!gone && (
      <ResponsiveDialog open={asking} onOpenChange={(o) => (o ? setAsking(true) : notNow())}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <ScanFace className="h-5 w-5 text-primary" />Set up face check-in
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
              {impersonating
                ? "They have no face on file, so the kiosk cannot recognise them."
                : "You have no face on file, so the kiosk cannot recognise you when you clock in."}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="space-y-3 px-4 sm:px-0">
            {impersonating ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
                <Eye className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  You are viewing as somebody else. The camera would capture <strong>your</strong> face
                  and file it as theirs, so the kiosk would then recognise you as them. It has to be
                  done from their own device, or by HR with them present.
                </span>
              </div>
            ) : (
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li>· Takes about a minute, and needs a working camera.</li>
                <li>· {settings?.minCaptures ?? 3}–{settings?.maxCaptures ?? 5} photos, so it recognises you in different light.</li>
                <li>· You can delete it at any time from your profile.</li>
              </ul>
            )}
          </div>

          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={notNow}>Not now</Button>
            <Button
              onClick={() => { setAsking(false); setGone(true); setCapturing(true); }}
              disabled={impersonating}
            >
              <ScanFace className="h-4 w-4" />Enrol my face
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      )}

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
