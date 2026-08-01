import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { HelpdeskService } from "../services/helpdeskService.js";
import {
  createTicketSchema, assignTicketSchema, setTicketStatusSchema, addCommentSchema,
} from "../validations/helpdeskValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new HelpdeskService();

const canManage = (req: AuthenticatedRequest) =>
  !!req.user?.role?.permissions?.helpdesk?.edit || req.user?.role?.roleName === "Super Admin";

export const createTicket = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createTicketSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.create(parsed.data, req.user!.userId);
    sendSuccess(res, "Ticket submitted", record, 201);
  } catch (error) { next(error); }
};

export const getMyTickets = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Your tickets retrieved", await service.listMine(req.user!.userId));
  } catch (error) { next(error); }
};

export const getTickets = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Tickets retrieved", records, 200, pagination);
  } catch (error) { next(error); }
};

export const getTicketById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendSuccess(res, "Ticket retrieved", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const assignTicket = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = assignTicketSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Ticket assigned", await service.assign(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const setTicketStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = setTicketStatusSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    sendSuccess(res, "Ticket status updated", await service.setStatus(req.params.id, parsed.data));
  } catch (error) { next(error); }
};

export const deleteTicket = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) { next(error); }
};

export const addTicketComment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = addCommentSchema.safeParse(req.body);
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await service.addComment(req.params.id, req.user!.userId, parsed.data, canManage(req));
    sendSuccess(res, "Comment added", record);
  } catch (error) { next(error); }
};
