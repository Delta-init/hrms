import { z } from "zod";
import { todayInTz } from "../utils/schedule.js";

const typeEnum = z.enum(["missing_checkin", "missing_checkout", "wrong_time", "absent_correction", "early_checkout"]);
const statusEnum = z.enum(["pending", "approved", "rejected", "cancelled"]);
const resultingStatusEnum = z.enum(["present", "half_day", "wfh", "early_out"]);

/** Whether `date` falls strictly before today, in `tz`. */
export function isPastDay(date: Date, tz: string): boolean {
  return date.toISOString().slice(0, 10) < todayInTz(tz || "Asia/Dubai");
}

/** Whether `date` falls strictly after today, in `tz`. */
export function isFutureDay(date: Date, tz: string): boolean {
  return date.toISOString().slice(0, 10) > todayInTz(tz || "Asia/Dubai");
}

export const createRegularizationSchema = z
  .object({
    user: z.string().min(1, "User is required"),
    date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
    timeZone: z.string().min(1).default("Asia/Dubai"),
    type: typeEnum,
    /**
     * What the day is marked as once approved. Deliberately optional rather
     * than defaulted here — a default would fill the field in before the
     * service sees it, and the organization's own default could never apply.
     */
    resultingStatus: resultingStatusEnum.optional(),
    requestedCheckIn: z.coerce.date().optional().nullable(),
    requestedCheckOut: z.coerce.date().optional().nullable(),
    reason: z.string().max(500).optional(),
    status: statusEnum.optional(),
  })
  // Without at least one corrected time, an approved regularization has
  // nothing to apply to Attendance and silently no-ops.
  .refine((data) => !!data.requestedCheckIn || !!data.requestedCheckOut, {
    message: "Provide a corrected check-in and/or check-out time",
    path: ["requestedCheckIn"],
  })
  // A day still ahead has nothing settled yet to correct at all. Today is
  // narrower than "already past" but not always too soon — a late or
  // half-day arrival is decided the moment it happens, not at midnight — so
  // today alone is let through here and judged against the day's own record
  // in the service, where that record actually is.
  .refine((data) => !isFutureDay(data.date, data.timeZone), {
    message: "You can't raise a correction for a day that hasn't happened yet",
    path: ["date"],
  });

export const updateRegularizationSchema = z.object({
  resultingStatus: resultingStatusEnum.optional(),
  date: z.coerce.date().optional(),
  timeZone: z.string().min(1).optional(),
  type: typeEnum.optional(),
  requestedCheckIn: z.coerce.date().optional().nullable(),
  requestedCheckOut: z.coerce.date().optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
  // No status/reviewNote here — approving is a distinct action gated on the
  // `approve` permission, via reviewRegularizationSchema below.
});

export const reviewRegularizationSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().max(500).optional().nullable(),
  /**
   * Lets the approver correct what the day is marked as at the moment they
   * approve it — they are the last person to look at the request, and without
   * this a wrong status means rejecting it and asking for a resubmission.
   */
  resultingStatus: resultingStatusEnum.optional(),
});

export type CreateRegularizationInput = z.infer<typeof createRegularizationSchema>;
export type UpdateRegularizationInput = z.infer<typeof updateRegularizationSchema>;
export type ReviewRegularizationInput = z.infer<typeof reviewRegularizationSchema>;
