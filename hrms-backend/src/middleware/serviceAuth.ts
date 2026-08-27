import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { sendError } from "../utils/response.js";
import { signRequest } from "../utils/signing.js";

/**
 * Machine-to-machine authentication for the integration API.
 *
 * Deliberately not a JWT. The caller is another server (Delta Finance), not a
 * person: there is no login, no refresh, and nothing to revoke on logout. What
 * matters instead is that a request cannot be replayed and cannot be altered in
 * flight — a payroll integration moves salaries, so a tampered request body is
 * the thing worth defending against, not a stolen session.
 *
 * The caller signs a canonical string with a shared secret:
 *
 *   METHOD \n ORIGINAL_URL \n TIMESTAMP \n NONCE \n sha256(rawBody)
 *
 * The URL is signed with its query string, and the body by digest, so neither
 * can be swapped for another without the signature failing. See
 * `apps/api/src/lib/hrms-client.ts` in the finance repo for the other half.
 */

/** How far a request's clock may drift before it is refused. */
const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Nonces already spent, with the time they expire.
 *
 * In-process, so it only stops replays against this instance. That is enough
 * for a single-node deployment and it is deliberately not enough for several:
 * before this API is scaled out, move the set to Redis, or a replay merely has
 * to be aimed at a different node to succeed.
 */
const seenNonces = new Map<string, number>();

function sweepNonces(now: number) {
  if (seenNonces.size < 1000) return;
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(nonce);
  }
}

/** Constant-time compare that does not leak the answer through its runtime. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself be a leak.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Guards the integration routes. Rejects anything unsigned, stale, replayed or
 * altered — and stays silent about which, so a caller probing the endpoint
 * learns nothing beyond "no".
 */
export function serviceAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = env.INTEGRATION_SECRET;
  const clientId = env.INTEGRATION_CLIENT_ID;

  // Unconfigured means off, not open. A deployment that has not set up the
  // integration must not expose the whole employee directory by default.
  if (!secret || !clientId) {
    sendError(res, "Integration API is not enabled on this server", 503);
    return;
  }

  const client = String(req.headers["x-delta-client"] ?? "");
  const timestamp = String(req.headers["x-delta-timestamp"] ?? "");
  const nonce = String(req.headers["x-delta-nonce"] ?? "");
  const signature = String(req.headers["x-delta-signature"] ?? "");

  if (!client || !timestamp || !nonce || !signature) {
    sendError(res, "Unauthorized", 401);
    return;
  }
  if (!safeEqual(client, clientId)) {
    sendError(res, "Unauthorized", 401);
    return;
  }

  const ts = Number(timestamp);
  const now = Date.now();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) {
    sendError(res, "Unauthorized", 401);
    return;
  }

  if (seenNonces.has(nonce)) {
    sendError(res, "Unauthorized", 401);
    return;
  }

  // The bytes as they arrived. Re-serialising req.body would let a caller and
  // this server disagree about key order or number formatting, and the
  // signature would fail for honest requests.
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  const expected = signRequest(secret, req.method, req.originalUrl, timestamp, nonce, rawBody);

  if (!safeEqual(signature, expected)) {
    sendError(res, "Unauthorized", 401);
    return;
  }

  sweepNonces(now);
  seenNonces.set(nonce, now + MAX_SKEW_MS);
  next();
}
