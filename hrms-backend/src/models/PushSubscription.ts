import mongoose, { Schema } from "mongoose";
import type { IPushSubscription } from "../types/index.js";

/**
 * A browser's address for Web Push — where a notification still reaches
 * somebody with the app fully closed, which the in-app bell cannot do.
 *
 * One person has many of these: a phone, a laptop, a work desktop are three
 * separate subscriptions, and telling somebody means telling all of them.
 * `endpoint` is unique because re-subscribing on the same device must upsert
 * rather than pile up a duplicate that would otherwise double the send.
 *
 * The endpoint itself is effectively a bearer credential — anyone holding it
 * can push to that device — so it is never logged and never returned to a
 * client that isn't the one who owns the row.
 */
const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true, versionKey: false }
);

export const PushSubscription = mongoose.model<IPushSubscription>("PushSubscription", pushSubscriptionSchema);
