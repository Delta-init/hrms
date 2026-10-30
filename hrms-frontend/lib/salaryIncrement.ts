import type { SalaryIncrement } from "@/types";

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * The currency of each side of an increment. Older records carry none and
 * read as the employee's. When the two differ it is a transfer, not a raise
 * or a cut — Nadeem's INR 30,000 → AED 3,000 is not a 90% drop — and there is
 * no difference or percentage to show.
 */
export function incrementCurrencies(i: Pick<SalaryIncrement, "previousCurrency" | "currency">, fallback?: string | null) {
  const prev = (i.previousCurrency || fallback || "AED").toUpperCase();
  const next = (i.currency || fallback || "AED").toUpperCase();
  return { prev, next, changed: prev !== next };
}

/** The increment payroll uses this month: the latest effective on or before it. */
export function incrementInForce<T extends Pick<SalaryIncrement, "effectiveMonth">>(rows: T[], month = thisMonth()): T | null {
  return [...rows].filter((r) => r.effectiveMonth <= month).sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth))[0] ?? null;
}
