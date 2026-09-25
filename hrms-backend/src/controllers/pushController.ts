import type { NextFunction, Response } from "express";
import { PushSubscription } from "../models/PushSubscription.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { getOrgId } from "../utils/orgContext.js";
import { env } from "../config/env.js";

/** Not secret — safe to hand to any logged-in caller. Empty when Web Push
 *  hasn't been configured, which the frontend reads as "don't offer this". */
export const getVapidPublicKey = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "VAPID public key", { publicKey: env.VAPID_PUBLIC_KEY ?? "" }); }
  catch (error) { next(error); }
};

export const subscribePush = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { endpoint, keys } = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!endpoint || !keys?.p256dh || !keys?.auth) { sendError(res, "Invalid subscription object", 400); return; }

    // Upsert by endpoint: the same device re-subscribing (a token refresh, a
    // reinstall) replaces its own row rather than piling up a duplicate that
    // would otherwise double every future send to that one device.
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { organization: getOrgId(), user: req.user!.userId, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      { upsert: true, new: true }
    );
    sendSuccess(res, "Push subscription saved", null, 201);
  } catch (error) { next(error); }
};

export const unsubscribePush = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint) { sendError(res, "Endpoint is required", 400); return; }
    // Scoped to the caller too — an endpoint belongs to whoever subscribed
    // it, and unsubscribing somebody else's by guessing the value is exactly
    // what that scoping exists to refuse.
    await PushSubscription.deleteOne({ endpoint, user: req.user!.userId });
    sendSuccess(res, "Unsubscribed", null);
  } catch (error) { next(error); }
};
