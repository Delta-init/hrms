import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { PayslipService } from "../services/payslipService.js";
import { SalarySheetImportService } from "../services/salarySheetImportService.js";
import { createPayslipSchema, updatePayslipSchema, bulkPayslipSchema, bulkPayslipStatusSchema, lopOverrideSchema, payrollMuteSchema } from "../validations/payslipValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new PayslipService();
const sheetImport = new SalarySheetImportService();

/**
 * Check (apply=false) or import (apply=true) a salary sheet for a month. The
 * file is sent both times; nothing from the check is kept between the two.
 */
export const importSalarySheet = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) { sendError(res, "Choose the salary sheet to import", 400); return; }
    const month = String(req.body?.month ?? "");
    const apply = String(req.body?.apply ?? "") === "true";
    const result = await sheetImport.run(month, req.file, apply, req.user!.userId);
    sendSuccess(res, apply ? "Salary sheet imported" : "Salary sheet checked", result);
  } catch (error) { next(error); }
};

export const createPayslip = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createPayslipSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data, req.user!.userId);
    sendSuccess(res, "Payslip created successfully", record, 201);
  } catch (error) { next(error); }
};

export const getPayslips = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Payslips retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getMyPayslips = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listMine(req.user!.userId, req.query as Record<string, string>);
    sendSuccess(res, "Your payslips", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getPayslipSummary = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employee = String(req.query.employee ?? "");
    const month = String(req.query.month ?? "");
    if (!employee || !/^\d{4}-\d{2}$/.test(month)) { sendError(res, "employee and month (YYYY-MM) are required", 400); return; }
    const summary = await service.summary(employee, month);
    sendSuccess(res, "Summary", summary);
  } catch (error) { next(error); }
};

/** PUT /payslips/lop-override — HR's loss-of-pay days for one person's month; null days goes back to attendance. */
export const setLopOverride = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = lopOverrideSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const summary = await service.setLopOverride(parsed.data, req.user!.userId);
    sendSuccess(res, parsed.data.days === null ? "Loss of pay back to attendance" : "Loss of pay updated", summary);
  } catch (error) { next(error); }
};

/** POST /payslips/mute — no salary and nothing deducted for this person this month. */
export const mutePayroll = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = payrollMuteSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Muted for the month", await service.mute(parsed.data, req.user!.userId));
  } catch (error) { next(error); }
};

/** POST /payslips/unmute */
export const unmutePayroll = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = payrollMuteSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Unmuted", await service.unmute(parsed.data));
  } catch (error) { next(error); }
};

export const getPayrollRun = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = String(req.query.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) { sendError(res, "month (YYYY-MM) is required", 400); return; }
    sendSuccess(res, "Payroll run", await service.runPreview(month));
  } catch (error) { next(error); }
};

export const getSalaryRegister = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = String(req.query.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) { sendError(res, "month (YYYY-MM) is required", 400); return; }
    sendSuccess(res, "Salary register", await service.salaryRegister(month));
  } catch (error) { next(error); }
};

export const runPayroll = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = String(req.body?.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) { sendError(res, "month (YYYY-MM) is required", 400); return; }
    sendSuccess(res, "Payroll generated", await service.runGenerate(month, req.user!.userId));
  } catch (error) { next(error); }
};

export const getPayslipById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Payslip retrieved successfully", await service.detail(req.params.id));
  } catch (error) { next(error); }
};

export const updatePayslip = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updatePayslipSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.update(req.params.id, parsed.data, req.user!.userId);
    sendSuccess(res, "Payslip updated successfully", record);
  } catch (error) { next(error); }
};

export const bulkUpdatePayslipStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = bulkPayslipStatusSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const result = await service.bulkSetStatus(parsed.data.ids, parsed.data.status);
    sendSuccess(res, result.message, result);
  } catch (error) { next(error); }
};

export const bulkDeletePayslips = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = bulkPayslipSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const result = await service.bulkRemove(parsed.data.ids);
    sendSuccess(res, result.message, result);
  } catch (error) { next(error); }
};

export const deletePayslip = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};
