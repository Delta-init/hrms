/**
 * Adding payslips up without adding unlike currencies together.
 *
 * Every payslip carries its own currency, and a month can hold salaries in
 * dirhams and salaries in rupees side by side. Summing their `netPay` as plain
 * numbers produces a figure that is out by a factor of twenty-two on every rupee
 * line and is then printed under whichever currency happens to head the batch —
 * October read "AED 972,458.21" when AED 344,824.88 of it was dirhams and
 * INR 627,633.33 was rupees.
 *
 * So the unit of account here is the currency, and a total is a list of them.
 * There is deliberately no conversion: that needs an exchange rate somebody has
 * chosen, and a rate invented here would be more wrong than the sum it replaced.
 */

export interface CurrencyTotals {
  currency: string;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
}

type SlipAmounts = {
  currency?: string | null;
  grossPay?: number | null;
  totalDeductions?: number | null;
  netPay?: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (c: string | null | undefined) => (c ?? "").trim().toUpperCase();

/**
 * One row per currency, the headline currency first.
 *
 * `fallback` is the currency of a payslip that predates the field and carries
 * none — what was meant at the time, which is what the batch was in.
 * `preferred` is the organisation's own currency: it leads whenever anybody is
 * paid in it, because that is what the month is "in" and what a single headline
 * figure should be. When nobody is, the largest group leads instead, so the
 * headline is never an empty row sitting above the real payroll.
 *
 * Ordering is fully determined — people, then currency code — so the same data
 * can never produce a different headline on a second read. The batch's currency
 * used to be whichever payslip the database returned first.
 */
export function totalsByCurrency(
  slips: SlipAmounts[],
  fallback: string,
  preferred?: string | null
): CurrencyTotals[] {
  const rows = new Map<string, CurrencyTotals & { _gross: number; _ded: number; _net: number }>();

  for (const s of slips) {
    const currency = norm(s.currency) || norm(fallback) || "AED";
    let row = rows.get(currency);
    if (!row) {
      row = { currency, employeeCount: 0, grossTotal: 0, deductionTotal: 0, netTotal: 0, _gross: 0, _ded: 0, _net: 0 };
      rows.set(currency, row);
    }
    row.employeeCount += 1;
    // Rounded once at the end, not per payslip: rounding each term before adding
    // them is how a column of correct figures totals a penny out.
    row._gross += s.grossPay ?? 0;
    row._ded += s.totalDeductions ?? 0;
    row._net += s.netPay ?? 0;
  }

  const out: CurrencyTotals[] = [...rows.values()].map(({ _gross, _ded, _net, ...row }) => ({
    ...row,
    grossTotal: r2(_gross),
    deductionTotal: r2(_ded),
    netTotal: r2(_net),
  }));

  const lead = norm(preferred);
  const rank = (r: CurrencyTotals) => (lead && r.currency === lead ? 0 : 1);
  return out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.employeeCount - a.employeeCount ||
      a.currency.localeCompare(b.currency)
  );
}
