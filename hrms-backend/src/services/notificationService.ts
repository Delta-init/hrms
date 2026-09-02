import { Notification } from "../models/Notification.js";
import { getOrgId, scoped } from "../utils/orgContext.js";

/**
 * Writing and reading in-app notifications.
 *
 * Every write here is best-effort and swallows its own errors. A notification
 * is a courtesy attached to something that has already happened — the leave is
 * approved, the record is saved — and failing that operation because a courtesy
 * could not be written would trade something that matters for something that
 * does not.
 *
 * Reads are scoped by organisation like everything else, and additionally by
 * recipient, which is the stronger of the two: a notification is addressed to
 * one person and nobody else has any business reading it.
 */

export interface NotifyInput {
  /** Recipients. Duplicates and blanks are dropped, so callers can be sloppy. */
  users: Array<unknown>;
  kind?: "leave" | "regularization" | "approval" | "announcement" | "payroll" | "system";
  tone?: "positive" | "negative" | "neutral";
  title: string;
  body?: string;
  href?: string;
  actor?: unknown;
  /** Explicit when there is no request context — a cron job, say. */
  organization?: unknown;
}

/**
 * Tell some people something. Never throws.
 *
 * The actor is removed from the recipients: somebody who has just approved a
 * request does not need to be told that it was approved, and a notification
 * about your own action is the fastest way to teach someone to ignore the bell.
 */
export async function notify(input: NotifyInput): Promise<number> {
  try {
    const actor = input.actor ? String(input.actor) : null;
    const recipients = [...new Set(input.users.filter(Boolean).map(String))].filter((id) => id !== actor);
    if (!recipients.length) return 0;

    const rows = recipients.map((user) => ({
      organization: input.organization ?? getOrgId(),
      user,
      kind: input.kind ?? "system",
      tone: input.tone ?? "neutral",
      title: input.title,
      body: input.body ?? "",
      href: input.href ?? "",
      actor: input.actor ?? null,
      createdAt: new Date(),
    }));
    await Notification.insertMany(rows, { ordered: false });
    return rows.length;
  } catch (err) {
    console.error("🔔 notification write failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** One person's notifications, newest first. */
export async function listFor(userId: string, limit = 30, before?: string) {
  const filter: Record<string, unknown> = scoped({ user: userId });
  if (before) filter.createdAt = { $lt: new Date(before) };
  const rows = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 100))
    .populate("actor", "name")
    .lean();
  return rows;
}

/** Just the number, for the bell. */
export async function unreadCountFor(userId: string): Promise<number> {
  return Notification.countDocuments(scoped({ user: userId, readAt: null }));
}

/**
 * Mark one read.
 *
 * Scoped to the caller as well as the organisation — the recipient filter is
 * what stops an id from another person's list being marked read by guessing it.
 */
export async function markRead(userId: string, id: string): Promise<boolean> {
  const res = await Notification.updateOne(scoped({ _id: id, user: userId }), { $set: { readAt: new Date() } });
  return res.matchedCount > 0;
}

/** Mark everything read — the "clear the badge" action. */
export async function markAllRead(userId: string): Promise<number> {
  const res = await Notification.updateMany(scoped({ user: userId, readAt: null }), { $set: { readAt: new Date() } });
  return res.modifiedCount;
}
