"use client";
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The link to the public meeting board — a plain address, for a screen in
 * the lobby or anyone who wants to see which pods are free without signing in.
 */
export function BoardLinkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/board` : "/board";

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
            Which rooms and pods are free, and today&rsquo;s bookings, like a departures board — no sign-in needed. Works on a landscape or portrait screen, and on a phone.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" asChild aria-label="Open board">
              <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a>
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Anyone with the address can open it. Titles and who booked are shown; review meetings show only &ldquo;Review meeting&rdquo;.</p>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
