import axios from "axios";
import { getSession, signOut } from "next-auth/react";
import { getActiveOrg, setActiveOrg } from "@/lib/activeOrg";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

/**
 * Signing in, signing out and swapping into or out of an impersonation all
 * replace the session cookie while requests are still in the air. Those
 * requests answer 401 against the session that is being replaced — which is
 * not the caller losing their session, it is the caller changing it. Treating
 * those as an expired session is what made both flows unusable: exiting an
 * impersonation threw the admin out to the login page instead of restoring
 * them, and logging out fired one sign-out per failed request, each assigning
 * `window.location.href` and cancelling the one before it, so the page never
 * moved and the button had to be pressed again.
 */
let authTransition = 0;
export function beginAuthTransition() {
  authTransition++;
}
export function endAuthTransition() {
  authTransition = Math.max(0, authTransition - 1);
}

/**
 * One sign-out, however many requests fail.
 *
 * Held as the promise rather than a boolean so every caller waits on the same
 * navigation instead of starting another.
 */
let signingOut: Promise<unknown> | null = null;
function signOutOnce() {
  signingOut ??= signOut({ callbackUrl: "/login" });
  return signingOut;
}

/** Milliseconds until a JWT expires, from its own `exp` claim. */
function expiresInMs(token?: string): number | null {
  try {
    const part = (token ?? "").split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 - Date.now() : null;
  } catch {
    return null;
  }
}

/**
 * Whether this session is finished, as opposed to momentarily out of step.
 *
 * Three ways to be finished, and only the first was being checked. No token at
 * all is the obvious one. A refresh that failed is the common one — it leaves
 * the old token in place and sets `error`, so the session still answers with a
 * token and reads as healthy; that is how somebody sat watching "session
 * expired" over and over while the app declined to sign them out. And a token
 * already past its own expiry is finished whatever else the session says.
 *
 * Everything else — a token that rotated under an in-flight request, a single
 * unlucky 401 — is left alone, because signing somebody out of a working
 * session is worse than one failed request.
 */
function isDead(session: { accessToken?: string; error?: string } | null): boolean {
  if (!session?.accessToken) return true;
  if (session.error) return true;
  const left = expiresInMs(session.accessToken);
  return left !== null && left <= 0;
}

/**
 * The session behind concurrent requests, fetched once.
 *
 * `getSession()` is a round trip to /api/auth/session, and a page that opens
 * with a dozen queries made a dozen of them — each one re-entering the jwt
 * callback and, on an expired access token, racing a dozen refreshes against a
 * rate limit of sixty. Concurrent callers now share the one lookup; nothing is
 * cached beyond that, so a rotated token is never served stale.
 */
let inFlightSession: Promise<Awaited<ReturnType<typeof getSession>>> | null = null;
function sessionOnce() {
  inFlightSession ??= getSession().finally(() => {
    inFlightSession = null;
  });
  return inFlightSession;
}

// ─── Request Interceptor: attach the Express access token from the NextAuth session ──
api.interceptors.request.use(
  async (config) => {
    if (typeof window !== "undefined") {
      const session = await sessionOnce();
      const token = session?.accessToken;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      // Super Admin's active org (ignored by the backend for regular users).
      const org = getActiveOrg();
      if (org) config.headers["X-Org-Id"] = org;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor: on 401, end the NextAuth session and bounce to login ──
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      // Mid-swap, the 401 is expected and says nothing about the new session.
      if (authTransition === 0) {
        // A token that rotated under an in-flight request answers 401 too, and
        // that session is still perfectly good. Ask before ending it: only a
        // session that is genuinely gone gets signed out.
        const session = await sessionOnce().catch(() => null);
        if (isDead(session)) {
          setActiveOrg(null);
          await signOutOnce();
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
