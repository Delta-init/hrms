import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { AuthService } from "../services/authService.js";
import {
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  setPasswordSchema,
  completeProfileSchema,
} from "../validations/authValidation.js";
import { sendSuccess, sendError } from "../utils/response.js";

const authService = new AuthService();

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }

    const result = await authService.login(parsed.data);
    sendSuccess(res, "Login successful", result, 200);
  } catch (error) {
    next(error);
  }
};

export const setPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = setPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }

    const result = await authService.setPassword(parsed.data);
    sendSuccess(res, "Password set successfully", result, 200);
  } catch (error) {
    next(error);
  }
};

export const exchange = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ticket = (req.body?.ticket ?? "") as string;
    if (!ticket) {
      sendError(res, "Ticket is required", 400);
      return;
    }
    const result = await authService.exchange(ticket);
    sendSuccess(res, "Session exchanged", result, 200);
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = refreshTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }

    const result = await authService.refreshToken(parsed.data.refreshToken);
    sendSuccess(res, "Token refreshed successfully", result, 200);
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await authService.getProfile(req.user!.userId);
    sendSuccess(res, "Profile retrieved successfully", user);
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }

    const { message, ...tokens } = await authService.changePassword(req.user!.userId, parsed.data);
    sendSuccess(res, message, tokens);
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await authService.logout(req.user!.userId);
    sendSuccess(res, result.message);
  } catch (error) {
    next(error);
  }
};

export const getMyProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await authService.getMyProfile(req.user!.userId);
    sendSuccess(res, "Profile retrieved", data);
  } catch (error) {
    next(error);
  }
};

export const completeProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = completeProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }
    const user = await authService.completeProfile(req.user!.userId, parsed.data);
    sendSuccess(res, "Profile completed", user);
  } catch (error) {
    next(error);
  }
};
