"use client";
import { useState } from "react";
import { Loader2, ScanFace, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FaceCaptureDialog } from "@/components/face/FaceCaptureDialog";
import { useAuth } from "@/hooks/useAuth";
import { useDeleteFaceProfile, useFaceSettings, useFaceStatus } from "@/hooks/useFaceEnrollment";

/**
 * Face enrollment for one person, on their user page.
 *
 * Keyed on the user rather than the employee record because attendance is —
 * only people with a login have punches to attach a face to.
 */
export function FaceEnrollmentPanel({ userId, userName }: { userId: string | null; userName: string }) {
  const { user, hasPermission } = useAuth();
  const { data: settings } = useFaceSettings();
  const { data: status, isLoading } = useFaceStatus(userId ?? "", !!settings?.enabled && !!userId);
  const { mutate: remove, isPending: deleting } = useDeleteFaceProfile(userId ?? "");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Enrolling somebody else is an HR action; your own face is your own to
  // manage. Same rule the API enforces.
  const isSelf = !!userId && user?._id === userId;
  const canManage = isSelf || hasPermission("employees", "edit");

  // Hidden entirely when the recognition service isn't configured — an empty
  // panel offering a feature the server can't perform helps nobody.
  if (!settings?.enabled) return null;

  /**
   * Somebody with no login cannot enrol.
   *
   * A face is matched to a punch through the account, so there is nothing to
   * attach one to yet. Said here rather than hiding the panel: an employee page
   * with no mention of face check-in reads as "this person is done", when what
   * is actually needed is a login first.
   */
  if (!userId) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-muted p-2">
            <ScanFace className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Face check-in</h3>
              <Badge variant="outline">Needs a login</Badge>
            </div>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              A face is matched to whoever is clocking in through their account, so {userName} needs
              a login before one can be set up. Create it from the Employees list.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <ScanFace className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Face check-in</h3>
              {isLoading ? null : status?.enrolled ? (
                <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600">
                  Enrolled
                </Badge>
              ) : (
                <Badge variant="outline">Not enrolled</Badge>
              )}
            </div>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              {status?.enrolled
                ? `${status.captures} capture${status.captures === 1 ? "" : "s"} on file` +
                  (status.consentAt
                    ? ` · consent recorded ${new Date(status.consentAt).toLocaleDateString()}`
                    : "")
                : isSelf
                  // The same panel now appears on your own profile, where
                  // "this person" is you and reads as though written about
                  // somebody else.
                  ? "Set up your face so you can clock in and out at the kiosk."
                  : "Enrol a face so this person can clock in and out at the kiosk."}
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            {status?.enrolled && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </Button>
            )}
            <Button size="sm" onClick={() => setCaptureOpen(true)}>
              <ScanFace className="h-4 w-4" />
              {status?.enrolled ? "Re-enrol" : "Enrol face"}
            </Button>
          </div>
        )}
      </div>

      <FaceCaptureDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        userId={userId}
        userName={userName}
        settings={settings}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete face data?"
        description={`${userName}'s face data will be permanently deleted and they will no longer be recognised at the kiosk. Their attendance history is not affected.`}
        confirmLabel="Delete"
        isPending={deleting}
        onConfirm={() => remove()}
      />
    </Card>
  );
}
