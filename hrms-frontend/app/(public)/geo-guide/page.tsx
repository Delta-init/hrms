"use client";
import { useEffect, useState } from "react";
import { LocationGuide } from "@/components/shared/LocationGuide";
import { probeLocation, readPermission, detectPlatform, detectBrowser, type LocationState } from "@/lib/geolocation";

/**
 * The location guide on its own page, reachable without signing in.
 *
 * Somebody whose location is blocked is often being talked through it by
 * whoever they rang for help, from a different device and usually a different
 * platform. Sending them a link beats reading a settings path down a phone, and
 * the page has to work before the dashboard does — the account it belongs to is
 * not the point, the machine in their hands is.
 *
 * It also reports what this browser actually says, which turns "it does not
 * work" into a specific answer somebody can act on.
 */
export default function GeoGuidePage() {
  const [permission, setPermission] = useState<LocationState>("unknown");
  const [probe, setProbe] = useState<LocationState>("unknown");
  const [checking, setChecking] = useState(false);
  // After mount, for the same reason the guide does it: `navigator` is not
  // there on the server, and reading it while rendering makes the two disagree.
  const [device, setDevice] = useState("…");

  useEffect(() => {
    void readPermission().then(setPermission);
    setDevice(`${detectPlatform()} · ${detectBrowser()}`);
  }, []);

  const run = async () => {
    setChecking(true);
    setProbe(await probeLocation());
    setPermission(await readPermission());
    setChecking(false);
  };

  return (
    <main className="mx-auto max-w-lg p-5">
      <h1 className="text-lg font-bold">Turning on location</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your punches record where they were made, so this device needs to be able to give a location.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <dt className="text-muted-foreground">This device</dt>
        <dd className="font-medium">{device}</dd>
        <dt className="text-muted-foreground">Site permission</dt>
        <dd className="font-medium">{permission}</dd>
        <dt className="text-muted-foreground">Last check</dt>
        <dd className="font-medium">{probe}</dd>
      </dl>

      <button
        type="button"
        onClick={run}
        disabled={checking}
        className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {checking ? "Checking…" : "Check my location"}
      </button>

      <LocationGuide state={probe === "unknown" ? permission : probe} className="mt-4" />
    </main>
  );
}
