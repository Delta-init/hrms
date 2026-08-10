import { env } from "../config/env.js";
import { AuditLog } from "../models/AuditLog.js";
import { FaceProfile } from "../models/FaceProfile.js";
import { User } from "../models/User.js";
import type { IFaceProfile } from "../types/index.js";
import {
  FaceServiceError,
  embedFaces,
  faceServiceEnabled,
  getGallery,
  replaceGallery,
  serviceModelPack,
} from "./faceClient.js";
import { deleteObject, publicUrl, putObject } from "./uploadService.js";
import { scoped } from "../utils/orgContext.js";

/**
 * The wording an employee agrees to before their face is enrolled.
 *
 * Stored verbatim on the profile rather than referenced by id: consent is only
 * meaningful if you can show, later, exactly what was agreed to. Edit this and
 * existing profiles keep the text their owner actually saw.
 */
export const FACE_CONSENT_TEXT =
  "I agree to my face being recorded and used to identify me when I clock in and " +
  "out at work. I understand a mathematical representation of my face is stored " +
  "for this purpose, that I may withdraw consent at any time, and that my face " +
  "data is deleted when I leave.";

const MIN_CAPTURES = Number(env.FACE_ENROLL_MIN_CAPTURES) || 3;
const MAX_CAPTURES = Number(env.FACE_ENROLL_MAX_CAPTURES) || 5;

export class FaceEnrollmentError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(message: string, statusCode = 400, code = "FACE_ENROLLMENT_FAILED", details?: unknown) {
    super(message);
    this.name = "FaceEnrollmentError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface EnrollInput {
  targetUserId: string;
  /** Base64 frames, one per capture angle. */
  images: string[];
  /** Who is performing the enrollment — the employee or an admin with them. */
  actorId: string;
  consentAcknowledged: boolean;
}

export interface FaceStatus {
  enrolled: boolean;
  captures: number;
  modelPack?: string;
  referenceUrl?: string | null;
  enrolledAt?: Date;
  updatedAt?: Date;
  consentAt?: Date;
}

/** Embeddings are unit vectors around ±0.1; six decimals is far below the
 *  precision that affects a cosine score, and halves what we store and ship. */
function round(vector: number[]): number[] {
  return vector.map((v) => Math.round(v * 1e6) / 1e6);
}

export class FaceEnrollmentService {
  readonly minCaptures = MIN_CAPTURES;
  readonly maxCaptures = MAX_CAPTURES;

  private ensureEnabled(): void {
    if (!faceServiceEnabled) {
      throw new FaceEnrollmentError(
        "Face recognition is not configured on this server.",
        503,
        "FACE_SERVICE_DISABLED"
      );
    }
  }

  /**
   * The gallery an employee's face belongs to.
   *
   * Taken from the employee's own organization rather than the request's org
   * context, so a Super Admin enrolling someone while unscoped still files the
   * face under that employee's company and not a shared bucket.
   */
  private galleryKey(organization: unknown): string {
    return organization ? String(organization) : "global";
  }

  async enroll(input: EnrollInput): Promise<FaceStatus> {
    this.ensureEnabled();

    if (!input.consentAcknowledged) {
      throw new FaceEnrollmentError(
        "The employee must consent before their face can be enrolled.",
        400,
        "CONSENT_REQUIRED"
      );
    }
    if (input.images.length < MIN_CAPTURES || input.images.length > MAX_CAPTURES) {
      throw new FaceEnrollmentError(
        `Enrollment needs between ${MIN_CAPTURES} and ${MAX_CAPTURES} captures.`,
        400,
        "CAPTURE_COUNT"
      );
    }

    const target = await User.findById(input.targetUserId).select("name organization status");
    if (!target) throw new FaceEnrollmentError("Employee not found", 404, "USER_NOT_FOUND");
    if (target.status === "inactive") {
      throw new FaceEnrollmentError(
        "This employee is deactivated and cannot be enrolled.",
        400,
        "USER_INACTIVE"
      );
    }

    // Embedding happens before anything is written, so a rejected capture
    // leaves the previous profile — if there is one — completely untouched.
    let faces;
    try {
      faces = await embedFaces(input.images);
    } catch (error) {
      throw this.translate(error);
    }
    const modelPack = await serviceModelPack();

    const existing = await FaceProfile.findOne({ user: target._id });
    const referenceKey = await this.storeReference(
      input.images[0]!,
      this.galleryKey(target.organization),
      String(target._id),
      existing?.referenceKey ?? null
    );

    const consent = {
      at: new Date(),
      by: input.actorId,
      text: FACE_CONSENT_TEXT,
    };

    const profile = await FaceProfile.findOneAndUpdate(
      { user: target._id },
      {
        $set: {
          organization: target.organization ?? null,
          embeddings: faces.map((f) => round(f.embedding)),
          modelPack,
          referenceKey,
          consent,
          enrolledBy: input.actorId,
          status: "active",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await this.audit(
      existing ? "face.re-enroll" : "face.enroll",
      input.actorId,
      String(target._id),
      target.name,
      target.organization
    );
    await this.syncGallery(this.galleryKey(target.organization));

    return this.toStatus(profile, faces.length);
  }

  /** Delete an employee's face data — offboarding, or a withdrawal of consent. */
  async remove(targetUserId: string, actorId: string): Promise<void> {
    const profile = await FaceProfile.findOne({ user: targetUserId });
    if (!profile) return;

    const target = await User.findById(targetUserId).select("name organization");
    const orgKey = this.galleryKey(profile.organization);

    if (profile.referenceKey) await deleteObject(profile.referenceKey);
    await profile.deleteOne();

    await this.audit("face.delete", actorId, targetUserId, target?.name ?? "Unknown", profile.organization);

    // Best-effort: the face data is already gone from the database, which is
    // what consent withdrawal actually requires. A recognition service that is
    // briefly down must not turn a deletion into an error for the user.
    if (faceServiceEnabled) {
      try {
        await this.syncGallery(orgKey);
      } catch {
        /* the next sync will reconcile it */
      }
    }
  }

  async status(userId: string): Promise<FaceStatus> {
    const profile = await FaceProfile.findOne({ user: userId }).select("+embeddings");
    if (!profile) return { enrolled: false, captures: 0 };
    return this.toStatus(profile, profile.embeddings.length);
  }

  /** Which of these users have a face on file — drives the employee-list badge. */
  async enrolledUserIds(userIds: string[]): Promise<string[]> {
    const profiles = await FaceProfile.find(
      scoped({ user: { $in: userIds }, status: "active" })
    ).select("user");
    return profiles.map((p) => String(p.user));
  }

  /**
   * Push an organization's embeddings to the recognition service.
   *
   * The service holds its gallery in memory and loses it on restart, so this
   * compares the version it reports against the one implied by the database and
   * re-pushes when they differ. That makes a restart on either side self-heal
   * on the next enrollment or punch, with no coordination between them.
   */
  async syncGallery(orgKey: string, force = false): Promise<{ version: string; users: number }> {
    this.ensureEnabled();

    const filter = orgKey === "global" ? { organization: null } : { organization: orgKey };
    const profiles = await FaceProfile.find({ ...filter, status: "active" })
      .select("+embeddings user updatedAt")
      .sort({ updatedAt: -1 });

    // Any enroll, re-enroll or delete moves either the count or the newest
    // timestamp, so this is enough to tell two galleries apart.
    const newest = profiles[0]?.updatedAt?.getTime() ?? 0;
    const version = `${profiles.length}-${newest}`;

    if (!force) {
      const loaded = await getGallery(orgKey);
      if (loaded?.version === version) return { version, users: loaded.users };
    }

    // Full push. At a few hundred employees this is a handful of megabytes; if
    // an org ever grows past a few thousand, this wants chunking.
    const state = await replaceGallery(
      orgKey,
      version,
      profiles.map((p) => ({ user_id: String(p.user), embeddings: p.embeddings }))
    );
    return { version: state.version, users: state.users };
  }

  private async storeReference(
    image: string,
    orgKey: string,
    userId: string,
    previousKey: string | null
  ): Promise<string | null> {
    // One photo, kept so HR can put a face to a disputed punch. Storage is
    // optional in this deployment, and a missing bucket must not block an
    // enrollment — the embeddings are what recognition actually needs.
    try {
      const base64 = image.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
      const key = `${orgKey}/face/${userId}/reference-${Date.now()}.jpg`;
      await putObject(key, Buffer.from(base64, "base64"), "image/jpeg");
      if (previousKey && previousKey !== key) await deleteObject(previousKey);
      return key;
    } catch {
      return previousKey;
    }
  }

  private toStatus(profile: IFaceProfile, captures: number): FaceStatus {
    return {
      enrolled: true,
      captures,
      modelPack: profile.modelPack,
      referenceUrl: profile.referenceKey ? publicUrl(profile.referenceKey) : null,
      enrolledAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      consentAt: profile.consent?.at,
    };
  }

  /** Turn a face-service failure into something an admin can act on. */
  private translate(error: unknown): Error {
    if (!(error instanceof FaceServiceError)) return error as Error;

    const messages: Record<string, string> = {
      NO_FACE: "No face was found in one of the captures.",
      MULTIPLE_FACES: "A capture had more than one face in shot — only the employee should be visible.",
      LOW_QUALITY: "A capture was not clear enough to enroll.",
      INVALID_BASE64: "A capture could not be read.",
      UNDECODABLE_IMAGE: "A capture could not be read.",
      IMAGE_TOO_LARGE: "A capture was too large.",
    };

    const detail = error.details as { frame_index?: number; failures?: string[] } | undefined;
    const which = typeof detail?.frame_index === "number" ? ` (capture ${detail.frame_index + 1})` : "";
    const base = messages[error.code];

    return new FaceEnrollmentError(
      base ? `${base}${which}` : error.message,
      base ? 422 : error.statusCode,
      error.code,
      detail?.failures ? { failures: detail.failures, frame: detail.frame_index } : undefined
    );
  }

  private async audit(
    action: string,
    actorId: string,
    targetId: string,
    targetName: string,
    organization: unknown
  ): Promise<void> {
    const actor = await User.findById(actorId).select("name");
    await AuditLog.create({
      organization: organization ?? null,
      action,
      actor: actorId,
      actorName: actor?.name ?? "Unknown",
      target: targetId,
      targetName,
    });
  }
}
