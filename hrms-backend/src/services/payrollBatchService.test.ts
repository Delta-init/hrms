import { describe, expect, it } from "bun:test";
import { PayrollBatchService } from "./payrollBatchService.js";
import type { PayrollBatchStatus } from "../types/index.js";

/**
 * The handover's rules, pinned.
 *
 * `assertTransition` touches no database, so the whole state machine is
 * testable on its own — and it is worth testing, because the moves it refuses
 * are the ones that would otherwise let a month be paid twice, or edited after
 * accounts had already sent the money.
 */
const service = new PayrollBatchService();

const allows = (from: PayrollBatchStatus, to: PayrollBatchStatus) => {
  try {
    service.assertTransition(from, to);
    return true;
  } catch {
    return false;
  }
};

describe("payroll batch state machine", () => {
  it("walks the happy path from draft to paid", () => {
    expect(allows("draft", "submitted")).toBe(true);
    expect(allows("submitted", "in_finance")).toBe(true);
    expect(allows("in_finance", "approved")).toBe(true);
    expect(allows("approved", "paid")).toBe(true);
  });

  it("lets HR recall a month accounts has not picked up yet", () => {
    expect(allows("submitted", "draft")).toBe(true);
  });

  it("refuses to recall once accounts hold it", () => {
    // Finance may already have added figures of their own; the way back from
    // here is finance returning it, not HR yanking it out from underneath.
    expect(allows("in_finance", "draft")).toBe(false);
    expect(allows("approved", "draft")).toBe(false);
  });

  it("never lets a paid payroll move anywhere", () => {
    const everywhere: PayrollBatchStatus[] = [
      "draft", "submitted", "in_finance", "approved", "partially_paid", "returned",
    ];
    for (const to of everywhere) expect(allows("paid", to)).toBe(false);
  });

  it("refuses to pay a month that was never submitted", () => {
    expect(allows("draft", "paid")).toBe(false);
    expect(allows("draft", "approved")).toBe(false);
    expect(allows("draft", "in_finance")).toBe(false);
  });

  it("refuses to approve a month accounts have not imported", () => {
    expect(allows("submitted", "approved")).toBe(false);
  });

  it("lets a partly paid month finish, or take another payment", () => {
    expect(allows("partially_paid", "paid")).toBe(true);
    expect(allows("partially_paid", "partially_paid")).toBe(true);
  });

  it("refuses to un-pay a partly paid month", () => {
    expect(allows("partially_paid", "approved")).toBe(false);
    expect(allows("partially_paid", "draft")).toBe(false);
    expect(allows("partially_paid", "returned")).toBe(false);
  });

  it("lets finance return a month at any point before payment", () => {
    expect(allows("submitted", "returned")).toBe(true);
    expect(allows("in_finance", "returned")).toBe(true);
    expect(allows("approved", "returned")).toBe(true);
  });

  it("lets a returned month be fixed and sent again", () => {
    expect(allows("returned", "draft")).toBe(true);
    expect(allows("returned", "submitted")).toBe(true);
  });

  it("treats a no-op transition as allowed rather than an error", () => {
    // Re-delivering the same signal (a retried webhook, a double click) must
    // not blow up; idempotence matters more than strictness here.
    expect(allows("paid", "paid")).toBe(true);
    expect(allows("submitted", "submitted")).toBe(true);
  });

  it("explains a refusal in words, not status codes", () => {
    expect(() => service.assertTransition("draft", "paid")).toThrow(
      /payroll that is draft cannot move to paid/i,
    );
  });
});
