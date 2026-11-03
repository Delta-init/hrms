import { InductionVideo } from "../models/InductionVideo.js";
import { VideoView } from "../models/VideoView.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { publicUrl } from "../config/r2.js";
import { fail } from "./agreementService.js";
import { addSpan, coveredSeconds, firstGap, furthestReached, playedSpan, type Span } from "../utils/watchSpans.js";

/**
 * Watching the induction, measured on the server.
 *
 * The browser never says whether the video finished; it reports where the
 * playhead is every few seconds and the server decides. The whole test is that
 * a position cannot advance faster than the clock — two minutes of video takes
 * two minutes of real time, and scrubbing does not change that.
 *
 * What is kept is which stretches were played, not a running total: playing a
 * part again covers nothing new, so the progress shown is how much of the video
 * has been seen, and finishing needs the end to have been reached at some point
 * — not the final heartbeat to have landed there.
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
/** A part missed by less than this is jitter between beats, not somewhere to send them back to. */
const GAP_SECONDS = 1;

export async function activeVideo() {
  const video = await InductionVideo.findOne(scoped({ active: true })).sort({ createdAt: -1 }).lean();
  if (!video) {
    throw fail("No induction video has been uploaded yet. An administrator must add one before anyone can complete onboarding.", 409, "VIDEO_MISSING");
  }
  return video;
}

type ViewState = { spans?: Span[]; watchedSeconds: number; lastPosition: number; completedAt?: Date | null; skipAttempts: number };

/**
 * What they have watched, as stretches.
 *
 * Views from before stretches were kept have only a running total, and that
 * counted re-watching — 191 seconds of a 142-second video, for somebody last
 * seen at 0:05. The honest reading of one is the start up to where they were,
 * no further, and that is what they carry on from.
 */
const spansOf = (view: ViewState): Span[] => {
  if (view.spans?.length) return view.spans.map((s) => ({ from: s.from, to: s.to }));
  const to = Math.min(view.lastPosition, view.watchedSeconds);
  return to > 0 ? [{ from: 0, to }] : [];
};

const summarise = (view: ViewState, duration: number) => {
  const spans = spansOf(view);
  const furthest = furthestReached(spans);
  const reachedEnd = furthest >= duration - END_TOLERANCE;
  return {
    duration,
    watchedSeconds: Math.round(view.completedAt ? view.watchedSeconds : coveredSeconds(spans)),
    lastPosition: Math.round(view.lastPosition),
    /** How far they may skip ahead to, and the player's bar shows as reached. */
    furthest: Math.floor(furthest),
    /**
     * Where the player opens: the first part they have not seen — which a jump
     * can leave behind — or else the furthest point. Having reached the end
     * without enough of it, even a short gap is where they go back to.
     */
    resumeAt: Math.floor(firstGap(spans, furthest, GAP_SECONDS) ?? (reachedEnd ? firstGap(spans, furthest) : null) ?? furthest),
    /** The end has been reached, but too much before it was missed to count. */
    reachedEnd,
    completed: !!view.completedAt,
    completedAt: view.completedAt ?? null,
    skipAttempts: view.skipAttempts,
    /** What the person sees as progress — the video seen, each part once, so neither scrubbing nor re-watching moves it. */
    percent: view.completedAt ? 100 : Math.min(100, Math.round((coveredSeconds(spans) / duration) * 100)),
  };
};

/** Open (or resume) this person's view. Resuming keeps what they have already watched. */
export async function startView(userId: string) {
  const video = await activeVideo();
  const now = new Date();
  await VideoView.updateOne(
    scoped({ user: userId, video: video._id }),
    { $setOnInsert: { organization: getOrgId(), user: userId, video: video._id, startedAt: now } },
    { upsert: true }
  );
  const view = (await VideoView.findOne(scoped({ user: userId, video: video._id })).lean())!;
  const progress = summarise(view, video.durationSeconds);
  if (!view.completedAt) {
    // Re-anchor on every open. The clock, because the gap since they closed
    // the tab is not watching time, and crediting it would hand back the whole
    // video. The position, because the player opens at `resumeAt`, and the
    // first beat must not read the move there from wherever they last were as
    // a jump.
    await VideoView.updateOne(scoped({ _id: view._id }), { $set: { lastBeatAt: now, lastPosition: progress.resumeAt } });
    progress.lastPosition = progress.resumeAt;
  }
  return {
    video: { _id: video._id, title: video.title, url: publicUrl(video.fileKey), durationSeconds: video.durationSeconds },
    progress,
  };
}

/**
 * Record where the playhead is, and mark as watched whatever the clock allows.
 *
 * A beat covers the stretch from the last position to this one if that much
 * time passed, and only the seconds before where it landed if not — so a
 * forward scrub earns just the time that genuinely went by. Pausing covers
 * nothing, because the position does not move. Rewinding costs nothing, and
 * playing a part again covers nothing new.
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
  const before = spansOf(view);

  const played = playedSpan(view.lastPosition, position, elapsed, GRACE_SECONDS);
  // A jump past anything watched, further than the clock can account for, is
  // a scrub — recorded. Skipping ahead over ground already covered is not:
  // the player allows it, and it earns nothing.
  if (played?.outran && position > furthestReached(before) + GRACE_SECONDS) view.skipAttempts += 1;

  const spans = played ? addSpan(before, played.from, played.to) : before;
  view.set("spans", spans);
  view.watchedSeconds = coveredSeconds(spans);
  view.lastPosition = position;
  view.lastBeatAt = now;

  if (
    view.watchedSeconds >= video.durationSeconds * COMPLETION_RATIO &&
    furthestReached(spans) >= video.durationSeconds - END_TOLERANCE
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
