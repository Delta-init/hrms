import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/index.js";
import { BackupService } from "../services/backupService.js";
import { sendSuccess, sendError } from "../utils/response.js";

const service = new BackupService();

/**
 * Super Admin, and nobody else — not even HR.
 *
 * An archive is every collection in one file: a hundred and seven password
 * hashes, the organisation's live SMTP credentials, sixty-four people's
 * biometric embeddings, every passport and every payslip. Each of those is
 * reachable today only through a page that checks its own permission, and a
 * backup collapses all of them into a single download. There is no module
 * permission for this on purpose — a permission is something that can be
 * granted by mistake.
 */
function requireSuperAdmin(req: AuthenticatedRequest, res: Response): boolean {
  const role = req.user?.role as unknown as { roleName?: string; isSystemRole?: boolean } | undefined;
  if (role?.isSystemRole && role.roleName === "Super Admin") return true;
  sendError(res, "Backups are restricted to Super Admins", 403);
  return false;
}

export const listBackups = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    sendSuccess(res, "Backups", await service.list());
  } catch (error) { next(error); }
};

export const getBackup = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    sendSuccess(res, "Backup", await service.getById(req.params.id));
  } catch (error) { next(error); }
};

export const createBackup = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    sendSuccess(res, "Backup complete", await service.run("manual", req.user!.userId), 201);
  } catch (error) { next(error); }
};

/** The archive itself. Streamed as a download rather than described. */
export const downloadBackup = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { filename, body } = await service.archive(req.params.id);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(body.length));
    res.end(body);
  } catch (error) { next(error); }
};

/** What restoring one collection would do — reads only, changes nothing. */
export const previewRestore = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const collection = String(req.query.collection ?? "");
    if (!collection) { sendError(res, "Name the collection to preview", 400); return; }
    sendSuccess(res, "Restore preview", await service.preview(req.params.id, collection));
  } catch (error) { next(error); }
};

export const restoreCollection = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { collection, ids } = req.body as { collection?: string; ids?: string[] };
    if (!collection) { sendError(res, "Name the collection to restore", 400); return; }
    const out = await service.restore(req.params.id, collection, Array.isArray(ids) ? ids : undefined);
    sendSuccess(res, `${out.restored} document(s) restored — ${out.replaced} replaced, ${out.inserted} put back`, out);
  } catch (error) { next(error); }
};
