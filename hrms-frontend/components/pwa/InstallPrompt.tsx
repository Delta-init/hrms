"use client";
import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Offer to install the app, from inside the app.
 *
 * Everything needed to be installable was already in place — manifest, icons,
 * service worker — but nothing ever said so. Chrome's own prompt is a small
 * icon in the address bar that nobody notices, and on iOS there is no prompt at
 * all: Safari only installs through the share sheet, which people have to be
 * told about.
 *
 * Asked once. Dismissing it is remembered, because an install banner that comes
 * back every morning is an advert, not an offer.
 *
 * `persistent` is the other half of that bargain: on a page somebody went to
 * looking for it, the offer stays put — no dismissing, no remembering, and it
 * still shows when the browser has not offered a prompt, because "how do I
 * install this" needs an answer even when there is no button to press.
 */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED = "hrms_install_dismissed";

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as { standalone?: boolean }).standalone === true;

export function InstallPrompt({ persistent = false }: { persistent?: boolean } = {}) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Nothing to offer once it is already running as an app.
    if (isStandalone()) { setInstalled(true); return; }
    // A past dismissal is only remembered where the banner arrives uninvited.
    if (!persistent && localStorage.getItem(DISMISSED)) return;
    setDismissed(false);

    // iOS never fires this, so it gets instructions instead of a button.
    if (isIos()) { setShowIosHelp(true); return; }

    const onPrompt = (e: Event) => {
      // Chrome shows its own bar otherwise, and two offers is worse than one.
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [persistent]);

  const close = () => {
    localStorage.setItem(DISMISSED, "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // A page kept for this purpose does not close itself; it just stops having
    // a button once the browser has spent the prompt.
    setEvent(null);
    if (outcome === "accepted") setInstalled(true);
    else if (!persistent) close();
  };

  if (installed) return null;
  // Uninvited, it appears only when there is something to press or explain.
  // Asked for, it always answers — including when the browser has offered no
  // prompt, which is itself the thing that needs explaining.
  if (!persistent && (dismissed || (!event && !showIosHelp))) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
      <Download className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Install Delta HRMS</p>
        <p className="text-xs text-muted-foreground">
          {showIosHelp ? (
            <>
              Tap <Share className="inline h-3 w-3" /> Share, then &ldquo;Add to Home Screen&rdquo; to
              open it like an app.
            </>
          ) : event ? (
            "Add it to your device to open it straight from your home screen."
          ) : (
            // No button to offer: either the browser has not decided yet, or it
            // does not install apps at all. Saying where to look beats a banner
            // that names a button nobody can find.
            "Open this page in Chrome or Edge and use Install from the address bar, or your browser's menu."
          )}
        </p>
      </div>
      {event && (
        <Button size="sm" onClick={install} className="shrink-0">Install</Button>
      )}
      {!persistent && (
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
