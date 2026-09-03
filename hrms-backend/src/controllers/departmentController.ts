import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { DepartmentService } from "../services/departmentService.js";
import { createDepartmentSchema, updateDepartmentSchema } from "../validations/departmentValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new DepartmentService();

export const createDepartment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createDepartmentSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Department created successfully", record, 201);
  } catch (error) { next(error); }
};

export const getDepartments = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Departments retrieved successfully", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getAllDepartmentsSimple = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Departments retrieved successfully", await service.listSimple());
  } catch (error) { next(error); }
};

/** The department(s) this login heads — self-service, no module permission. */
export const getMyDepartments = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Your departments", await service.mine(req.user!.userId));
  } catch (error) { next(error); }
};

export const getDepartmentById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Department retrieved successfully", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const getDepartmentReport = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = String(req.query.month ?? "");
    const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
    sendSuccess(res, "Department report", await service.report(req.params.id, m));
  } catch (error) { next(error); }
};

export const updateDepartment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateDepartmentSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.update(req.params.id, parsed.data);
    sendSuccess(res, "Department updated successfully", record);
  } catch (error) { next(error); }
};

export const deleteDepartment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};
