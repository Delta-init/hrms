import type { Loan, LoanHistoryRow } from "@/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11" → "Nov 2026". */
export const monthLabel = (m?: string | null) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : "—");

export const currencyOf = (loan: Loan) =>
  (loan.employee && typeof loan.employee === "object" ? loan.employee.currency : undefined) ?? "";

export const moneyIn = (currency?: string) => (n: number) =>
  `${currency ? currency + " " : ""}${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** The months HR may still skip or reduce — no final payslip, payroll still open. */
export const changeableMonths = (rows: LoanHistoryRow[]) => {
  const seen = new Set<string>();
  return rows.filter((r) => r.changeable && r.month && !seen.has(r.month) && seen.add(r.month));
};
