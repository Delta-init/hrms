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

    const result = await authService.login(parsed.data, req.headers["user-agent"]);
    sendSuccess(res, "Login successful", result, 200);
  } catch (error) {
    next(error);
  }
};

/**
 * Sign in somebody the Root portal has already identified.
 *
 * The browser arrives at /sso with a single-use token and posts it here. This
 * server spends it against the portal — one call, server to server, the token
 * never stored — and signs in whoever it vouches for.
 *
 * Fails closed. With no ROOT_ERP_API_URL this refuses rather than falling back
 * to a default: a server that quietly asks itself to vouch for a token would
 * accept anything at all.
 */
export const ssoLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ssoToken = String((req.body as { ssoToken?: unknown })?.ssoToken ?? "").trim();
    if (!ssoToken) {
      sendError(res, "ssoToken is required", 400);
      return;
    }

    const rootApi = String(process.env["ROOT_ERP_API_URL"] ?? "").replace(/\/+$/, "");
    if (!rootApi) {
      sendError(res, "SSO is not configured on this server", 503);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let email = "";
    try {
      const verified = await fetch(
        `${rootApi}/api/auth/verify-sso-token?token=${encodeURIComponent(ssoToken)}`,
        { signal: controller.signal },
      );
      // One message whatever went wrong. Telling apart expired from spent from
      // never-existed tells somebody holding a stale token which case they hit.
      if (!verified.ok) {
        sendError(res, "Invalid or expired sign-in link", 401);
        return;
      }
      const body = (await verified.json()) as { data?: { email?: string } };
      email = String(body.data?.email ?? "").trim();
    } catch {
      sendError(res, "The sign-in service could not be reached", 503);
      return;
    } finally {
      clearTimeout(timer);
    }

    if (!email) {
      sendError(res, "Invalid or expired sign-in link", 401);
      return;
    }

    // The user agent goes through for the same reason it does on a password
    // login: the mobile restriction is decided from it.
    const result = await authService.ssoLogin(email, req.get("user-agent"));
    sendSuccess(res, "SSO login successful", result, 200);
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

    const result = await authService.setPassword(parsed.data, req.headers["user-agent"]);
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
