/**
 * A link to a joiner's presentation video somewhere other than HRMS — for a
 * recording too big to upload. Only the hosts heads can open in one click and
 * that keep a video private to those with the link: Google Drive, YouTube and
 * Vimeo. Anything else is refused rather than stored, so a head is never sent
 * to an arbitrary site from an HRMS page.
 */

const HOSTS: { test: RegExp; name: string }[] = [
  { test: /^(drive|docs)\.google\.com$/, name: "Google Drive" },
  { test: /^((www|m)\.)?youtube\.com$|^youtu\.be$/, name: "YouTube" },
  { test: /^((www|player)\.)?vimeo\.com$/, name: "Vimeo" },
];

/** The link, tidied, and where it is — or null when it isn't a video link we take. */
export function videoLink(raw: string): { url: string; host: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = HOSTS.find((h) => h.test.test(url.hostname.toLowerCase()));
  if (!host) return null;
  // A link to the site's front page is not a video.
  if (url.pathname.replace(/\/+$/, "") === "" && !url.searchParams.has("v")) return null;
  return { url: url.toString(), host: host.name };
}
