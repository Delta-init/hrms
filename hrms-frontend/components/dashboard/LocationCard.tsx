"use client";
import { useCallback, useEffect, useState } from "react";
import { MapPin, MapPinOff, ShieldAlert, RefreshCw, CheckCircle2, Loader2, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LocationGuide } from "@/components/shared/LocationGuide";
import { useTodayAttendance } from "@/hooks/useSelfAttendance";
import { probeLocation, readPermission, needsAttention, type LocationState } from "@/lib/geolocation";

/**
 * Whether this device can say where a punch was made, checked before it matters.
 *
 * Location is only discovered to be off at the moment somebody presses Clock In
 * — which is the worst moment to find out, because they are standing at the
 * start of their day being told to go into system settings. Checking on the
 * dashboard moves that discovery to a point where nothing is at stake and there
 * is time to fix it.
 *
 * Shown only to people whose punch actually requires a location. For everybody
 * else this is a card about a permission they will never be asked for, and a
 * warning nobody needs is a warning everybody learns to close.
 *
 * The probe is a real request rather than a permission read, because a
 * permission cannot see a laptop whose location services are switched off
 * system-wide: that reads as "granted" right up until something asks.
 */
export function LocationCard() {
  const { data } = useTodayAttendance();
  const [state, setState] = useState<LocationState>("unknown");
  const [checking, setChecking] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const required = !!data?.punchPolicy.locationRequired;

  const check = useCallback(async (ask: boolean) => {
    setChecking(true);
    // A silent read first. Where it already says denied there is nothing to be
    // gained by asking — the browser will not prompt, and the request only
    // costs a GPS spin-up before failing the same way.
    const permission = await readPermission();
    if (permission === "denied") {
      setState("denied");
      setChecking(false);
      setShowGuide(true);
      return;
    }
    if (!ask && permission === "granted") {
      // Granted is not proof: the device may still be refusing everyone. Probe
      // anyway, which is silent when it works.
      setState(await probeLocation());
      setChecking(false);
      return;
    }
    if (!ask && permission === "prompt") {
      setState("prompt");
      setChecking(false);
      return;
    }
    const result = await probeLocation();
    setState(result);
    setChecking(false);
    if (needsAttention(result)) setShowGuide(true);
  }, []);

  useEffect(() => {
    if (!required) return;
    void check(false);
  }, [required, check]);

  if (!required) return null;
  // Working, and silent about it. A green tick that never changes is furniture.
  if (state === "granted") return null;

  const asking = state === "prompt";

  const tone = asking
    ? {
        ring: "border-primary/30 bg-primary/5",
        icon: MapPin,
        colour: "text-primary",
        title: "Turn on location for your punches",
        body: "Your attendance is recorded from home, so each punch carries where it was made. Allow it once and you will not be asked again.",
      }
    : state === "device-off"
      ? {
          ring: "border-amber-500/30 bg-amber-500/10",
          icon: MapPinOff,
          colour: "text-amber-600 dark:text-amber-400",
          title: "Location is switched off on this device",
          body: "Your device is not giving any app a location, so your punch will be refused. This is a system setting, not a browser one.",
        }
      : state === "denied"
        ? {
            ring: "border-amber-500/30 bg-amber-500/10",
            icon: ShieldAlert,
            colour: "text-amber-600 dark:text-amber-400",
            title: "Location is blocked for this site",
            body: "Your browser remembers that it was declined and will not ask again, so your punch will be refused until it is allowed.",
          }
        : state === "unsupported"
          ? {
              ring: "border-amber-500/30 bg-amber-500/10",
              icon: MapPinOff,
              colour: "text-amber-600 dark:text-amber-400",
              title: "This browser cannot provide a location",
              body: "Open the site over https in a current browser — over a plain http address location is withheld entirely.",
            }
          : {
              ring: "border-muted-foreground/20 bg-muted/40",
              icon: MapPin,
              colour: "text-muted-foreground",
              title: state === "timeout" ? "Could not get a location in time" : "Checking location…",
              body:
                state === "timeout"
                  ? "This usually means a weak signal indoors. Try again near a window, or on mobile data."
                  : "One moment.",
            };

  const Icon = tone.icon;

  return (
    <Card className={cn("border p-4", tone.ring)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", tone.colour)} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{tone.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{tone.body}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {asking ? (
              <Button size="sm" className="h-8 gap-1.5" disabled={checking} onClick={() => check(true)}>
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                Allow location
              </Button>
            ) : (
              <>
                {/* Re-checks rather than reloads, so somebody who fixed it in
                    another window is not made to lose this page to find out. */}
                <Button
                  size="sm" variant="outline" className="h-8 gap-1.5"
                  disabled={checking}
                  onClick={() => check(true)}
                >
                  {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Check again
                </Button>
                <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => window.location.reload()}>
                  Reload page
                </Button>
              </>
            )}

            {needsAttention(state) && (
              <button
                type="button"
                onClick={() => setShowGuide((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {showGuide ? "Hide" : "How do I fix this?"}
                <ChevronDown className={cn("h-3 w-3 transition-transform", showGuide && "rotate-180")} />
              </button>
            )}
          </div>

          {showGuide && needsAttention(state) && <LocationGuide state={state} className="mt-3" />}

          {/* The one reassurance worth giving unprompted: people decline
              location because they assume it is continuous. */}
          {asking && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
              Read only when you clock in or out — never in the background, and never while you are not using the app.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
