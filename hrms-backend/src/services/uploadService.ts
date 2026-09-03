import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { r2, r2Enabled, R2_BUCKET, publicUrl } from "../config/r2.js";

export { publicUrl };

export class UploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function ensureEnabled() {
  if (!r2Enabled || !r2) {
    throw new UploadError(
      "File storage is not configured. Set R2_* environment variables.",
      503
    );
  }
}

/**
 * Store a buffer in R2 under the given key. Returns the key (persist this) —
 * callers build the public URL via publicUrl() when serving.
 */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  ensureEnabled();
  await r2!.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

/**
 * Read an object back into memory, or null when it is not there.
 *
 * Null rather than a throw for a missing key: an archive that has been pruned
 * or removed from the bucket is an ordinary answer the caller has to handle,
 * not an exception. Only for things known to be small — a backup archive is a
 * megabyte or so; this would be the wrong way to serve a video.
 */
export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  ensureEnabled();
  try {
    const res = await r2!.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

/** Delete an object by key. Never throws for a missing object. */
export async function deleteObject(key: string): Promise<void> {
  if (!r2Enabled || !r2 || !key) return;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch {
    // best-effort cleanup — a missing object is not an error
  }
}

/** Build the storage key for an employee document, namespaced per org. */
export function documentKey(
  orgId: string | null,
  employeeId: string,
  docType: string,
  ext: string,
  stamp: number
): string {
  const org = orgId || "global";
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${org}/${employeeId}/${docType}-${stamp}.${safeExt}`;
}

/** Build the storage key for a standalone attachment (e.g. an expense receipt), namespaced per org + uploader. */
export function attachmentKey(
  orgId: string | null,
  userId: string,
  folder: string,
  ext: string,
  stamp: number
): string {
  const org = orgId || "global";
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${org}/${folder}/${userId}/${stamp}.${safeExt}`;
}
