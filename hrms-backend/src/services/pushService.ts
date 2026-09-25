import webpush from "web-push";
import { PushSubscription } from "../models/PushSubscription.js";
import { env } from "../config/env.js";

/**
 * Reaches somebody with the app fully closed — a phone screen off, a laptop
 * shut — which the in-app bell, a database row a page polls for, cannot do.
 *
 * With no VAPID keys configured this is a logged no-op, the same shape
 * `sendMail` takes with no SMTP: every caller is safe to run before the keys
 * exist, in development or in an organisation that never sets them up.
 */
let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  /** Where the click should land — a path on this app, e.g. "/leave". */
  url?: string;
  data?: Record<string, unknown>;
}

/**
 * One person, every device they have subscribed on.
 *
 * `Promise.allSettled`, not `Promise.all`: one dead phone must not stop the
 * push reaching the laptop sitting right next to it. A subscription the push
 * service reports as gone (410) or unknown (404) is deleted here — the
 * device was reset, the site data cleared, the PWA uninstalled — or the
 * table fills with rows that can never be delivered to and every future send
 * gets slower for no benefit.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    const subs = await PushSubscription.find({ user: userId });
    if (!subs.length) return;
    const json = JSON.stringify(payload);

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, json);
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await PushSubscription.deleteOne({ _id: sub._id });
        }
      })
    );
  } catch (err) {
    console.error("📱 push send failed:", err instanceof Error ? err.message : err);
  }
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  await Promise.allSettled([...new Set(userIds.filter(Boolean).map(String))].map((id) => sendPushToUser(id, payload)));
}
