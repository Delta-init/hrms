import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env.js";

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

/** Public base URL for serving objects (r2.dev or a custom domain), no trailing slash. */
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
 * Public URL for a stored object key.
 *
 * Lives here rather than in the upload service so models can serve a key
 * without depending on the S3 client. When object access moves behind signed
 * URLs, this is the one place that changes.
 */
export function publicUrl(key: string): string {
  return R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
}
