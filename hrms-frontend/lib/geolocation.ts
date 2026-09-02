"use client";

/**
 * What is actually wrong with location, and on which machine.
 *
 * "Location is off" hides two entirely different problems with two entirely
 * different fixes, and telling somebody the wrong one sends them to a settings
 * screen where the switch they need is already on:
 *
 *   - the *site* is blocked — the browser remembers a refusal for this address
 *     and will not prompt again. Fixed beside the address bar.
 *   - the *device* has location switched off — the operating system will not
 *     give any application a fix. Fixed in system settings, and no amount of
 *     clicking Allow in the browser will help.
 *
 * The browser reports these differently: a refusal is PERMISSION_DENIED, and a
 * device with location services off is POSITION_UNAVAILABLE. That distinction
 * is the whole reason this file exists.
 */

export type LocationState =
  /** Working — a fix came back. */
  | "granted"
  /** Never asked, or asked and dismissed. The prompt will still appear. */
  | "prompt"
  /** Refused for this site. The browser will not ask again. */
  | "denied"
  /** The device will not provide a fix to anything — location services off. */
  | "device-off"
  /** No geolocation at all: an insecure origin, or an old browser. */
  | "unsupported"
  /** Asked and nothing came back in time. Usually indoors, usually transient. */
  | "timeout"
  /** Not yet determined. */
  | "unknown";

export type Platform = "ios" | "android" | "windows" | "mac" | "other";

/**
 * Which system's settings to describe.
 *
 * User-agent sniffing, which is unreliable in general and adequate here: the
 * cost of guessing wrong is a guide opening on the wrong tab, and every tab is
 * one click away. iPadOS is reported as a Mac, so it is separated by the touch
 * points its desktop namesake does not have.
 */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/iPad/.test(ua)) return "ios";
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  return "other";
}

/** Chrome, Safari, Firefox or Edge — for naming the right menu. */
export function detectBrowser(): "chrome" | "safari" | "firefox" | "edge" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  // Chrome's UA contains Safari, so Chrome and Edge are excluded first.
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

/**
 * The permission alone, without asking for a fix.
 *
 * Cheap and silent — no prompt, no GPS — but it cannot see whether the device
 * has location switched off, because that is not a permission. Safari has no
 * Permissions API for geolocation at all, so "unknown" is a real answer here
 * rather than a failure.
 */
export async function readPermission(): Promise<LocationState> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return "unsupported";
  if (!navigator.permissions?.query) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state as LocationState;
  } catch {
    return "unknown";
  }
}

/**
 * Actually ask for a fix, and report precisely what came back.
 *
 * This is the only way to learn that the device's location services are off:
 * the permission can read "granted" on a laptop whose location switch is off
 * system-wide, and the failure only appears when something asks.
 */
export async function probeLocation(timeout = 12_000): Promise<LocationState> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return "unsupported";
  try {
    await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout,
        maximumAge: 60_000,
      });
    });
    return "granted";
  } catch (e) {
    const err = e as GeolocationPositionError | undefined;
    if (err?.code === 1) return "denied";
    // POSITION_UNAVAILABLE. On every platform this is what a device with
    // location services switched off returns — the browser was allowed to ask
    // and the system had nothing to give it.
    if (err?.code === 2) return "device-off";
    if (err?.code === 3) return "timeout";
    return "unknown";
  }
}

/** Whether this state is one somebody has to go and fix. */
export const needsAttention = (s: LocationState) =>
  s === "denied" || s === "device-off" || s === "unsupported";
