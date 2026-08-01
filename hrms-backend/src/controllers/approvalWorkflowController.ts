import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest, ApprovableModule } from "../types/index.js";
import { ApprovalWorkflowService } from "../services/approvalWorkflowService.js";
import { moduleEnum, upsertApprovalWorkflowSchema } from "../validations/approvalWorkflowValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new ApprovalWorkflowService();

export const getApprovalWorkflows = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Approval workflows retrieved", await service.list());
  } catch (error) { next(error); }
};

export const getApprovalWorkflow = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsedModule = moduleEnum.safeParse(req.params.module);
    if (!parsedModule.success) { sendError(res, "Unknown approvable module", 400); return; }
    sendSuccess(res, "Approval workflow retrieved", await service.get(parsedModule.data as ApprovableModule));
  } catch (error) { next(error); }
};

export const upsertApprovalWorkflow = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsedModule = moduleEnum.safeParse(req.params.module);
    if (!parsedModule.success) { sendError(res, "Unknown approvable module", 400); return; }
    const parsed = upsertApprovalWorkflowSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.upsert(parsedModule.data as ApprovableModule, parsed.data);
    sendSuccess(res, "Approval workflow saved", record);
  } catch (error) { next(error); }
};

export const deleteApprovalWorkflow = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsedModule = moduleEnum.safeParse(req.params.module);
    if (!parsedModule.success) { sendError(res, "Unknown approvable module", 400); return; }
    const result = await service.remove(parsedModule.data as ApprovableModule);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};
