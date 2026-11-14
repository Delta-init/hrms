import { describe, expect, it } from "bun:test";
import { dayOf, visaGate } from "./visaGate.js";

const now = new Date("2026-11-14T08:00:00Z");
const base = { location: "dubai", visaNotRequired: false, expiryDay: "2028-01-01", hasCopy: true, latest: null, today: "2026-11-14", now };
const sub = (kind: "visa" | "renewal", status: "pending" | "approved" | "rejected", daysAgo = 1) =>
  ({ kind, status, submittedAt: new Date(now.getTime() - daysAgo * 86_400_000) });

describe("visaGate", () => {
  it("leaves alone anyone not based in Dubai, or marked as needing no visa", () => {
    expect(visaGate({ ...base, location: "india", expiryDay: null, hasCopy: false })).toMatchObject({ required: false, applies: false });
    expect(visaGate({ ...base, location: null, expiryDay: null, hasCopy: false }).required).toBe(false);
    expect(visaGate({ ...base, visaNotRequired: true, expiryDay: null, hasCopy: false })).toMatchObject({ required: false, applies: false });
  });

  it("leaves alone a complete, current visa — including one expiring today", () => {
    expect(visaGate(base)).toMatchObject({ required: false, applies: true });
    expect(visaGate({ ...base, expiryDay: "2026-11-14" }).required).toBe(false);
  });

  it("asks when something is missing, and says what", () => {
    expect(visaGate({ ...base, expiryDay: null, hasCopy: false }).reason).toBe("missing");
    expect(visaGate({ ...base, expiryDay: null }).reason).toBe("missing_date");
    expect(visaGate({ ...base, hasCopy: false }).reason).toBe("missing_copy");
  });

  it("asks again once the visa has expired", () => {
    expect(visaGate({ ...base, expiryDay: "2026-11-13" })).toMatchObject({ required: true, reason: "expired" });
  });

  it("holds off while a submission is with HR", () => {
    expect(visaGate({ ...base, expiryDay: null, hasCopy: false, latest: sub("visa", "pending") })).toMatchObject({ required: false, pending: true });
  });

  it("says a renewed visa sent early is with HR, while the current one still counts", () => {
    expect(visaGate({ ...base, latest: sub("visa", "pending") })).toMatchObject({ required: false, pending: true, applies: true });
  });

  it("asks again, saying why, when HR sent it back", () => {
    expect(visaGate({ ...base, hasCopy: false, latest: sub("visa", "rejected") })).toMatchObject({ required: true, reason: "returned" });
  });

  it("lets HR's own record win over a returned submission", () => {
    expect(visaGate({ ...base, latest: sub("visa", "rejected") }).required).toBe(false);
  });

  it("gives an accepted renewal 30 days from when it was sent, then asks again", () => {
    const expired = { ...base, expiryDay: "2026-10-01" };
    const fresh = visaGate({ ...expired, latest: sub("renewal", "approved", 10) });
    expect(fresh.required).toBe(false);
    expect(fresh.renewalUntil?.toISOString()).toBe(new Date(now.getTime() + 20 * 86_400_000).toISOString());
    expect(visaGate({ ...expired, latest: sub("renewal", "approved", 31) })).toMatchObject({ required: true, reason: "expired" });
  });

  it("does not give an approved visa submission any grace — the record decides", () => {
    expect(visaGate({ ...base, expiryDay: "2026-10-01", latest: sub("visa", "approved", 2) }).required).toBe(true);
  });
});

describe("dayOf", () => {
  it("reads a stored date as the day it was entered for", () => {
    expect(dayOf(new Date("2028-03-05T00:00:00Z"))).toBe("2028-03-05");
    expect(dayOf(new Date("2028-03-04T20:00:00Z"))).toBe("2028-03-05"); // Dubai midnight stored as UTC
    expect(dayOf(null)).toBeNull();
  });
});
