"use client";
import { useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useBoardLink, useResetBoardLink } from "@/hooks/useMeetings";

/**
 * The link to the public meeting board — for a screen in the lobby, or anyone
 * who wants to see which pods are taken without signing in. Room admins can
 * reset it, which retires every copy already handed out.
 */
export function BoardLinkDialog({ open, onOpenChange, canReset }: { open: boolean; onOpenChange: (o: boolean) => void; canReset: boolean }) {
  const { data, isLoading } = useBoardLink(open);
  const { mutate: reset, isPending: resetting } = useResetBoardLink();
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const url = data?.token && typeof window !== "undefined" ? `${window.location.origin}/board/${data.token}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* the field is selectable as a fallback */ }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Public meeting board</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-3 px-4 pb-4 sm:px-0">
          <p className="text-sm text-muted-foreground">
            Today&rsquo;s room and pod bookings, like a departures board — no sign-in needed. Put it on a screen, or share it with anyone you&rsquo;re happy to show the day&rsquo;s bookings to.
          </p>
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="flex gap-2">
              <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copy} disabled={!url} aria-label="Copy link">
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" asChild aria-label="Open board">
                <a href={url || "#"} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a>
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Titles and who booked are shown; review meetings show only &ldquo;Review meeting&rdquo;.</p>
          {canReset && (
            <Button variant="ghost" size="sm" className="text-destructive" disabled={resetting || !url} onClick={() => setConfirm(true)}>
              <RefreshCw className="h-3.5 w-3.5" />Reset link
            </Button>
          )}
        </div>
      </ResponsiveDialogContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Reset the board link?"
        description="Every copy of the current link stops working, including on any screen showing it. You'll need to share the new link again."
        confirmLabel="Reset"
        isPending={resetting}
        onConfirm={() => reset(undefined, { onSuccess: () => setConfirm(false) })}
      />
    </ResponsiveDialog>
  );
}
