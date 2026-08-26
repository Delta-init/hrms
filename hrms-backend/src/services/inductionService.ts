import { InductionVideo } from "../models/InductionVideo.js";
import { VideoView } from "../models/VideoView.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { publicUrl } from "../config/r2.js";
import { fail } from "./agreementService.js";

/**
 * Watching the induction, measured on the server.
 *
 * The browser never says whether the video finished; it reports where the
 * playhead is every few seconds and the server decides. The whole test is that
 * a position cannot advance faster than the clock — two minutes of video takes
 * two minutes of real time, and scrubbing does not change that.
 *
 * What it cannot stop is somebody scripting the heartbeats on a timer. Nothing
 * a browser reports can be trusted absolutely; this makes cheating deliberate
 * and slow rather than a click on the progress bar, and it records the attempt.
 */

/** Wall-clock slack per beat, for network jitter and a throttled background tab. */
const GRACE_SECONDS = 1.5;
/** Credit needed to count as watched — a little under the full length. */
const COMPLETION_RATIO = 0.95;
/** How near the end the playhead must actually reach. */
const END_TOLERANCE = 2;

export async function activeVideo() {
  const video = await InductionVideo.findOne(scoped({ active: true })).sort({ createdAt: -1 }).lean();
  if (!video) {
    throw fail("No induction video has been uploaded yet. An administrator must add one before anyone can complete onboarding.", 409, "VIDEO_MISSING");
  }
  return video;
}

const summarise = (view: { watchedSeconds: number; lastPosition: number; completedAt?: Date | null; skipAttempts: number }, duration: number) => ({
  duration,
  watchedSeconds: Math.round(view.watchedSeconds),
  lastPosition: Math.round(view.lastPosition),
  completed: !!view.completedAt,
  completedAt: view.completedAt ?? null,
  skipAttempts: view.skipAttempts,
  /** What the person sees as progress — credit, not playhead, so scrubbing shows nothing. */
  percent: Math.min(100, Math.round((view.watchedSeconds / duration) * 100)),
});

/** Open (or resume) this person's view. Resuming keeps the credit already earned. */
export async function startView(userId: string) {
  const video = await activeVideo();
  const now = new Date();
  await VideoView.updateOne(
    scoped({ user: userId, video: video._id }),
    {
      $setOnInsert: { organization: getOrgId(), user: userId, video: video._id, startedAt: now },
      // Re-anchor the clock on every open: the gap since they closed the tab
      // is not watching time, and crediting it would hand back the whole video.
      $set: { lastBeatAt: now },
    },
    { upsert: true }
  );
  const view = await VideoView.findOne(scoped({ user: userId, video: video._id })).lean();
  return {
    video: { _id: video._id, title: video.title, url: publicUrl(video.fileKey), durationSeconds: video.durationSeconds },
    progress: summarise(view!, video.durationSeconds),
  };
}

/**
 * Record where the playhead is, and credit whatever the clock allows.
 *
 * Credit is `min(position advance, wall-clock elapsed)`, so a forward scrub
 * earns only the seconds that actually passed. Pausing earns nothing, because
 * the position does not move. Rewinding earns nothing and costs nothing.
 */
export async function heartbeat(userId: string, rawPosition: number) {
  const video = await activeVideo();
  const view = await VideoView.findOne(scoped({ user: userId, video: video._id }));
  if (!view) throw fail("Open the video before reporting progress", 400, "VIEW_NOT_STARTED");
  if (view.completedAt) return summarise(view, video.durationSeconds);

  const position = Math.max(0, Math.min(rawPosition, video.durationSeconds));
  const now = new Date();
  const since = view.lastBeatAt ?? view.startedAt ?? now;
  const elapsed = Math.max(0, (now.getTime() - since.getTime()) / 1000);
  const advance = position - view.lastPosition;

  // A jump the clock cannot account for is a scrub. Recorded, and credited
  // only for the time that genuinely passed.
  if (advance > elapsed + GRACE_SECONDS) view.skipAttempts += 1;

  view.watchedSeconds += Math.max(0, Math.min(advance, elapsed + GRACE_SECONDS));
  view.lastPosition = position;
  view.lastBeatAt = now;

  if (
    view.watchedSeconds >= video.durationSeconds * COMPLETION_RATIO &&
    position >= video.durationSeconds - END_TOLERANCE
  ) {
    view.completedAt = now;
  }
  await view.save();
  return summarise(view, video.durationSeconds);
}

/** The view record, or null when they have never opened it. */
export async function viewFor(userId: string) {
  const video = await InductionVideo.findOne(scoped({ active: true })).sort({ createdAt: -1 }).lean();
  if (!video) return null;
  const view = await VideoView.findOne(scoped({ user: userId, video: video._id })).lean();
  return view ? { view, video } : { view: null, video };
}
