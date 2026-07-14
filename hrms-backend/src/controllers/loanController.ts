import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { LoanService } from "../services/loanService.js";
import { createLoanSchema, updateLoanSchema } from "../validations/loanValidation.js";
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
