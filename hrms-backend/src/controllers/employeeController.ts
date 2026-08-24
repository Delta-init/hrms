import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { EmployeeService } from "../services/employeeService.js";
import { createEmployeeSchema, updateEmployeeSchema, updateMyProfileSchema, createLoginSchema } from "../validations/employeeValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new EmployeeService();

export const createEmployee = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const { record, loginError } = await service.create(parsed.data);
    // The employee exists either way; a failed login is reported in the message
    // so the caller can retry it from the employee's page.
    sendSuccess(
      res,
      loginError ? `Employee created, but the login was not: ${loginError}` : "Employee created successfully",
      record,
      201
    );
  } catch (error) { next(error); }
};

export const getEmployees = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Employees retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getEmployeeById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Employee retrieved successfully", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const getNextEmployeeCode = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Next employee code", { code: await service.nextCode() });
  } catch (error) { next(error); }
};

export const getEmployeeByUser = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Employee retrieved successfully", await service.getByUser(req.params.userId));
  } catch (error) { next(error); }
};

/** Self-service — the caller's own employee record, no module permission required. */
export const getMyEmployeeProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Your profile retrieved successfully", await service.getByUser(req.user!.userId));
  } catch (error) { next(error); }
};

/** Self-service — the caller edits their own personal-information sections only. */
export const updateMyProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateMyProfileSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.updateMyProfile(req.user!.userId, parsed.data);
    sendSuccess(res, "Profile updated successfully", record);
  } catch (error) { next(error); }
};

export const updateEmployee = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.update(req.params.id, parsed.data);
    sendSuccess(res, "Employee updated successfully", record);
  } catch (error) { next(error); }
};

export const resetEmployeeDevice = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.resetTrustedDevice(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) {
    next(error);
  }
};

export const deleteEmployee = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};

export const createEmployeeLogin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createLoginSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const result = await service.createLogin(req.params.id, parsed.data);
    sendSuccess(res, result.message, { employee: result.employee, loginEmail: result.loginEmail }, 201);
  } catch (error) { next(error); }
};
