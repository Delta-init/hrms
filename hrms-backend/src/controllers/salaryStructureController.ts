import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { SalaryStructureService } from "../services/salaryStructureService.js";
import {
  createSalaryStructureSchema, updateSalaryStructureSchema,
  assignStructureSchema, updateAssignmentSchema,
} from "../validations/salaryStructureValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new SalaryStructureService();

// ── Structure templates ───────────────────────────────────────────────────────
export const createStructure = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createSalaryStructureSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Salary structure created", await service.create(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getStructures = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Salary structures retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getStructureById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Salary structure retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const updateStructure = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateSalaryStructureSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Salary structure updated", await service.update(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteStructure = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Salary structure deleted", await service.remove(req.params.id));
  } catch (error) { next(error); }
};

// ── Assignments ───────────────────────────────────────────────────────────────
export const assignStructure = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = assignStructureSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Structure assigned", await service.assign(parsed.data, req.user!.userId), 201);
  } catch (error) { next(error); }
};

export const getAssignments = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.listAssignments(req.query as Record<string, string>);
    sendSuccess(res, "Assignments retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const updateAssignment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateAssignmentSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Assignment updated", await service.updateAssignment(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteAssignment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Assignment removed", await service.removeAssignment(req.params.id));
  } catch (error) { next(error); }
};

export const getBreakup = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employee, month } = req.query as { employee?: string; month?: string };
    if (!employee || !month) { sendError(res, "employee and month are required", 400); return; }
    sendSuccess(res, "Breakup resolved", await service.breakup(employee, month));
  } catch (error) { next(error); }
};
