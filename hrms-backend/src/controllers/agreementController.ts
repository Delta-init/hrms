import type { Response, NextFunction } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/index.js";
import { DocumentTemplate } from "../models/DocumentTemplate.js";
import { InductionVideo } from "../models/InductionVideo.js";
import { SignedAgreement } from "../models/SignedAgreement.js";
import { Employee } from "../models/Employee.js";
import { myState, sign, sha256, reviewSignedAgreement } from "../services/agreementService.js";
import { startView, heartbeat } from "../services/inductionService.js";
import { putObject } from "../services/uploadService.js";
import { publicUrl } from "../config/r2.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { buildPunchContext } from "../utils/punchContext.js";

/** Seconds from an MP4's movie header — measured here, never taken from the client. */
export function mp4Duration(buf: Buffer): number | null {
  const i = buf.indexOf(Buffer.from("mvhd"));
  if (i < 0) return null;
  const base = i + 8; // past the box type, version and flags
  const version = buf[i + 4];
  try {
    if (version === 1) {
      const timescale = buf.readUInt32BE(base + 16);
      return timescale ? Number(buf.readBigUInt64BE(base + 20)) / timescale : null;
    }
    const timescale = buf.readUInt32BE(base + 8);
    return timescale ? buf.readUInt32BE(base + 12) / timescale : null;
  } catch { return null; }
}

// ── Self-service ─────────────────────────────────────────────────────────────
export const getMyAgreements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Your agreements", await myState(req.user!.userId)); }
  catch (e) { next(e); }
};

export const startInduction = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try { sendSuccess(res, "Induction opened", await startView(req.user!.userId)); }
  catch (e) { next(e); }
};

const beatSchema = z.object({ position: z.coerce.number().min(0).max(100_000) });

export const inductionHeartbeat = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = beatSchema.safeParse(req.body ?? {});
    if (!parsed.success) { sendError(res, "A playback position is required", 400); return; }
    sendSuccess(res, "Progress recorded", await heartbeat(req.user!.userId, parsed.data.position));
  } catch (e) { next(e); }
};

const signSchema = z.object({
  signaturePng: z.string().min(200).max(2_000_000),
  typedName: z.string().min(2).max(120),
});

export const signAgreements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = signSchema.safeParse(req.body ?? {});
    if (!parsed.success) { sendError(res, "A drawn signature and your full name are required", 400, parsed.error.flatten().fieldErrors); return; }
    const ctx = buildPunchContext(req);
    const record = await sign(req.user!.userId, parsed.data, { ip: ctx.ip, userAgent: ctx.userAgent });
    sendSuccess(res, "Signed and sent to HR", record, 201);
  } catch (e) { next(e); }
};

// ── Administration ───────────────────────────────────────────────────────────
const templateSchema = z.object({
  kind: z.enum(["nda", "tc"]),
  variant: z.enum(["onsite", "remote"]),
});

export const uploadTemplate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = templateSchema.safeParse(req.body ?? {});
    if (!parsed.success) { sendError(res, "Pick a document type and whether it is for onsite or remote staff", 400); return; }
    if (!req.file) { sendError(res, "A PDF is required", 400); return; }
    if (req.file.mimetype !== "application/pdf") { sendError(res, "The agreement must be a PDF", 400); return; }

    const { kind, variant } = parsed.data;
    const buf = req.file.buffer;
    const latest = await DocumentTemplate.findOne(scoped({ kind, variant })).sort({ version: -1 }).lean();
    const version = (latest?.version ?? 0) + 1;
    const key = `agreement-templates/${variant}/${kind}-v${version}.pdf`;
    await putObject(key, buf, "application/pdf");

    // Supersede rather than delete: signatures point at the version they were
    // made against, and that file has to stay readable for as long as they do.
    await DocumentTemplate.updateMany(scoped({ kind, variant, active: true }), { $set: { active: false } });
    const doc = await DocumentTemplate.create({
      organization: getOrgId(), kind, variant, version,
      fileKey: key, fileName: req.file.originalname?.slice(0, 260),
      sha256: sha256(buf), active: true, uploadedBy: req.user!.userId,
    });
    sendSuccess(res, `Uploaded as version ${version}`, doc, 201);
  } catch (e) { next(e); }
};

export const listTemplates = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rows = await DocumentTemplate.find(scoped({ active: true })).sort({ variant: 1, kind: 1 }).lean();
    const video = await InductionVideo.findOne(scoped({ active: true })).sort({ createdAt: -1 }).lean();
    sendSuccess(res, "Agreement documents", {
      templates: rows.map((r) => ({ ...r, url: publicUrl(r.fileKey) })),
      video: video ? { ...video, url: publicUrl(video.fileKey) } : null,
      // Anyone who cannot be served a document at all, so the gap is visible
      // here rather than discovered by a new joiner who cannot finish setup.
      unclassified: await Employee.countDocuments(scoped({ workMode: { $nin: ["office", "wfh"] }, status: { $ne: "terminated" } })),
    });
  } catch (e) { next(e); }
};

export const uploadInductionVideo = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) { sendError(res, "An MP4 is required", 400); return; }
    const seconds = mp4Duration(req.file.buffer);
    if (!seconds || seconds < 1) {
      sendError(res, "Could not read the video's length from the file. It must be a standard MP4.", 400);
      return;
    }
    const key = `induction/video-${Date.now()}.mp4`;
    await putObject(key, req.file.buffer, "video/mp4");
    await InductionVideo.updateMany(scoped({ active: true }), { $set: { active: false } });
    const doc = await InductionVideo.create({
      organization: getOrgId(),
      title: (req.body?.title as string)?.slice(0, 160) || "Induction",
      fileKey: key, fileName: req.file.originalname?.slice(0, 260),
      durationSeconds: Math.round(seconds), active: true, uploadedBy: req.user!.userId,
    });
    sendSuccess(res, `Uploaded — ${Math.round(seconds)}s`, doc, 201);
  } catch (e) { next(e); }
};

// ── HR review ────────────────────────────────────────────────────────────────
export const listSignedAgreements = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    const rows = await SignedAgreement.find(scoped(filter))
      .populate("employee", "name employeeCode designation")
      .sort({ createdAt: -1 }).limit(200).lean();
    sendSuccess(res, "Signed agreements", rows.map((r) => ({
      ...r,
      documents: r.documents.map((d) => ({ ...d, url: publicUrl(d.signedKey) })),
      signatureUrl: publicUrl(r.signatureKey),
    })));
  } catch (e) { next(e); }
};

export const getSignedAgreement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const r = await SignedAgreement.findOne(scoped({ _id: req.params.id }))
      .populate("employee", "name employeeCode designation")
      .populate("videoView", "watchedSeconds completedAt skipAttempts")
      .lean();
    if (!r) { sendError(res, "Not found", 404); return; }
    sendSuccess(res, "Signed agreement", {
      ...r,
      documents: r.documents.map((d) => ({ ...d, url: publicUrl(d.signedKey) })),
      signatureUrl: publicUrl(r.signatureKey),
    });
  } catch (e) { next(e); }
};

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional(),
});

/**
 * HR verifies a signing.
 *
 * Rejection sends the employee back to sign again rather than deleting
 * anything: "signed, rejected, re-signed" should stay readable afterwards,
 * and the note is what tells them what to fix.
 */
export const reviewAgreement = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) { sendError(res, "Validation failed", 400, parsed.error.flatten().fieldErrors); return; }
    const record = await reviewSignedAgreement(
      req.params.id, parsed.data.action === "approve", parsed.data.note ?? null,
      req.user!.userId, req.user!.role as never
    );
    sendSuccess(res, record.status === "pending" ? "Approved — passed to the next step" : `Agreements ${record.status}`, record);
  } catch (e) { next(e); }
};
