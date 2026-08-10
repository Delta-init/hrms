import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Kiosk } from "../models/Kiosk.js";
import type { IKiosk } from "../types/index.js";
import { runWithOrg } from "../utils/orgContext.js";
import { sendError } from "../utils/response.js";

export interface KioskRequest extends Request {
  kiosk?: IKiosk;
}

/** The stored form of a device secret. */
export function hashDeviceSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * Authenticate a kiosk device from its `X-Kiosk-Token` header.
 *
 * The token is `<kioskId>.<secret>`: the id finds the row, the secret is
 * compared against its hash. A plain SHA-256 is right here where it would be
 * wrong for a password — the secret is 32 random bytes we generated, so there
 * is no dictionary to run against it and no reason to pay a slow KDF on every
 * punch.
 *
 * There is no user session on a kiosk, so this also establishes the org context
 * that `authenticate` would normally set, taken from the device itself. A
 * tablet in one company's corridor can only ever punch that company's staff.
 */
export const authenticateKiosk = async (
  req: KioskRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const header = (req.headers["x-kiosk-token"] as string | undefined)?.trim();
    if (!header) {
      sendError(res, "This device is not paired", 401);
      return;
    }

    const [kioskId, secret] = header.split(".");
    if (!kioskId || !secret || !/^[a-f\d]{24}$/i.test(kioskId)) {
      sendError(res, "Device token is not valid", 401);
      return;
    }

    const kiosk = await Kiosk.findById(kioskId).select("+tokenHash");
    if (!kiosk || !kiosk.active) {
      sendError(res, "This device has been removed. Pair it again.", 401);
      return;
    }

    const expected = Buffer.from(kiosk.tokenHash, "hex");
    const supplied = Buffer.from(hashDeviceSecret(secret), "hex");
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      sendError(res, "Device token is not valid", 401);
      return;
    }

    req.kiosk = kiosk;
    const orgId = kiosk.organization ? String(kiosk.organization) : null;
    runWithOrg({ orgId, isSuperAdmin: false }, () => next());
  } catch {
    sendError(res, "Device authentication failed", 401);
  }
};
