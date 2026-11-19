import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { LoanService } from "../services/loanService.js";
import {
  createLoanSchema, updateLoanSchema, planMonthSchema, directPaymentSchema, monthParam,
} from "../validations/loanValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new LoanService();

export const createLoan = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createLoanSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Loan created", await service.create(parsed.data), 201);
  } catch (error) { next(error); }
};

export const getLoans = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Loans retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getLoanById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Loan retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateLoan = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateLoanSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Loan updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteLoan = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await service.remove(req.params.id);
    sendSuccess(res, "Loan deleted", null);
  } catch (error) { next(error); }
};

export const getLoanHistory = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Loan history retrieved", await service.history(req.params.id));
  } catch (error) { next(error); }
};

export const getMyLoans = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Your loans retrieved", await service.listMine(req.user!.userId));
  } catch (error) { next(error); }
};

export const planLoanMonth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = monthParam.safeParse(req.params.month);
    if (!month.success) { sendError(res, "Month must be YYYY-MM", 400); return; }
    const parsed = planMonthSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const done = await service.planMonth(req.params.id, month.data, parsed.data, req.user!.userId);
    sendSuccess(res, parsed.data.amount > 0 ? "Month reduced" : "Month skipped", done);
  } catch (error) { next(error); }
};

export const clearLoanMonth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = monthParam.safeParse(req.params.month);
    if (!month.success) { sendError(res, "Month must be YYYY-MM", 400); return; }
    sendSuccess(res, "Month back on the normal schedule", await service.clearMonth(req.params.id, month.data, req.user!.userId));
  } catch (error) { next(error); }
};

export const addLoanPayment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = directPaymentSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Payment recorded", await service.addDirectPayment(req.params.id, parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const removeLoanPayment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Payment removed", await service.removeDirectPayment(req.params.id, req.params.paymentId));
  } catch (error) { next(error); }
};
