import type { NextFunction, Response } from "express";
import type { KioskRequest } from "../middleware/kioskAuth.js";
import { FacePunchService } from "../services/facePunchService.js";
import { KioskService } from "../services/kioskService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { kioskPunchSchema, registerKioskSchema } from "../validations/kioskValidation.js";

const kiosks = new KioskService();
const punches = new FacePunchService();

// ─── Device management (HR side) ─────────────────────────────────────────────

export const listKiosks = async (
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    sendSuccess(res, "Kiosks retrieved", await kiosks.list());
  } catch (error) {
    next(error);
  }
};

export const registerKiosk = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = registerKioskSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    // The token in this response is the only time it exists in readable form.
    sendSuccess(res, "Kiosk paired", await kiosks.register(parsed.data, req.user!.userId), 201);
  } catch (error) {
    next(error);
  }
};

export const rotateKioskToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    sendSuccess(res, "New device token issued", await kiosks.rotate(String(req.params.id)));
  } catch (error) {
    next(error);
  }
};

export const setKioskActive = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const active = req.body?.active !== false;
    sendSuccess(res, active ? "Kiosk enabled" : "Kiosk disabled", await kiosks.setActive(String(req.params.id), active));
  } catch (error) {
    next(error);
  }
};

export const deleteKiosk = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await kiosks.remove(String(req.params.id));
    sendSuccess(res, "Kiosk removed");
  } catch (error) {
    next(error);
  }
};

// ─── Device side (the tablet itself) ─────────────────────────────────────────

/** Lets a freshly paired tablet confirm its token and show which device it is. */
export const kioskSession = async (req: KioskRequest, res: Response): Promise<void> => {
  sendSuccess(res, "Kiosk session", {
    id: String(req.kiosk!._id),
    name: req.kiosk!.name,
    location: req.kiosk!.location ?? null,
  });
};

export const kioskPunch = async (
  req: KioskRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = kioskPunchSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }

    const outcome = await punches.punch(req.kiosk!, parsed.data.images, req.ip);

    // Everything here is a 200. "Not recognised" and "you just punched" are
    // ordinary states of a working kiosk, and the screen renders them from
    // `status`; making them HTTP errors would only invite the tablet to show a
    // generic failure instead of the instruction the person needs.
    sendSuccess(res, "Punch processed", outcome);
  } catch (error) {
    // A refused clock-in — outside the shift window, or already clocked in
    // today — arrives as a thrown error from the attendance service.
    const err = error as { statusCode?: number; message?: string };
    if (err?.statusCode && err.statusCode < 500) {
      sendSuccess(res, "Punch refused", { status: "refused", message: err.message });
      return;
    }
    next(error);
  }
};
