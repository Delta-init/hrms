import { z } from "zod";

const statusEnum = z.enum([
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
  "holiday",
  "weekend",
  "wfh",
]);

/**
 * What the browser may tell us about a punch.
 *
 * Every field is optional and none is believed on its own — this is the
 * untrusted half of the record (see utils/punchContext.ts). Bounded anyway, so
 * a malformed or hostile body is rejected rather than stored: coordinates that
 * are not coordinates, or a timezone the length of a novel.
 */
export const punchContextSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  // Metres. Anything past ~100km is a fix so vague it says nothing at all.
  accuracy: z.coerce.number().min(0).max(100_000).optional(),
  locationSource: z.enum(["gps", "denied", "unavailable", "unsupported"]).optional(),
  timeZone: z.string().max(60).optional(),
  /**
   * The secret this browser minted for itself, plus what it looks like.
   *
   * Bounded hard: the key is only ever hashed and compared, so nothing is
   * gained by accepting a longer one, and an unbounded string here would be
   * stored on every punch.
   */
  deviceKey: z.string().min(16).max(128).optional(),
  deviceLabel: z.string().max(80).optional(),
  deviceFingerprint: z.string().max(64).optional(),
});

export const createAttendanceSchema = z.object({
  user: z.string().min(1, "User is required"),
  date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
  timeZone: z.string().min(1).default("Asia/Dubai"),
  checkIn: z.coerce.date().optional().nullable(),
  checkOut: z.coerce.date().optional().nullable(),
  status: statusEnum.default("present"),
  lateMinutes: z.number().min(0).optional(),
  note: z.string().max(500).optional(),
});

export const updateAttendanceSchema = z.object({
  date: z.coerce.date().optional(),
  timeZone: z.string().min(1).optional(),
  checkIn: z.coerce.date().optional().nullable(),
  checkOut: z.coerce.date().optional().nullable(),
  status: statusEnum.optional(),
  lateMinutes: z.number().min(0).optional(),
  note: z.string().max(500).optional().nullable(),
});

export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;

/**
 * Setting one day's status for several people at once.
 *
 * Addressed by employee and calendar day rather than by record id, because the
 * case this exists for is a day with no record: nobody clocked in, so there is
 * nothing to name. The service resolves the day into each person's own
 * timezone, so a bare "2026-09-03" is the right shape here.
 */
export const setDayStatusSchema = z.object({
  employees: z.array(z.string().trim().min(1)).min(1, "Select at least one person").max(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  // The same list the manual-entry form validates against, so the two
  // cannot drift into accepting different statuses for the same records.
  status: statusEnum,
  note: z.string().trim().max(300).optional(),
});

export type SetDayStatusInput = z.infer<typeof setDayStatusSchema>;
