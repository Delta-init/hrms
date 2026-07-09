import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { EmployeeService } from "../services/employeeService.js";
import { createEmployeeSchema, updateEmployeeSchema, createLoginSchema } from "../validations/employeeValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new EmployeeService();

export const createEmployee = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Employee created successfully", record, 201);
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

export const getEmployeeByUser = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Employee retrieved successfully", await service.getByUser(req.params.userId));
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
