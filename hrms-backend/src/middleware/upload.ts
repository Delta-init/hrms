import multer from "multer";
import type { Request, Response, NextFunction } from "express";

/** Allowed document/photo mime types. */
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (ALLOWED.has(file.mimetype)) return cb(null, true);
  cb(new Error("Unsupported file type. Allowed: JPG, PNG, WEBP, PDF."));
};

/** Single-file upload held in memory (streamed on to R2 by the controller). */
const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
}).single("file");

/** Wraps multer so size/type errors surface as clean 400s, not 500s. */
export const uploadSingle = (req: Request, res: Response, next: NextFunction) => {
  singleUpload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "File is too large (max 10MB)."
          : err.message;
      return next(Object.assign(new Error(msg), { statusCode: 400 }));
    }
    if (err instanceof Error) {
      return next(Object.assign(err, { statusCode: 400 }));
    }
    next();
  });
};

export function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}
