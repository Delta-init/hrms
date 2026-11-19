/**
 * How a loan is repaid, month by month.
 *
 * Each month takes one instalment — or the remainder when that is less — until
 * nothing is left. HR can change a month before its payslip is final: skip it
 * (take nothing) or take less. Neither touches the instalment, so whatever a
 * month did not take simply stays owed and the last month(s) pick it up: a
 * skip ends the loan a month later, a smaller month adds to the end. Money the
 * employee pays directly comes off what is owed, so the loan finishes sooner
 * at the same monthly amount.
 *
 * Months are "YYYY-MM".
 */

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-11" plus n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * What a loan takes in a month.
 *
 * `planned` is HR's choice for that month: 0 skips it, a smaller amount takes
 * that much. With no plan, one instalment — or everything that is left when
 * less than a unit would remain, so 1000 over three months (333.33 each)
 * closes on time rather than leaving a stray cent for a fourth.
 */
export function takeFor(outstanding: number, instalment: number, planned?: number | null): number {
  if (outstanding <= 0) return 0;
  if (planned !== undefined && planned !== null) return round2(Math.max(0, Math.min(planned, outstanding)));
  return outstanding - instalment < 1 ? round2(outstanding) : round2(instalment);
}

export interface ProjectedMonth {
  month: string;
  take: number;
  /** HR's plan for the month, when there is one: "skip" or "partial". */
  plan: "skip" | "partial" | null;
}

/**
 * The months still to come, from `from`: each takes its amount until nothing
 * is owed. Skipped months are listed (taking nothing) so the history shows
 * them in place. Stops after `max` months, so a loan with a zero instalment
 * cannot run forever.
 */
export function project(
  outstanding: number,
  instalment: number,
  from: string,
  plans: Map<string, number>,
  max = 120
): ProjectedMonth[] {
  const out: ProjectedMonth[] = [];
  let left = round2(outstanding);
  for (let i = 0; left > 0 && i < max; i++) {
    const month = addMonths(from, i);
    const planned = plans.has(month) ? plans.get(month)! : null;
    const take = takeFor(left, instalment, planned);
    out.push({ month, take, plan: planned === null ? null : planned === 0 ? "skip" : "partial" });
    left = round2(left - take);
    // Nothing can ever be taken (no instalment, no plan): stop rather than list blanks.
    if (take === 0 && planned === null) break;
  }
  return out;
}
