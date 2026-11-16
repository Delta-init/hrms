import { env } from "../config/env.js";
import { toVimeoVideo, type VimeoApiVideo, type VimeoVideo } from "../utils/vimeo.js";

/**
 * The company's Vimeo folder, read with a personal access token — read-only:
 * HRMS only ever asks Vimeo what is in the folder; it never changes anything
 * there.
 *
 * Video homework can be picked from this folder instead of uploading an MP4.
 * The length that the watching is checked against comes from here, on the
 * server, never from the browser.
 */

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const FIELDS = "uri,name,duration,link,player_embed_url,status,privacy.view,privacy.embed,pictures.sizes";
/** Short, so a video fixed in Vimeo shows as playable again soon, while a head scrolling the list doesn't ask Vimeo every time. */
const CACHE_MS = 2 * 60 * 1000;
const MAX_PAGES = 10;

let cache: { at: number; videos: VimeoVideo[] } | null = null;

export const vimeoConnected = () => !!env.VIMEO_ACCESS_TOKEN && !!env.VIMEO_FOLDER_ID;

async function vimeoGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.VIMEO_API_URL.replace(/\/+$/, "")}${path}`, {
      headers: { Authorization: `bearer ${env.VIMEO_ACCESS_TOKEN}`, Accept: "application/vnd.vimeo.*+json;version=3.4" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw fail("Couldn't reach Vimeo. Try again in a moment.", 502);
  }
  if (res.status === 401) throw fail("Vimeo refused HRMS's access token — it may have been revoked. Ask whoever manages the server to add a new one.", 502);
  if (res.status === 404) throw fail("Vimeo couldn't find the folder HRMS is set up with.", 502);
  if (!res.ok) throw fail(`Vimeo answered with an error (${res.status}). Try again in a moment.`, 502);
  return (await res.json()) as T;
}

/** Every video in the folder, and in the folders inside it, newest first as Vimeo gives them. */
export async function folderVideos(fresh = false): Promise<VimeoVideo[]> {
  if (!vimeoConnected()) throw fail("Vimeo isn't connected to HRMS yet.", 409);
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.videos;
  const out: VimeoVideo[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await vimeoGet<{ data?: VimeoApiVideo[]; paging?: { next?: string | null } }>(
      `/me/projects/${env.VIMEO_FOLDER_ID}/videos?include_subfolders=true&per_page=100&page=${page}&fields=${encodeURIComponent(FIELDS)}`
    );
    for (const v of body.data ?? []) {
      const video = toVimeoVideo(v);
      if (video.id) out.push(video);
    }
    if (!body.paging?.next) break;
  }
  cache = { at: Date.now(), videos: out };
  return out;
}

/**
 * One video from the folder, checked afresh — refused, saying why, if it
 * isn't in the folder or HRMS can't play it.
 */
export async function folderVideo(id: string): Promise<VimeoVideo> {
  let video = (await folderVideos()).find((v) => v.id === id);
  // Just added or just fixed in Vimeo: the list may be a minute old.
  if (!video || !video.playable) video = (await folderVideos(true)).find((v) => v.id === id);
  if (!video) throw fail("That video isn't in the company's Vimeo folder.", 404);
  if (!video.playable) throw fail(`“${video.name}” can't play inside HRMS. ${video.reason ?? ""}`.trim());
  return video;
}
