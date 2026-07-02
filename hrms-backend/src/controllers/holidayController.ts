import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { HolidayService } from "../services/holidayService.js";
import { createHolidaySchema, updateHolidaySchema } from "../validations/holidayValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new HolidayService();

export const createHoliday = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createHolidaySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.create(parsed.data);
    sendSuccess(res, "Holiday created successfully", record, 201);
  } catch (error) {
    next(error);
  }
};

export const getHolidays = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { records, pagination } = await service.list(req.query as Record<string, string>);
    sendSuccess(res, "Holidays retrieved successfully", records, 200, pagination);
  } catch (error) {
    next(error);
  }
};

export const getHolidayById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const record = await service.getById(req.params.id);
    sendSuccess(res, "Holiday retrieved successfully", record);
  } catch (error) {
    next(error);
  }
};

export const updateHoliday = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateHolidaySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const record = await service.update(req.params.id, parsed.data);
    sendSuccess(res, "Holiday updated successfully", record);
  } catch (error) {
    next(error);
  }
};

export const deleteHoliday = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await service.remove(req.params.id);
    sendSuccess(res, result.message);
  } catch (error) {
    next(error);
  }
};
