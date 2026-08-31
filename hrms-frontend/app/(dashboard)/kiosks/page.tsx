"use client";
import { useState } from "react";
import {
  Check, Copy, Loader2, MonitorSmartphone, Plus, RotateCcw, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription,
  ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { useFaceSettings } from "@/hooks/useFaceEnrollment";
import {
  useDeleteKiosk, useKiosks, useRegisterKiosk, useRotateKioskToken, useSetKioskActive,
} from "@/hooks/useKiosks";
import type { Kiosk, PairedKiosk } from "@/types";

/**
 * Kiosk devices — the tablets running face check-in.
 *
 * Pairing produces a token shown exactly once. That is the whole security model
 * for a device nobody signs in to, so the dialog is built around not letting
 * someone close it before they have copied it.
 */
export default function KiosksPage() {
  const { hasPermission, isLoading: sessionLoading } = useAuth();
  const { data: faceSettings } = useFaceSettings();
  // Edit, not view: every employee holds attendance.view for their own hours,
  // and this page is only ever used to register a device or rotate its token.
  const canView = hasPermission("attendance", "edit");
  const canEdit = hasPermission("attendance", "edit");
  const canDelete = hasPermission("attendance", "delete");

  const { data: kiosks, isLoading } = useKiosks(canView);
  const { mutate: setActive } = useSetKioskActive();
  const { mutate: remove, isPending: deleting } = useDeleteKiosk();
  const { mutate: rotate, isPending: rotating } = useRotateKioskToken();

  const [pairOpen, setPairOpen] = useState(false);
  const [paired, setPaired] = useState<PairedKiosk | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Kiosk | null>(null);

  // Permissions can't be judged until the session resolves, and answering
  // "you don't have access" in the meantime accuses people of something that
  // isn't true and flashes away a moment later.
  if (sessionLoading) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!canView) {
    return <Card className="p-12 text-center text-sm text-muted-foreground">You don&apos;t have access to kiosks.</Card>;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Check-in kiosks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tablets that recognise staff at the door and record their attendance.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setPairOpen(true)}>
            <Plus className="h-4 w-4" />
            Pair a device
          </Button>
        )}
      </div>

      {/* Liveness off means a punch is one straight-on frame, which a printed
          photo or a phone screen satisfies. That is a deliberate choice, but it
          has to stay visible to whoever runs these devices. */}
      {faceSettings?.enabled && faceSettings.livenessRequired === false && (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
            Anti-spoofing is off — a photo can clock someone in
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Kiosks punch from a single frame, so holding up a photo of an enrolled
            employee will check them in. Keep these devices where someone can see them.
            To turn it back on, set <span className="font-mono">FACE_LIVENESS_MODE=required</span>{" "}
            on the server.
          </p>
        </Card>
      )}

      {!faceSettings?.enabled && (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
            Face recognition isn&apos;t configured on the server
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Kiosks can be paired, but they won&apos;t be able to recognise anyone until
            FACE_SERVICE_URL and FACE_SERVICE_KEY are set.
          </p>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !kiosks?.length ? (
        <Card className="p-12 text-center">
          <MonitorSmartphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No kiosks yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pair a tablet, then open <span className="font-mono">/kiosk</span> on it and enter the token.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {kiosks.map((kiosk) => (
            <Card key={kiosk._id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{kiosk.name}</p>
                  {kiosk.active ? (
                    <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600">Active</Badge>
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                  <span className="font-mono text-xs text-muted-foreground">···{kiosk.tokenHint}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {kiosk.location || "No location set"} ·{" "}
                  {kiosk.lastSeenAt
                    ? `last used ${new Date(kiosk.lastSeenAt).toLocaleString()}`
                    : "never used"}
                </p>
              </div>

              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setActive({ id: kiosk._id, active: !kiosk.active })}>
                    {kiosk.active ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rotating}
                    onClick={() => rotate(kiosk._id, { onSuccess: (result) => setPaired(result) })}
                  >
                    <RotateCcw className="h-4 w-4" />
                    New token
                  </Button>
                  {canDelete && (
                    <Button variant="outline" size="sm" onClick={() => setConfirmDelete(kiosk)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <PairDialog open={pairOpen} onOpenChange={setPairOpen} onPaired={setPaired} />
      <TokenDialog paired={paired} onClose={() => setPaired(null)} />

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Remove this kiosk?"
        description={`${confirmDelete?.name} will stop working immediately. Attendance already recorded from it is unaffected.`}
        confirmLabel="Remove"
        isPending={deleting}
        onConfirm={() => {
          if (confirmDelete) remove(confirmDelete._id, { onSuccess: () => setConfirmDelete(null) });
        }}
      />
    </div>
  );
}

function PairDialog({
  open, onOpenChange, onPaired,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaired: (paired: PairedKiosk) => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const { mutate: register, isPending } = useRegisterKiosk();

  const submit = () => {
    register(
      { name: name.trim(), location: location.trim() || undefined },
      {
        onSuccess: (result) => {
          onPaired(result);
          onOpenChange(false);
          setName("");
          setLocation("");
        },
      }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Pair a device</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-2 sm:px-0">
            Give the tablet a name you&apos;ll recognise in this list.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="kiosk-name">Name</Label>
            <Input id="kiosk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Reception tablet" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kiosk-location">Location (optional)</Label>
            <Input id="kiosk-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Main entrance, 2nd floor" />
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Pair
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** The token is shown here and nowhere else, ever again. */
function TokenDialog({ paired, onClose }: { paired: PairedKiosk | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!paired) return;
    await navigator.clipboard.writeText(paired.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ResponsiveDialog open={!!paired} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Device token for {paired?.name}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-2 sm:px-0">
            Copy this now — it can&apos;t be shown again. Open <span className="font-mono">/kiosk</span> on
            the tablet and paste it there. If you lose it, issue a new one.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="px-4 sm:px-0">
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="break-all font-mono text-xs leading-relaxed">{paired?.token}</p>
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
          <Button onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy token"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
