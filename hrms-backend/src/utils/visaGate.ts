/**
 * Whether an employee has to be stopped and asked for their visa.
 *
 * Only staff based in Dubai hold a UAE visa; HR can mark anyone else exempt.
 * Of those, the popup comes up when the record is missing the expiry date or
 * the scan, or the date has passed — unless something is already in hand: a
 * submission waiting for HR, or a renewal HR accepted in the last 30 days.
 *
 * What HR has put on the record directly always counts: a complete, current
 * visa there ends the matter even if the employee's own last try was sent back.
 */

/** How long proof of a renewal under way holds the popup off, from when it was sent. */
export const RENEWAL_GRACE_DAYS = 30;

const DAY_MS = 86_400_000;

export type VisaGateReason =
  /** Neither the date nor the scan is on file. */
  | "missing"
  | "missing_date"
  | "missing_copy"
  /** The date on file has passed. */
  | "expired"
  /** HR sent back what they last submitted. */
  | "returned";

export interface VisaGateInput {
  location?: string | null;
  visaNotRequired?: boolean;
  /** The expiry on the record, as a "YYYY-MM-DD" day. */
  expiryDay: string | null;
  hasCopy: boolean;
  /** Their most recent submission, if any. */
  latest: { kind: "visa" | "renewal"; status: "pending" | "approved" | "rejected"; submittedAt: Date } | null;
  /** Today, as a "YYYY-MM-DD" day in Dubai. */
  today: string;
  now: Date;
}

export interface VisaGate {
  /** Whether the popup must show. */
  required: boolean;
  reason: VisaGateReason | null;
  /** A submission is with HR — not required, but worth saying so. */
  pending: boolean;
  /** Renewal accepted and still inside its grace — until when. */
  renewalUntil: Date | null;
  /** Whether this person is asked about visas at all. */
  applies: boolean;
}

export function visaGate(input: VisaGateInput): VisaGate {
  const none = { required: false, reason: null, pending: false, renewalUntil: null };
  if (input.location !== "dubai" || input.visaNotRequired) return { ...none, applies: false };

  const latest = input.latest;
  // Something waiting for HR is worth saying whether or not the visa on file
  // is still good — a renewed visa sent early is exactly the case to show.
  const pending = latest?.status === "pending";

  const current = !!input.expiryDay && input.hasCopy && input.expiryDay >= input.today;
  if (current) return { ...none, pending, applies: true };

  if (pending) return { ...none, pending: true, applies: true };

  if (latest?.status === "approved" && latest.kind === "renewal") {
    const until = new Date(latest.submittedAt.getTime() + RENEWAL_GRACE_DAYS * DAY_MS);
    if (until > input.now) return { ...none, renewalUntil: until, applies: true };
  }

  const reason: VisaGateReason =
    latest?.status === "rejected" ? "returned"
      : !input.expiryDay && !input.hasCopy ? "missing"
      : !input.expiryDay ? "missing_date"
      : !input.hasCopy ? "missing_copy"
      : "expired";
  return { required: true, reason, pending: false, renewalUntil: null, applies: true };
}

/** The calendar day a stored date stands for (dates are kept as UTC midnight). */
export const dayOf = (d: Date | string | null | undefined): string | null =>
  d ? new Date(Math.round(new Date(d).getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10) : null;
