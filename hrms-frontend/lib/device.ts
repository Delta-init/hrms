/**
 * This browser's identity, for attendance device binding.
 *
 * A remote employee's punches are tied to one browser. The tie is a random key
 * this browser mints once and keeps; the server stores only its hash and
 * refuses any punch that presents a different one.
 *
 * Worth being plain about what this is and is not. It identifies a *browser
 * profile*, not a machine: the same laptop in a second browser, or in private
 * browsing, is a different device as far as this is concerned, and a person
 * determined to work around it can copy the key out of their own storage.
 * The point is that using a second device takes deliberate effort and leaves a
 * record, instead of being the easiest thing to do.
 */

const KEY = "hrms.device-key";

/** 32 hex characters from the platform CSPRNG. */
function mint(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The key for this browser, creating it on first call.
 *
 * Returns null when storage is unavailable — private browsing, or site data
 * blocked. The caller sends nothing, and the server refuses the punch with an
 * explanation, which is a better outcome than a key that silently evaporates
 * and re-registers a "new" device on every visit.
 */
export function deviceKey(): string | null {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && existing.length >= 16) return existing;
    const fresh = mint();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

/** Something a person would recognise in a list: "Chrome on macOS". */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser =
    /\bEdg(?:e|A|iOS)?\//.test(ua) ? "Edge"
    : /\bOPR\/|\bOpera\//.test(ua) ? "Opera"
    : /\bSamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /\bFirefox\/|\bFxiOS\//.test(ua) ? "Firefox"
    : /\bChrome\/|\bCriOS\//.test(ua) ? "Chrome"
    : /\bSafari\//.test(ua) ? "Safari"
    : "Browser";
  const os =
    /\bWindows NT\b/.test(ua) ? "Windows"
    : /\bAndroid\b/.test(ua) ? "Android"
    : /\b(iPhone|iPad|iPod)\b/.test(ua) ? "iOS"
    : /\bMac OS X\b/.test(ua) ? "macOS"
    : /\bCrOS\b/.test(ua) ? "ChromeOS"
    : /\bLinux\b/.test(ua) ? "Linux"
    : "device";
  return `${browser} on ${os}`;
}

/**
 * A short digest of what this machine looks like.
 *
 * Never used to allow or refuse a punch — user agents change with every browser
 * update, and a person should not lose a day's pay to Tuesday's patch. It is
 * recorded so the same key appearing on a visibly different machine can be
 * flagged for someone to look at.
 *
 * FNV-1a rather than SubtleCrypto: this is a change-detector, not a security
 * primitive, and the crypto API is async and unavailable outside a secure
 * context — neither of which is worth taking on for a corroborating signal.
 */
export function deviceFingerprint(): string {
  const parts = [
    navigator.userAgent,
    navigator.language,
    // Screen geometry, which survives a browser update but not a new machine.
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency ?? ""),
  ].join("|");

  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
