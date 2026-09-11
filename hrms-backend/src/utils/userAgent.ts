/**
 * Whether a User-Agent string reads as a phone or tablet.
 *
 * Self-reported by the browser, so this is a policy signal, not a lock — the
 * same standing as the remote-device binding beside it. It is enough to stop
 * an ordinary phone sign-in without asking anyone to install anything.
 */
export function isMobileUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  return /iPhone|iPad|iPod|Android/i.test(userAgent);
}
