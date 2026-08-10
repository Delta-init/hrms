import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { HireService } from "../services/hireService.js";
import { hireSchema } from "../validations/hireValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new HireService();

/** Everything already known, so the form only asks for what it must. */
export const getHirePrefill = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Hire prefill", await service.prefill(req.params.id)); }
  catch (error) { next(error); }
};

export const hireApplicant = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = hireSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }

    const result = await service.hire(req.params.id, parsed.data, req.user!.userId);

    // Both are follow-on steps that must not discard a created employee, so
    // they are reported rather than thrown — the message says what still needs
    // doing instead of leaving somebody to discover it later.
    const notes = [result.loginError, result.onboardingError].filter(Boolean);
    const message = notes.length
      ? `Employee created, but: ${notes.join("; ")}`
      : result.requisitionFilled
        ? "Employee created — the requisition is now filled"
        : "Employee created";

    sendSuccess(res, message, result, 201);
  } catch (error) { next(error); }
};

export const unlinkHire = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Unlinked", await service.unlink(req.params.id)); }
  catch (error) { next(error); }
};
