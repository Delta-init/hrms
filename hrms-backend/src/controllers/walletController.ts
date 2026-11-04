import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { WalletService } from "../services/walletService.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new WalletService();
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month asked for, or this one in Dubai. */
function monthOf(req: AuthenticatedRequest): string | null {
  const month = String(req.query.month ?? "") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()).slice(0, 7);
  return MONTH.test(month) ? month : null;
}

/** GET /wallet/mine?month= — your own wallet. */
export const getMyWallet = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = monthOf(req);
    if (!month) { sendError(res, "month must be YYYY-MM", 400); return; }
    sendSuccess(res, "Your wallet", await service.forUser(req.user!.userId, month));
  } catch (error) { next(error); }
};

/** GET /wallet/:employeeId?month= — somebody else's, for whoever can see payroll. */
export const getEmployeeWallet = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = monthOf(req);
    if (!month) { sendError(res, "month must be YYYY-MM", 400); return; }
    if (!/^[a-f0-9]{24}$/i.test(req.params.employeeId)) { sendError(res, "Unknown employee", 400); return; }
    sendSuccess(res, "Wallet", await service.forEmployee(req.params.employeeId, month));
  } catch (error) { next(error); }
};
