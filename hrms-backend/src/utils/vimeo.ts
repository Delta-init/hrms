/**
 * Reading Vimeo's answers about a video: whether HRMS can play it, and what
 * the player needs. Pure, so the rules can be tested without Vimeo.
 *
 * A video plays inside HRMS when Vimeo lets it be embedded here and lets
 * people who aren't signed in to Vimeo watch it:
 * - privacy.embed must not be "private" (embedding switched off). "public"
 *   (anywhere) and "whitelist" (chosen sites) both can be; a whitelist that
 *   leaves HRMS out shows Vimeo's own "not allowed" message in the player.
 * - privacy.view must be "anybody", "unlisted" or "disable" (hidden from
 *   vimeo.com but embeddable). "nobody" (only me), "password", "contacts" and
 *   "users" need a Vimeo login or password the joiner doesn't have.
 * - and it must have finished processing.
 */

export interface VimeoApiVideo {
  uri?: string;
  name?: string;
  duration?: number;
  link?: string;
  player_embed_url?: string;
  status?: string;
  privacy?: { view?: string; embed?: string };
  pictures?: { sizes?: { width?: number; link?: string }[] };
}

export interface VimeoVideo {
  id: string;
  /** The unlisted hash, needed to play an unlisted video; "" when there is none. */
  hash: string;
  name: string;
  durationSeconds: number;
  thumbnail: string | null;
  /** vimeo.com page, for the head to open. */
  link: string;
  playable: boolean;
  /** Why it can't play inside HRMS, and what to change in Vimeo. */
  reason: string | null;
}

const PLAYABLE_VIEWS = new Set(["anybody", "unlisted", "disable"]);
const VIEW_REASON: Record<string, string> = {
  nobody: "It's set to Private (only you) in Vimeo — set it to Public.",
  password: "It has a password in Vimeo — remove the password.",
  contacts: "Only your Vimeo contacts can watch it — set it to Public.",
  users: "Only people signed in to Vimeo can watch it — set it to Public.",
};

/** "1029384756" from "/videos/1029384756". */
export const videoIdOf = (v: VimeoApiVideo) => /\/videos\/(\d+)/.exec(v.uri ?? "")?.[1] ?? "";

/** The unlisted hash from the embed URL's ?h=, or from a link like vimeo.com/123/abcdef. */
export function hashOf(v: VimeoApiVideo): string {
  try {
    const h = v.player_embed_url ? new URL(v.player_embed_url).searchParams.get("h") : null;
    if (h) return h;
  } catch { /* fall through */ }
  return /vimeo\.com\/\d+\/([0-9a-f]+)/i.exec(v.link ?? "")?.[1] ?? "";
}

export function toVimeoVideo(v: VimeoApiVideo): VimeoVideo {
  const id = videoIdOf(v);
  const view = v.privacy?.view ?? "anybody";
  const embed = v.privacy?.embed ?? "public";
  const seconds = Math.round(v.duration ?? 0);
  let reason: string | null = null;
  if (v.status && v.status !== "available") reason = "Vimeo is still processing it — try again in a few minutes.";
  else if (embed === "private") reason = "Embedding is switched off for it in Vimeo — allow it to be embedded.";
  else if (!PLAYABLE_VIEWS.has(view)) reason = VIEW_REASON[view] ?? "Its Vimeo privacy setting doesn't let others watch it — set it to Public.";
  else if (seconds < 1) reason = "Vimeo didn't give its length.";
  const sizes = (v.pictures?.sizes ?? []).filter((s) => s.link);
  const thumb = sizes.find((s) => (s.width ?? 0) >= 200) ?? sizes[sizes.length - 1];
  return {
    id, hash: hashOf(v), name: v.name?.trim() || "Untitled video", durationSeconds: seconds,
    thumbnail: thumb?.link ?? null, link: v.link ?? (id ? `https://vimeo.com/${id}` : ""),
    playable: !!id && !reason, reason,
  };
}

/**
 * The player's address. No title, byline or picture over the video, no
 * picture-in-picture, keyboard shortcuts off (arrow keys skip), and dnt so
 * Vimeo doesn't set tracking cookies on the joiner.
 */
export function vimeoEmbedUrl(id: string, hash: string): string {
  const q = new URLSearchParams({ dnt: "1", title: "0", byline: "0", portrait: "0", pip: "0", keyboard: "0", speed: "0" });
  if (hash) q.set("h", hash);
  return `https://player.vimeo.com/video/${id}?${q.toString()}`;
}
