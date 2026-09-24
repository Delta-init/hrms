"use client";
import { useState } from "react";
import { Expand, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  src: string;
  /** Shown above the photo — where it was taken, or what it is of. */
  caption?: string;
  alt?: string;
  /** Classes for the thumbnail itself. */
  className?: string;
}

/**
 * A photo you can look at without leaving the page.
 *
 * Opening the file in a new tab hands somebody a bare signed URL and a tab to
 * close afterwards, which is the right thing for saving a copy and the wrong
 * one for the common case — glancing at what was photographed and carrying on
 * reading the list. The link is still there, under the photo, for the times
 * the file itself is what is wanted.
 */
export function PhotoViewer({ src, caption, alt = "", className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={caption ? `View the photo from ${caption}` : "View the photo"}
        className="group relative shrink-0 overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={cn("h-16 w-16 rounded-md border border-border object-cover", className)} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
          <Expand className="h-4 w-4 text-white" />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[92vw] gap-3 p-4 sm:max-w-3xl">
          <DialogTitle className="pr-8 text-sm font-medium">{caption || "Photo"}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-[72vh] w-full rounded-md bg-muted/40 object-contain" />
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />Open the original
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
