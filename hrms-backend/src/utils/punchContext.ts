import { createRequire } from "node:module";
import type { Request } from "express";

// The geo database is loaded through require, not import: it is optional (see
// `offlineLookup`) and a static import would make it a hard dependency.
const requireOptional = createRequire(import.meta.url);

/**
 * Where a punch was made from.
 *
 * Recorded for work-from-home check-ins, where nobody walks past a kiosk and
 * the punch is the only evidence that the day happened. Two halves, and the
 * difference between them matters when a punch is ever disputed:
 *
 *  - what the *server* observed — the IP the request actually arrived from,
 *    and the country that IP belongs to. Not forgeable by the person punching.
 *  - what the *browser* reported — coordinates, timezone. Useful, corroborating,
 *    and trivially faked by anyone who opens devtools. Evidence, not proof.
 *
 * Everything is optional. A punch with no location is a normal punch by
 * somebody who declined the browser prompt, not an error.
 */

/** What the browser offers. Untrusted: it arrives in the request body. */
export interface PunchClientContext {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  locationSource?: "gps" | "denied" | "unavailable" | "unsupported";
  timeZone?: string;
}

export interface PunchContext {
  ip: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  locationSource: PunchClientContext["locationSource"] | null;
  timeZone: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  deviceType: "mobile" | "tablet" | "desktop" | null;
}

const header = (req: Request, name: string): string | null => {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s ? String(s) : null;
};

/**
 * Three decimal places — roughly a hundred metres.
 *
 * Enough to answer the question attendance asks ("were they at the address on
 * file?") and not enough to say which room of the house they were in. The full
 * precision a phone reports is a level of detail about somebody's home that
 * nobody here needs and that would sit in the database for years.
 */
const coarse = (n: number | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;

/**
 * Browser, OS and form factor from a User-Agent string.
 *
 * Deliberately shallow. User agents are a thicket of compatibility lies — every
 * browser claims to be Mozilla, Edge claims to be Chrome — so the order of these
 * tests is the whole trick, and a complete parser is a dependency that needs
 * updating each time a new browser appears. This answers the only question
 * attendance asks of it, and returns null rather than guessing.
 *
 * The raw string is stored alongside, so a wrong summary is always correctable.
 */
function parseUserAgent(ua: string): Pick<PunchContext, "browser" | "os" | "deviceType"> {
  const browser =
    /\bEdg(?:e|A|iOS)?\//.test(ua) ? "Edge"
    : /\bOPR\/|\bOpera\//.test(ua) ? "Opera"
    : /\bSamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /\bFirefox\/|\bFxiOS\//.test(ua) ? "Firefox"
    : /\bChrome\/|\bCriOS\//.test(ua) ? "Chrome"
    : /\bSafari\//.test(ua) ? "Safari"
    : null;

  const os =
    /\bWindows NT\b/.test(ua) ? "Windows"
    : /\bAndroid\b/.test(ua) ? "Android"
    : /\b(iPhone|iPad|iPod)\b/.test(ua) ? "iOS"
    : /\bMac OS X\b/.test(ua) ? "macOS"
    : /\bCrOS\b/.test(ua) ? "ChromeOS"
    : /\bLinux\b/.test(ua) ? "Linux"
    : null;

  // "Mobile" is the one token every phone browser agrees on. An iPad omits it
  // (and claims macOS) when "Request Desktop Site" is on, which is the default,
  // so tablets are recognised by name rather than by what they claim to be.
  const deviceType: PunchContext["deviceType"] =
    /\biPad\b/.test(ua) || (/\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua)) ? "tablet"
    : /\bMobile\b|\biPhone\b/.test(ua) ? "mobile"
    : "desktop";

  return { browser, os, deviceType };
}

/**
 * The country an IP belongs to.
 *
 * Preferred source is the edge: Cloudflare and Vercel both resolve this before
 * the request reaches us and pass the answer down, which is exact and free.
 * Behind a plain server those headers are absent, so we fall back to an offline
 * lookup — chosen over an IP-geolocation API on purpose, because an API means
 * handing every employee's home IP address to a third party in order to learn
 * which country they are in.
 *
 * Loaded lazily and allowed to be missing: the package is large, and a
 * deployment that drops it should lose the country field, not the punch.
 */
let geo: { lookup(ip: string): { country?: string; region?: string; city?: string } | null } | null | undefined;

function offlineLookup(ip: string) {
  if (geo === undefined) {
    try {
      geo = requireOptional("geoip-lite");
    } catch {
      geo = null;
    }
  }
  try {
    return geo?.lookup(ip) ?? null;
  } catch {
    return null;
  }
}

function place(req: Request, ip: string | null) {
  const edgeCountry = header(req, "cf-ipcountry") ?? header(req, "x-vercel-ip-country");
  // Vercel percent-encodes these, since a city name may contain anything.
  const decode = (v: string | null) => {
    if (!v) return null;
    try { return decodeURIComponent(v); } catch { return v; }
  };

  if (edgeCountry && edgeCountry !== "XX") {
    return {
      country: edgeCountry.toUpperCase(),
      city: decode(header(req, "x-vercel-ip-city")),
      region: decode(header(req, "x-vercel-ip-country-region")),
    };
  }

  // Private and loopback addresses belong to no country; the lookup returns
  // nothing for them, which is the right answer rather than a wrong one.
  const hit = ip ? offlineLookup(ip) : null;
  return {
    country: hit?.country?.toUpperCase() || null,
    city: hit?.city || null,
    region: hit?.region || null,
  };
}

export function buildPunchContext(req: Request, client?: PunchClientContext): PunchContext {
  // `req.ip` honours Express's `trust proxy` setting, which is off unless
  // TRUST_PROXY says otherwise — see index.ts for why that default is the safe
  // one. Never read X-Forwarded-For directly: unset, anyone can claim any IP.
  const ip = req.ip ?? null;
  const userAgent = header(req, "user-agent");

  const lat = coarse(client?.latitude);
  const lng = coarse(client?.longitude);
  // A pair or nothing: half a coordinate locates no one, and storing one of the
  // two invites a reader to believe the other means something on its own.
  const hasFix = lat !== null && lng !== null;

  return {
    ip,
    ...place(req, ip),
    latitude: hasFix ? lat : null,
    longitude: hasFix ? lng : null,
    accuracy: hasFix && typeof client?.accuracy === "number" ? Math.round(client.accuracy) : null,
    locationSource: client?.locationSource ?? null,
    timeZone: client?.timeZone ?? null,
    userAgent: userAgent ? userAgent.slice(0, 400) : null,
    ...(userAgent ? parseUserAgent(userAgent) : { browser: null, os: null, deviceType: null }),
  };
}
