import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env.js";
import { signedFileUrl } from "../utils/fileUrl.js";

/**
 * Cloudflare R2 is S3-compatible, so we talk to it with the AWS S3 SDK pointed
 * at the account-specific R2 endpoint. Storage is optional: when the R2 env
 * vars are unset, `r2` is null and the upload service refuses uploads with a
 * clear error instead of crashing at boot.
 */
export const r2Enabled = Boolean(
  env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME
);

export const R2_BUCKET = env.R2_BUCKET_NAME ?? "";

/** No longer used for serving — see publicUrl(). Kept so an existing .env
 *  does not fail validation, and as the place to look when the bucket is locked. */
export const R2_PUBLIC_URL = (env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");

export const r2: S3Client | null = r2Enabled
  ? new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

/**
 * Serving URL for a stored object key.
 *
 * Lives here rather than in the upload service so models can serve a key
 * without depending on the S3 client — and, as that always intended, this is
 * the one place that changed when object access moved behind signed URLs.
 *
 * It used to return `${R2_PUBLIC_URL}/${key}`, which is a bucket hostname with
 * no access control: the link to somebody's passport scan worked for anyone who
 * ever saw it, signed in or not, and never expired. Links are now signed and
 * short-lived, and served by this API. See utils/fileUrl.ts.
 *
 * `R2_PUBLIC_URL` is no longer read. The bucket must be made private — while it
 * still answers on a public hostname the old URLs keep working regardless.
 */
export function publicUrl(key: string): string {
  return key ? signedFileUrl(key) : "";
}
