import { randomBytes } from "node:crypto";
import type { CrmLink } from "../config/env.js";
import { signRequest } from "./signing.js";

/*
 * Calling a CRM's leaver handover (/api/v1/integrations/hrms/handover…), signed as this server's own integration API
 * is checked — X-Delta-Client, -Timestamp, -Nonce, -Signature over
 *
 *     METHOD \n PATH_WITH_QUERY \n TIMESTAMP \n NONCE \n sha256(body)
 *
 * — with that CRM's handover secret. Its counterpart is the CRM's middleware/hrmsSignature.ts.
 *
 * Every failure comes back as a CrmError whose message is fit to show HR and whose status says what kind: the CRM's
 * own refusal (400/404/409) passes through; out of reach or not set up is 503; a refused signature or a server
 * without the handover yet is 502.
 */

export const HRMS_CLIENT = "delta-hrms";

export class CrmError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "CrmError";
  }
}

const base = (link: CrmLink) => link.url.replace(/\/+$/, "").replace(/\/api\/v1$/, "");

export async function crmCall<T>(
  link: CrmLink,
  method: "GET" | "POST",
  path: string,
  opts: { query?: URLSearchParams; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const qs = opts.query?.toString();
  const signedPath = `/api/v1/integrations/hrms${path}${qs ? `?${qs}` : ""}`;
  const body = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = signRequest(link.secret, method, signedPath, timestamp, nonce, body);

  let res: Response;
  try {
    res = await fetch(`${base(link)}${signedPath}`, {
      method,
      headers: {
        "X-Delta-Client": HRMS_CLIENT,
        "X-Delta-Timestamp": timestamp,
        "X-Delta-Nonce": nonce,
        "X-Delta-Signature": signature,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body || undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch {
    throw new CrmError(`${link.name} couldn't be reached`, 503);
  }

  const json = (await res.json().catch(() => null)) as { success?: boolean; message?: string; data?: T } | null;
  if (res.status === 401) throw new CrmError(`${link.name} refused HRMS's signature — the handover secret differs between the two servers`, 502);
  // Anything that isn't the CRM's API answering: a proxy's page, or a CRM still on older code.
  if (!json || typeof json !== "object" || !("success" in json)) {
    throw new CrmError(
      res.status === 404 ? `${link.name} doesn't have the leaver handover yet — its server needs the new code` : `${link.name} answered ${res.status}`,
      502
    );
  }
  if (!res.ok) {
    const message = json.message || `${link.name} answered ${res.status}`;
    throw new CrmError(res.status >= 500 ? `${link.name}: ${message}` : message, res.status >= 500 ? 503 : res.status);
  }
  return json.data as T;
}
