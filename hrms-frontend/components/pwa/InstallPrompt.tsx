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
  /** Steps unfolded because there was no prompt to fire. */
  const [showSteps, setShowSteps] = useState(false);

  // Read once on the client — the render branches on it, not only the effect.
  const [isIosDevice, setIsIosDevice] = useState(false);

  useEffect(() => {
    setIsIosDevice(isIos());
    // Nothing to offer once it is already running as an app.
    if (isStandalone()) { setInstalled(true); return; }
    // A past dismissal is only remembered where the banner arrives uninvited.
    if (!persistent && localStorage.getItem(DISMISSED)) return;
    setDismissed(false);

    // iOS never fires this, so it gets instructions instead of a button.
    if (isIos()) { setShowIosHelp(true); return; }

    // Usually already caught: the script in the document head listens before
    // React exists, because Chrome fires this once and fires it early — long
    // before an effect could be listening.
    const stashed = (window as { __hrmsInstallEvent?: InstallEvent }).__hrmsInstallEvent;
    if (stashed) setEvent(stashed);

    const onPrompt = (e: Event) => {
      // Chrome shows its own bar otherwise, and two offers is worse than one.
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onStashed = () => {
      const e = (window as { __hrmsInstallEvent?: InstallEvent }).__hrmsInstallEvent;
      if (e) setEvent(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("hrms:installready", onStashed);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("hrms:installready", onStashed);
    };
  }, [persistent]);

  const close = () => {
    // localStorage.setItem(DISMISSED, "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // Spent — Chrome will not accept the same event twice.
    (window as { __hrmsInstallEvent?: InstallEvent | null }).__hrmsInstallEvent = null;
    // A page kept for this purpose does not close itself; it just stops having
    // a button once the browser has spent the prompt.
    setEvent(null);
    if (outcome === "accepted") setInstalled(true);
    else if (!persistent) close();
  };

  if (installed || dismissed) return null;
  // Uninvited, it appears only when there is something to press or explain.
  // Asked for, it always answers — including when the browser has offered no
  // prompt, which is itself the thing that needs explaining.
  // if (!persistent && (dismissed || (!event && !showIosHelp))) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
      <Download className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Install Delta HRMS</p>
        <p className="text-xs text-muted-foreground">
          {showIosHelp || (showSteps && !event) ? (
            isIosDevice ? (
              <>
                Tap <Share className="inline h-3 w-3" /> Share, then &ldquo;Add to Home
                Screen&rdquo; to open it like an app.
              </>
            ) : (
              // The browser has not offered a prompt, so there is no prompt to
              // fire. Where to find its own control beats a button that would
              // do nothing when pressed.
              <>Use <strong>Install</strong> from the address bar, or your browser&rsquo;s menu → Install
              Delta HRMS. Chrome and Edge offer it; Safari installs through Share.</>
            )
          ) : (
            "Add it to your device to open it straight from your home screen."
          )}
        </p>
      </div>
      {/* Always a button where the offer is permanent. With a prompt in hand it
          installs; without one it unfolds the steps for this browser, which is
          the only honest thing a button can do when the browser has given us
          nothing to fire. */}
      {(event || persistent) && (
        <Button
          size="sm"
          onClick={event ? install : () => setShowSteps((v) => !v)}
          className="shrink-0"
          variant={event ? "default" : "outline"}
        >
          {event ? "Install" : showSteps ? "Hide steps" : "How to install"}
        </Button>
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
