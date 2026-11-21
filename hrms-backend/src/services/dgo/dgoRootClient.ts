import { env } from "../../config/env.js";
import { httpError } from "./dgoErrors.js";

/**
 * HRMS asking Root for DGO Points figures: `${ROOT_ERP_API_URL}/api/v1/service/dgo/…`
 * with the secret both sides already share (HRMS's ROOT_ERP_SECRET is Root's
 * HRMS_SSO_SECRET). 503 when this server isn't set up for it, 502 when Root
 * can't be reached or refuses — the message says which.
 */
export const rootConfigured = () => Boolean(env.ROOT_ERP_API_URL && env.ROOT_ERP_SECRET);
export const rootConfigHint = () =>
  !env.ROOT_ERP_API_URL ? "Set ROOT_ERP_API_URL (Root's API address, without /api/v1) in the HRMS backend .env" : !env.ROOT_ERP_SECRET ? "Set ROOT_ERP_SECRET in the HRMS backend .env" : null;

export async function askRoot<T>(path: string, timeoutMs = 30_000): Promise<T> {
  const base = env.ROOT_ERP_API_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  if (!rootConfigured()) throw httpError("Root isn't set up on this server yet (ROOT_ERP_API_URL and ROOT_ERP_SECRET), so its figures can't be fetched", 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/v1/service/dgo/${path}`, {
      headers: { "x-portal-secret": env.ROOT_ERP_SECRET, accept: "application/json" },
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean; message?: string; data?: T } | null;
    if (res.status === 404) throw httpError("Root needs updating before it can answer this (deploy the Root backend)", 502);
    if (!res.ok || !body?.data) throw httpError(`Root couldn't be asked: ${body?.message ?? `HTTP ${res.status}`}`, 502);
    return body.data;
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode) throw e;
    throw httpError(`Root couldn't be asked: ${(e as Error).name === "AbortError" ? "it took too long" : (e as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}
