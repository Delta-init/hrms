/**
 * What GET /integrations/directory/attendance-day takes: up to 200 emails and a day (YYYY-MM-DD) no more than two
 * days ahead of today in UTC — room for every time zone's tomorrow; an organization's id if the caller names one.
 * Kept apart from the controller so it can be checked alone.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^\S+@\S+\.\S+$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;

export type AttendanceDayQuery =
  | { ok: true; emails: string[]; day: string; organizationId?: string }
  | { ok: false; message: string };

export function readAttendanceDayQuery(query: Record<string, unknown>, now = Date.now()): AttendanceDayQuery {
  const emails = [...new Set(String(query.emails ?? "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e)))];
  const day = String(query.day ?? "").trim();
  if (!emails.length) return { ok: false, message: "emails is required" };
  if (emails.length > 200) return { ok: false, message: "At most 200 emails at a time" };
  const startsAt = Date.parse(`${day}T00:00:00Z`);
  if (!DAY.test(day) || Number.isNaN(startsAt) || new Date(startsAt).toISOString().slice(0, 10) !== day) {
    return { ok: false, message: "day is a date (YYYY-MM-DD)" };
  }
  if (startsAt > now + 2 * 86_400_000) return { ok: false, message: "That day hasn't come yet" };
  // One organization's id, or none: anything else (a name, the parameter twice) is the caller's mistake — a 400, not
  // the database's complaint about it.
  const org = query.organizationId;
  if (org !== undefined && (typeof org !== "string" || (org.trim() !== "" && !OBJECT_ID.test(org.trim())))) {
    return { ok: false, message: "organizationId is not an organization's id" };
  }
  const organizationId = typeof org === "string" && org.trim() ? org.trim() : undefined;
  return { ok: true, emails, day, ...(organizationId ? { organizationId } : {}) };
}
