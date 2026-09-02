"use client";
import { useEffect, useState } from "react";
import { Apple, Smartphone, Monitor, Laptop, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { detectPlatform, detectBrowser, type LocationState, type Platform } from "@/lib/geolocation";

/**
 * How to switch location back on, on the machine this person is actually using.
 *
 * Two different problems live behind the same phrase, and the steps are not
 * interchangeable. A site the browser has blocked is fixed beside the address
 * bar; a device with location services switched off is fixed in system
 * settings, and no amount of clicking Allow in the browser will help. Somebody
 * sent to the wrong one finds the switch they were told to change already in
 * the position they were told to put it in, and concludes the app is broken.
 *
 * So the two are written separately, and the tab opens on the platform this
 * browser reports. The others stay reachable — a guess from a user-agent string
 * is a guess, and somebody reading over a colleague's shoulder needs the other
 * tabs anyway.
 */

const PLATFORMS: Array<{ id: Platform; label: string; icon: typeof Apple }> = [
  { id: "ios", label: "iPhone / iPad", icon: Apple },
  { id: "android", label: "Android", icon: Smartphone },
  { id: "windows", label: "Windows", icon: Monitor },
  { id: "mac", label: "Mac", icon: Laptop },
];

/** Turning the device's location services back on. */
const DEVICE_STEPS: Record<Platform, string[]> = {
  ios: [
    "Open Settings",
    "Privacy & Security → Location Services",
    "Turn Location Services on",
    "Scroll down to your browser (Safari or Chrome) and set it to “While Using the App”",
    "Return here and reload the page",
  ],
  android: [
    "Swipe down from the top and check the Location tile is on",
    "Or: Settings → Location → turn Use location on",
    "Settings → Apps → your browser → Permissions → Location → Allow only while using the app",
    "Return here and reload the page",
  ],
  windows: [
    "Press Start and open Settings",
    "Privacy & security → Location",
    "Turn Location services on",
    "Turn Let apps access your location on",
    "Scroll to Let desktop apps access your location and make sure it is on",
    "Return here and reload the page",
  ],
  mac: [
    "Open System Settings",
    "Privacy & Security → Location Services",
    "Turn Location Services on",
    "Find your browser in the list and switch it on",
    "Return here and reload the page",
  ],
  other: [
    "Open your system settings and turn location services on",
    "Allow your browser to use location",
    "Return here and reload the page",
  ],
};

/** Un-blocking this particular site, once the device itself is fine. */
function siteSteps(platform: Platform, browser: ReturnType<typeof detectBrowser>): string[] {
  if (platform === "ios") {
    return browser === "safari"
      ? [
          "Tap the ⚙︎ or ᴀA button on the left of the address bar",
          "Website Settings → Location → Allow",
          "Reload the page",
        ]
      : [
          "Tap the ⋯ or ⓘ button beside the address bar",
          "Site settings (or Permissions) → Location → Allow",
          "Reload the page",
        ];
  }
  if (platform === "android") {
    return [
      "Tap the padlock or ⓘ beside the address bar",
      "Permissions → Location → Allow",
      "Reload the page",
    ];
  }
  if (browser === "firefox") {
    return [
      "Click the padlock beside the address bar",
      "Clear the blocked Location permission (the ✕ beside it)",
      "Reload the page and choose Allow when asked",
    ];
  }
  return [
    "Click the padlock (or ⓘ / sliders icon) beside the address bar",
    "Set Location to Allow",
    "Reload the page",
  ];
}

function Steps({ items, tone }: { items: string[]; tone: "device" | "site" }) {
  return (
    <ol className="mt-2 space-y-1.5">
      {items.map((s, i) => (
        <li key={s} className="flex gap-2 text-xs leading-relaxed">
          <span
            className={cn(
              "mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums",
              tone === "device"
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "bg-primary/15 text-primary"
            )}
          >
            {i + 1}
          </span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

export function LocationGuide({ state, className }: { state: LocationState; className?: string }) {
  /**
   * Detected after mount, never during render.
   *
   * `navigator` does not exist on the server, so reading it while rendering
   * makes the server and the client disagree about which steps to print — and
   * React throws away the whole tree rather than patch it. Both sides therefore
   * start on the same default and the real answer arrives on the first effect,
   * which is soon enough that nobody sees the difference.
   */
  const [detected, setDetected] = useState<{ platform: Platform; browser: ReturnType<typeof detectBrowser> } | null>(null);
  const [picked, setPicked] = useState<Platform | null>(null);

  useEffect(() => {
    const p = detectPlatform();
    setDetected({ platform: p === "other" ? "windows" : p, browser: detectBrowser() });
  }, []);

  // What the reader chose wins over what was detected; the default is the same
  // on both sides of hydration.
  const platform: Platform = picked ?? detected?.platform ?? "windows";
  const browser = detected?.browser ?? "other";

  // Which problem to lead with. A device with location off is the one that
  // makes the browser's own setting irrelevant, so it comes first when that is
  // what the browser reported.
  const deviceFirst = state === "device-off";

  return (
    <div className={cn("rounded-lg border border-border bg-muted/30 p-3", className)}>
      <div className="flex flex-wrap gap-1">
        {PLATFORMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPicked(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              platform === id
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        {deviceFirst ? (
          <>
            <section>
              <p className="text-xs font-semibold">1 · Turn location on for the device</p>
              <p className="text-[11px] text-muted-foreground">
                Your device is refusing every app, not just this one.
              </p>
              <Steps items={DEVICE_STEPS[platform]} tone="device" />
            </section>
            <section>
              <p className="text-xs font-semibold">2 · If it still fails, allow this site</p>
              <Steps items={siteSteps(platform, browser)} tone="site" />
            </section>
          </>
        ) : (
          <>
            <section>
              <p className="text-xs font-semibold">1 · Allow this site</p>
              <p className="text-[11px] text-muted-foreground">
                Your browser remembers the refusal and will not ask again on its own.
              </p>
              <Steps items={siteSteps(platform, browser)} tone="site" />
            </section>
            <section>
              <p className="text-xs font-semibold">2 · If it still fails, check the device</p>
              <Steps items={DEVICE_STEPS[platform]} tone="device" />
            </section>
          </>
        )}
      </div>

      {/* The one step people skip, and the reason "I allowed it and it still
          says off" is the commonest report: a page already open is handed the
          old answer until it reloads. */}
      <p className="mt-3 flex items-start gap-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
        After changing any of these, this page must be reloaded — a page that is already open keeps the
        old answer until it is.
      </p>
    </div>
  );
}
