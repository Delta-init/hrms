import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2, r2Enabled, R2_BUCKET, R2_PUBLIC_URL } from "../config/r2.js";

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

/** Public URL for a stored object key. */
export function publicUrl(key: string): string {
  return R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
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
