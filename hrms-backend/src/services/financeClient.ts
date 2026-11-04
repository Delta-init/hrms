import crypto from "node:crypto";
import { env } from "../config/env.js";
import { signRequest } from "../utils/signing.js";

/**
 * HRMS asking the finance API something (2026-11-04, the wallet) — the integration's signed scheme pointed the other
 * way: finance's own client calls HRMS like this, and finance's `serviceAuth` checks it exactly as HRMS checks finance.
 * Signed over the path as finance's server sees it, prefix and all.
 */

const TIMEOUT_MS = 15_000;

/** A refusal or an answer finance gave — told apart from finance not being reached at all. */
class FinanceAnswer extends Error {}

export const financeConfigured = () =>
  Boolean(env.FINANCE_API_URL && env.FINANCE_CLIENT_ID && env.FINANCE_INTEGRATION_SECRET);

export async function financePost<T>(path: string, body: unknown): Promise<T> {
  // The base without the prefix: it is added below, and a URL that already carries it would sign /api/v1/api/v1.
  const base = env.FINANCE_API_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  if (!financeConfigured()) {
    throw new FinanceAnswer("Finance isn't connected to HRMS yet (FINANCE_API_URL, FINANCE_CLIENT_ID, FINANCE_INTEGRATION_SECRET).");
  }
  const signedPath = `/api/v1/integrations${path}`;
  const rawBody = JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = signRequest(env.FINANCE_INTEGRATION_SECRET, "POST", signedPath, timestamp, nonce, rawBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${signedPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Delta-Client": env.FINANCE_CLIENT_ID,
        "X-Delta-Timestamp": timestamp,
        "X-Delta-Nonce": nonce,
        "X-Delta-Signature": signature,
      },
      body: rawBody,
      signal: controller.signal,
    });
    const parsed = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
    if (res.status === 401) throw new FinanceAnswer("Finance refused HRMS's credentials — check FINANCE_CLIENT_ID and FINANCE_INTEGRATION_SECRET.");
    if (res.status === 404) throw new FinanceAnswer("Finance needs updating before it can answer this.");
    if (!res.ok || !parsed || parsed.data === undefined) {
      throw new FinanceAnswer(`Finance couldn't answer (${res.status}${parsed?.error?.message ? `: ${parsed.error.message}` : ""}).`);
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof FinanceAnswer) throw err;
    if ((err as Error).name === "AbortError") throw new Error("Finance took too long to answer.");
    // fetch itself failing — finance down, or the address wrong.
    throw new Error(`Finance couldn't be reached (${(err as Error).message}).`);
  } finally {
    clearTimeout(timer);
  }
}
