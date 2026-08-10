import { env } from "../config/env.js";
import { Attendance } from "../models/Attendance.js";
import { Kiosk } from "../models/Kiosk.js";
import { User } from "../models/User.js";
import type { IKiosk } from "../types/index.js";
import { scoped } from "../utils/orgContext.js";
import { AttendanceService, type PunchSource } from "./attendanceService.js";
import { FaceServiceError, recognize, type RecognizeReason } from "./faceClient.js";
import { FaceEnrollmentService } from "./faceEnrollmentService.js";
import { putObject } from "./uploadService.js";

const COOLDOWN_MS = (Number(env.FACE_PUNCH_COOLDOWN_SECONDS) || 60) * 1000;

/** How long back clockOut is willing to look for an open session. */
const OPEN_SESSION_WINDOW_MS = 2 * 86_400_000;

export type PunchOutcome =
  | { status: "punched"; direction: "in" | "out"; user: { id: string; name: string }; at: Date; score: number; lateMinutes: number }
  | { status: "cooldown"; user: { id: string; name: string }; at: Date }
  | { status: "not_recognised"; reason: RecognizeReason; hint: string }
  | { status: "refused"; message: string };

/**
 * What the kiosk should say for each way recognition can come up short. These
 * are instructions, not diagnostics — the person is standing at a screen and
 * needs to know what to do differently, and telling them "score 0.41 against a
 * 0.45 threshold" tells them nothing they can act on.
 */
const HINTS: Record<RecognizeReason, string> = {
  MATCHED: "",
  NO_FACE: "Step in front of the camera.",
  AMBIGUOUS_FRAME: "Only one person at a time, please.",
  LOW_QUALITY: "Step a little closer and hold still.",
  BELOW_THRESHOLD: "Not recognised. Try again, or use your login.",
  AMBIGUOUS_MATCH: "Not recognised. Try again, or use your login.",
  EMPTY_GALLERY: "Nobody is enrolled for face check-in yet.",
};

export class FacePunchService {
  private attendance = new AttendanceService();
  private enrollment = new FaceEnrollmentService();

  /**
   * Identify whoever is at the kiosk and record their punch.
   *
   * Nothing the tablet sends decides who this is, or whether it is a check-in
   * or a check-out. The frames are the only input; the identity comes from the
   * recognition service and the direction from what the database already says
   * about their day. A kiosk cannot punch a chosen employee even if someone
   * rewrites its request.
   */
  async punch(kiosk: IKiosk, images: string[], ip?: string | null): Promise<PunchOutcome> {
    const orgKey = kiosk.organization ? String(kiosk.organization) : "global";

    const result = await this.recognizeWithResync(orgKey, images);

    void this.touch(kiosk, ip);

    if (!result.matched || !result.best) {
      return { status: "not_recognised", reason: result.reason, hint: HINTS[result.reason] };
    }

    // Re-check the person against the database. The gallery is per-organization
    // so it cannot name someone from another tenant, but it can still name
    // somebody who was deactivated since the last sync.
    const user = await User.findOne(scoped({ _id: result.best.user_id })).select("name status");
    if (!user) return { status: "refused", message: "Your record is not available at this device." };
    if (user.status === "inactive") {
      return { status: "refused", message: "This account is not active. Speak to HR." };
    }

    const userId = String(user._id);
    const previous = await this.lastPunchAt(userId);
    if (previous && Date.now() - previous.getTime() < COOLDOWN_MS) {
      // A second frame moments later is the same person still standing there,
      // not a check-out. Without this, walking away too slowly undoes the punch.
      return { status: "cooldown", user: { id: userId, name: user.name }, at: previous };
    }

    const direction = (await this.hasOpenSession(userId)) ? "out" : "in";
    const source: PunchSource = {
      method: "face",
      kiosk: String(kiosk._id),
      matchScore: result.best.score,
      proofKey: await this.storeProof(orgKey, userId, images[result.frame_index ?? 0] ?? images[0]!),
    };

    const record =
      direction === "in"
        ? await this.attendance.clockIn(userId, source)
        : await this.attendance.clockOut(userId, source);

    return {
      status: "punched",
      direction,
      user: { id: userId, name: user.name },
      at: direction === "in" ? record!.checkIn! : record!.checkOut!,
      score: result.best.score,
      lateMinutes: record!.lateMinutes ?? 0,
    };
  }

  /**
   * Recognise, re-pushing the gallery once if the service has forgotten it.
   *
   * The face service holds its gallery in memory, so a restart leaves it with
   * nothing. Rather than syncing on every punch — a round trip that is wasted
   * almost every time — let the first punch after a restart fail, fix it, and
   * retry. The person at the kiosk sees a slightly slow punch, not an error.
   */
  private async recognizeWithResync(orgKey: string, images: string[]) {
    try {
      return await recognize(orgKey, images);
    } catch (error) {
      if (!(error instanceof FaceServiceError) || error.code !== "GALLERY_NOT_LOADED") throw error;
      await this.enrollment.syncGallery(orgKey, true);
      return recognize(orgKey, images);
    }
  }

  /** The most recent punch instant for this user, in or out. */
  private async lastPunchAt(userId: string): Promise<Date | null> {
    const cutoff = new Date(Date.now() - OPEN_SESSION_WINDOW_MS);
    const recent = await Attendance.findOne(scoped({ user: userId, date: { $gte: cutoff } }))
      .sort({ date: -1 })
      .select("sessions");
    const last = recent?.sessions?.[recent.sessions.length - 1];
    if (!last) return null;
    return last.checkOut ?? last.checkIn ?? null;
  }

  /**
   * Whether they are currently clocked in.
   *
   * Deliberately the same query clockOut uses to find the session it will
   * close, so the direction shown at the kiosk and the punch that follows can
   * never disagree.
   */
  private async hasOpenSession(userId: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - OPEN_SESSION_WINDOW_MS);
    const open = await Attendance.findOne({
      user: userId,
      checkIn: { $ne: null },
      checkOut: null,
      date: { $gte: cutoff },
    }).select("_id");
    return !!open;
  }

  /**
   * Keep the frame the punch was made from, so HR can settle a dispute about
   * who was actually at the camera. Purged on a retention schedule; a missing
   * bucket must never cost somebody their attendance.
   */
  private async storeProof(orgKey: string, userId: string, image: string): Promise<string | null> {
    try {
      const base64 = image.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
      const key = `${orgKey}/face-punches/${userId}/${Date.now()}.jpg`;
      await putObject(key, Buffer.from(base64, "base64"), "image/jpeg");
      return key;
    } catch {
      return null;
    }
  }

  /** Record that this device is alive, without holding up the punch. */
  private async touch(kiosk: IKiosk, ip?: string | null): Promise<void> {
    try {
      await Kiosk.updateOne(
        { _id: kiosk._id },
        { $set: { lastSeenAt: new Date(), lastSeenIp: ip ?? null } }
      );
    } catch {
      /* a heartbeat is not worth failing a punch over */
    }
  }
}
