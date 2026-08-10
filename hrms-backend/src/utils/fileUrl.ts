import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Time-limited URLs for stored files.
 *
 * Objects used to be served straight off the bucket's public hostname, so the
 * link to somebody's passport scan worked for anyone who ever saw it, signed in
 * or not, for ever. The obvious fix — put the files behind the API and check the
 * caller's token — does not work here: every one of these URLs ends up in an
 * `<img src>` or an `<a href>`, and a browser sends no Authorization header for
 * either. The authority has to travel in the URL itself.
 *
 * So the server signs a short-lived link at the moment it serves the record. It
 * can only do that inside a response the caller already passed a permission
 * check to receive, which makes minting the link the authorisation step; the
 * signature just proves the link came from us, and the expiry bounds how long a
 * forwarded one keeps working.
 *
 * Signing is deliberately synchronous. `publicUrl()` is called from Mongoose
 * `toJSON` transforms, which cannot await, and an HMAC needs nothing async.
 */

/** How long a minted link stays good. Long enough for a page to sit open. */
const TTL_SECONDS = 60 * 60;

/**
 * A key derived from the app secret rather than the secret itself, so a file
 * link can never be confused with — or replayed as — a session token.
 */
const signingKey = createHmac("sha256", env.JWT_SECRET).update("file-url-v1").digest();

const sign = (key: string, expiresAt: number): string =>
  createHmac("sha256", signingKey).update(`${key}\n${expiresAt}`).digest("base64url");

/** The API origin a browser should hit. Behind a domain in production. */
const serverOrigin = (): string => (env.SERVER_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, "");

/** A signed, expiring URL for a stored object key. */
export function signedFileUrl(key: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  // Each segment is encoded separately: a key is a path, and its slashes have
  // to survive as slashes for the route to match.
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${serverOrigin()}/api/v1/files/${path}?e=${expiresAt}&s=${sign(key, expiresAt)}`;
}

/** Whether `signature` is ours and still current for `key`. */
export function verifyFileUrl(key: string, expiresAt: string, signature: string): boolean {
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const expected = Buffer.from(sign(key, exp));
  const given = Buffer.from(String(signature));
  // Compared in constant time, and only once the lengths match — timingSafeEqual
  // throws on a mismatch rather than returning false.
  return expected.length === given.length && timingSafeEqual(expected, given);
}
