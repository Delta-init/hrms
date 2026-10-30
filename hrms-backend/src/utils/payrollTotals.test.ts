import { describe, expect, it } from "bun:test";
import { totalsByCurrency } from "./payrollTotals";

const slip = (currency: string | null, net: number, gross = net, ded = gross - net) => ({
  currency, netPay: net, grossPay: gross, totalDeductions: ded,
});

describe("totalsByCurrency", () => {
  it("keeps a single-currency month as one row", () => {
    const out = totalsByCurrency([slip("AED", 1000), slip("AED", 2000)], "AED", "AED");
    expect(out).toEqual([{ currency: "AED", employeeCount: 2, grossTotal: 3000, deductionTotal: 0, netTotal: 3000 }]);
  });

  it("does not add unlike currencies together", () => {
    // The whole point. October: 81 dirham payslips and 22 rupee ones were summed
    // as one figure and printed as AED.
    const out = totalsByCurrency([slip("AED", 500), slip("INR", 50_000), slip("AED", 300)], "AED", "AED");
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.currency === "AED")).toMatchObject({ employeeCount: 2, netTotal: 800 });
    expect(out.find((r) => r.currency === "INR")).toMatchObject({ employeeCount: 1, netTotal: 50_000 });
  });

  it("leads with the organisation's own currency even when another is larger in value", () => {
    // 1 AED payslip against 9 rupee ones: by people and by number the rupees
    // dominate, but the month is still "in" the organisation's currency.
    const out = totalsByCurrency([slip("AED", 100), ...Array.from({ length: 9 }, () => slip("INR", 90_000))], "AED", "AED");
    expect(out[0]!.currency).toBe("AED");
  });

  it("leads with the largest group when nobody is paid in the organisation's currency", () => {
    // An all-rupee month under an AED organisation must not headline an empty
    // AED row above the real payroll.
    const out = totalsByCurrency([slip("INR", 10), slip("INR", 20), slip("USD", 5)], "AED", "AED");
    expect(out.map((r) => r.currency)).toEqual(["INR", "USD"]);
  });

  it("counts a payslip with no currency under the fallback, not as its own row", () => {
    const out = totalsByCurrency([slip(null, 100), slip("", 200), slip("AED", 300)], "AED", "AED");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ currency: "AED", employeeCount: 3, netTotal: 600 });
  });

  it("treats the code case-insensitively", () => {
    const out = totalsByCurrency([slip("inr", 1), slip("INR", 2)], "AED", "AED");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ currency: "INR", employeeCount: 2, netTotal: 3 });
  });

  it("gives the same order however the payslips arrive", () => {
    // The batch's currency used to be whichever payslip the database returned first.
    const a = [slip("INR", 1), slip("AED", 1), slip("USD", 1)];
    const b = [slip("USD", 1), slip("INR", 1), slip("AED", 1)];
    expect(totalsByCurrency(a, "AED", null)).toEqual(totalsByCurrency(b, "AED", null));
  });

  it("rounds the total once, not each term", () => {
    // Three payslips of 0.005 each: rounding first gives 0.03, rounding last gives 0.02.
    const out = totalsByCurrency([slip("AED", 0.005), slip("AED", 0.005), slip("AED", 0.005)], "AED", "AED");
    expect(out[0]!.netTotal).toBe(0.02);
  });

  it("is empty for a month with no payslips", () => {
    expect(totalsByCurrency([], "AED", "AED")).toEqual([]);
  });
});
