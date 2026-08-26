import mongoose, { Schema } from "mongoose";

/**
 * One person's progress through the induction video, kept on the server.
 *
 * The browser is not asked whether the video finished, because a browser that
 * can answer that can also lie about it. It reports where the playhead is,
 * every few seconds, and the server decides — the test being that the position
 * cannot advance faster than the clock. Watching 142 seconds of video takes
 * 142 seconds of real time, and no amount of scrubbing changes that.
 *
 * A heartbeat that breaks the rule is counted rather than rejected outright:
 * a laggy connection or a paused tab produces the odd bad beat, and refusing
 * the whole session over one would fail honest people. What it cannot do is
 * accumulate credit, because `watchedSeconds` only ever grows by what the
 * clock allows.
 */
const videoViewSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    video: { type: Schema.Types.ObjectId, ref: "InductionVideo", required: true },
    startedAt: { type: Date, default: Date.now },
    /** Where the playhead was at the last accepted heartbeat. */
    lastPosition: { type: Number, default: 0, min: 0 },
    lastBeatAt: { type: Date, default: null },
    /** Credited watch time. Grows by min(position advance, wall-clock elapsed). */
    watchedSeconds: { type: Number, default: 0, min: 0 },
    /** Beats whose position outran the clock — a scrub, or a very confused tab. */
    skipAttempts: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

// One view record per person per video: re-watching continues the same row
// rather than starting a fresh one that could be completed independently.
videoViewSchema.index({ organization: 1, user: 1, video: 1 }, { unique: true });

export const VideoView = mongoose.model("VideoView", videoViewSchema);
