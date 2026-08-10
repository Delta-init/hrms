/**
 * How long a month is, for pay.
 *
 * Thirty, whatever the calendar says. It makes a day cost the same in February
 * as in July — pricing by the month's own length, or by its working days, moved
 * the value of one absent day around by up to a tenth with nothing on the
 * payslip to explain why.
 *
 * The trade is that the leftover after a wholly absent month varies instead:
 * a month with 26 working days leaves four thirtieths, February leaves six. One
 * of the two has to move, and a stable price per day is the one people check.
 *
 * Lives here rather than in the payslip service because the employment window
 * measures a joiner's or leaver's part month against the same thirty.
 */
export const STANDARD_MONTH_DAYS = 30;

/**
 * What one day of `salary` is worth, unrounded.
 *
 * Callers multiply this and round the result once. Rounding the rate first cost
 * two fils on seven days of a 100 salary, which was enough to stop a payslip
 * reconciling against its own day counts.
 */
export const dayValue = (salary: number): number => salary / STANDARD_MONTH_DAYS;

/** The same rate as money, for showing on screen. */
export const dailyRate = (salary: number): number => Math.round(dayValue(salary) * 100) / 100;
