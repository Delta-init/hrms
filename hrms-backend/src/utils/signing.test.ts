import { describe, expect, it } from "bun:test";
import { buildCanonical, signRequest } from "./signing.js";

/**
 * The finance integration contract, pinned.
 *
 * These vectors are duplicated verbatim in the finance repo
 * (`apps/api/src/lib/signing.test.ts`). They are the only thing keeping two
 * separately-deployed servers agreeing on what a signature covers: if either
 * side changes the canonical format, its own test fails here rather than the
 * integration failing silently in production with an unexplained 401.
 *
 * Do not "fix" a failure by updating the expected value. Update both repos, or
 * the payroll pipeline stops.
 */
const SECRET = "test-secret-that-is-long-enough-to-pass-32";
const TIMESTAMP = "1735689600000";
const NONCE = "0123456789abcdef0123456789abcdef";
const GET_URL = "/api/v1/integrations/directory/employees?organizationId=64b7f1c2a1b2c3d4e5f60718&page=1";

describe("integration signing contract", () => {
  it("builds the agreed canonical string for a GET with no body", () => {
    expect(buildCanonical("GET", GET_URL, TIMESTAMP, NONCE, "")).toBe(
      [
        "GET",
        GET_URL,
        TIMESTAMP,
        NONCE,
        // sha256 of the empty string — an absent body still contributes a digest.
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ].join("\n"),
    );
  });

  it("matches the signature the finance client produces for a GET", () => {
    expect(signRequest(SECRET, "GET", GET_URL, TIMESTAMP, NONCE, "")).toBe(
      "1bd7188a527927d390f9b2b358b024e4088a7d1140677b6021a1058b8e8f0555",
    );
  });

  it("matches the signature the finance client produces for a POST with a body", () => {
    const body = JSON.stringify({ hrmsOrgId: "64b7f1c2a1b2c3d4e5f60718" });
    expect(signRequest(SECRET, "POST", "/api/v1/integrations/sync", TIMESTAMP, NONCE, body)).toBe(
      "b6083025665061819e554928e53c027dbc10450242dd0098e6f2e904f8b9f88e",
    );
  });

  it("signs the query string, so a page cannot be swapped in flight", () => {
    const a = signRequest(SECRET, "GET", GET_URL, TIMESTAMP, NONCE, "");
    const b = signRequest(SECRET, "GET", GET_URL.replace("page=1", "page=2"), TIMESTAMP, NONCE, "");
    expect(a).not.toBe(b);
  });

  it("signs the body, so its contents cannot be altered in flight", () => {
    const a = signRequest(SECRET, "POST", "/x", TIMESTAMP, NONCE, JSON.stringify({ amount: 100 }));
    const b = signRequest(SECRET, "POST", "/x", TIMESTAMP, NONCE, JSON.stringify({ amount: 900 }));
    expect(a).not.toBe(b);
  });

  it("treats a Buffer body and its string form identically", () => {
    const body = JSON.stringify({ hrmsOrgId: "64b7f1c2a1b2c3d4e5f60718" });
    expect(signRequest(SECRET, "POST", "/x", TIMESTAMP, NONCE, Buffer.from(body, "utf8"))).toBe(
      signRequest(SECRET, "POST", "/x", TIMESTAMP, NONCE, body),
    );
  });
});
