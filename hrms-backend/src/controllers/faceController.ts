import type { NextFunction, Response } from "express";
import {
  FACE_CONSENT_TEXT,
  FaceEnrollmentError,
  FaceEnrollmentService,
} from "../services/faceEnrollmentService.js";
import { faceServiceEnabled } from "../services/faceClient.js";
import { livenessRequired } from "../services/livenessService.js";
import type { AuthenticatedRequest } from "../types/index.js";
import { getOrgId } from "../utils/orgContext.js";
import { Organization } from "../models/Organization.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { enrollFaceSchema } from "../validations/faceValidation.js";

const service = new FaceEnrollmentService();

function canManage(req: AuthenticatedRequest): boolean {
  return (
    !!req.user?.role?.permissions?.employees?.edit || req.user?.role?.roleName === "Super Admin"
  );
}

/** "me" resolves to the caller, so the self-service and admin paths share a route. */
function resolveTarget(req: AuthenticatedRequest): string {
  const requested = String(req.params.userId ?? "me");
  return requested === "me" ? req.user!.userId : requested;
}

/**
 * Enrolling or deleting someone else's face is an HR action; doing it to your
 * own is not. Anything else would either lock employees out of managing their
 * own biometric data or let any employee enroll a face against a colleague.
 */
function assertAllowed(req: AuthenticatedRequest, targetUserId: string): boolean {
  return targetUserId === req.user!.userId || canManage(req);
}

function handle(res: Response, error: unknown, next: NextFunction): void {
  if (error instanceof FaceEnrollmentError) {
    sendError(res, error.message, error.statusCode, error.details);
    return;
  }
  next(error);
}

export const getFaceSettings = async (
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  /**
   * Whether this organisation asks for a face, answered here rather than by the
   * onboarding state.
   *
   * The dashboard prompt used to read it from /agreements/me, which throws for
   * anybody with no work mode set — so the one employee who most needed
   * chasing was the one person it stayed silent for. Whether a face is wanted
   * has nothing to do with which agreements apply.
   */
  const org = await Organization.findById(getOrgId()).select("settings.requireFaceEnrollment")
    .lean<{ settings?: { requireFaceEnrollment?: boolean } } | null>();

  sendSuccess(res, "Face enrollment settings", {
    enabled: faceServiceEnabled,
    /** Asked for by the organisation, and possible — one without the other is not a requirement. */
    required: !!org?.settings?.requireFaceEnrollment && faceServiceEnabled,
    minCaptures: service.minCaptures,
    maxCaptures: service.maxCaptures,
    consentText: FACE_CONSENT_TEXT,
    // Surfaced so whoever manages kiosks can see that anti-spoofing is off,
    // rather than it being a setting on a server nobody looks at.
    livenessRequired,
  });
};

export const getFaceStatus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const target = resolveTarget(req);
    if (!assertAllowed(req, target)) {
      sendError(res, "You can only view your own face enrollment", 403);
      return;
    }
    sendSuccess(res, "Face enrollment status", await service.status(target));
  } catch (error) {
    handle(res, error, next);
  }
};

export const enrollFace = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const target = resolveTarget(req);
    if (!assertAllowed(req, target)) {
      sendError(res, "You can only enroll your own face", 403);
      return;
    }

    const parsed = enrollFaceSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors);
      return;
    }

    const status = await service.enroll({
      targetUserId: target,
      images: parsed.data.images,
      consentAcknowledged: parsed.data.consentAcknowledged,
      actorId: req.user!.userId,
    });
    sendSuccess(res, "Face enrolled successfully", status, 201);
  } catch (error) {
    handle(res, error, next);
  }
};

/** Judge one capture as it is taken, so a bad frame is caught at the camera. */
export const checkFaceCapture = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const target = resolveTarget(req);
    if (!assertAllowed(req, target)) {
      sendError(res, "You can only enroll your own face", 403);
      return;
    }
    const image = typeof req.body?.image === "string" ? req.body.image : "";
    if (image.length < 100) {
      sendError(res, "Capture looks empty", 400);
      return;
    }
    sendSuccess(res, "Capture checked", await service.checkCapture(image));
  } catch (error) {
    handle(res, error, next);
  }
};

export const deleteFaceProfile = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const target = resolveTarget(req);
    if (!assertAllowed(req, target)) {
      sendError(res, "You can only delete your own face data", 403);
      return;
    }
    await service.remove(target, req.user!.userId);
    sendSuccess(res, "Face data deleted");
  } catch (error) {
    handle(res, error, next);
  }
};

/** Which of the given users have a face on file — drives the employee-list badge. */
export const getFaceEnrollmentSummary = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const users = String(req.query.users ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (users.length === 0) {
      sendSuccess(res, "Face enrollment summary", { enrolled: [] });
      return;
    }
    sendSuccess(res, "Face enrollment summary", {
      enrolled: await service.enrolledUserIds(users),
    });
  } catch (error) {
    handle(res, error, next);
  }
};

/** Force-push this org's gallery. Normally automatic; exposed for support. */
export const syncFaceGallery = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await service.syncGallery(getOrgId() ?? "global", true);
    sendSuccess(res, "Face gallery synced", result);
  } catch (error) {
    handle(res, error, next);
  }
};
