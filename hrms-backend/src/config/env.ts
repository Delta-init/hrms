import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("5000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /**
   * How many proxies sit in front of this server, or a comma-separated list of
   * their addresses. Unset means none — see index.ts for why that is the safe
   * default and why attendance needs this set correctly in production.
   */
  TRUST_PROXY: z.string().optional(),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  // 32 chars minimum: these are HMAC keys, and a guessable one lets an attacker
  // mint their own access tokens and impersonation tickets outright.
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
  // Signs impersonation tickets. Optional for backward compatibility; when
  // unset it derives from JWT_SECRET, which is why that now has a real floor.
  // Empty is treated as unset so a blank line in .env doesn't fail the length
  // check on an optional value.
  JWT_TICKET_SECRET: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(32, "JWT_TICKET_SECRET must be at least 32 characters").optional()
  ),
  SUPER_ADMIN_NAME: z.string().default("Super Admin"),
  // No defaults: a deployment that forgets to set these must fail to boot rather
  // than silently ship a well-known super-admin login.
  SUPER_ADMIN_EMAIL: z.string().email("SUPER_ADMIN_EMAIL is required"),
  SUPER_ADMIN_PASSWORD: z.string().min(1, "SUPER_ADMIN_PASSWORD is required"),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  /**
   * This API's own public origin, used to build the signed file links a browser
   * loads directly. Must be set in production: the default is only right when
   * the API is reached at localhost, and a wrong value here means every photo
   * and document link points somewhere unreachable.
   */
  SERVER_URL: z.string().optional(),

  // SMTP (optional) — when unset, email sending is a logged no-op.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().optional(), // "true" | "false"
  MAIL_FROM: z.string().optional(),   // e.g. "HRMS <no-reply@company.com>"
  // Cron expression for the daily birthday check (server local time).
  BIRTHDAY_CRON: z.string().default("0 8 * * *"),
  // Daily "what is still waiting for a decision" digest to Super Admins.
  // An hour after the birthday mail, so the two don't arrive together.
  APPROVAL_DIGEST_CRON: z.string().default("0 9 * * *"),

  // Cloudflare R2 (S3-compatible) object storage for employee documents/photos.
  // When unset, document upload is disabled (routes return a clear error).
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(), // e.g. https://pub-xxxx.r2.dev or a custom domain

  // Face recognition service (hrms-face-ditector). When unset, face enrollment
  // and face attendance are disabled and their routes return a clear error —
  // the rest of the API is unaffected.
  FACE_SERVICE_URL: z.string().optional(), // e.g. http://127.0.0.1:8000
  FACE_SERVICE_KEY: z.string().optional(), // must match the service's FACE_SERVICE_KEY
  // How long to wait on the face service. Recognition is CPU inference, so this
  // is seconds rather than the milliseconds a normal internal call would take.
  FACE_SERVICE_TIMEOUT_MS: z.string().default("15000"),
  // Captures required per employee. More angles make matching more forgiving of
  // how someone happens to stand at the kiosk.
  FACE_ENROLL_MIN_CAPTURES: z.string().default("3"),
  FACE_ENROLL_MAX_CAPTURES: z.string().default("5"),
  // Ignore a second recognition of the same person within this window, so
  // lingering in front of the camera doesn't immediately undo the punch.
  FACE_PUNCH_COOLDOWN_SECONDS: z.string().default("60"),
  // How long the frame a punch was made from is kept for dispute resolution.
  FACE_PROOF_RETENTION_DAYS: z.string().default("30"),
  FACE_PROOF_PURGE_CRON: z.string().default("30 3 * * *"),
  // Liveness. "required" makes every kiosk punch prove somebody is actually
  // standing there; "off" is an explicit opt-out for a supervised device and
  // means a printed photo will punch someone in.
  FACE_LIVENESS_MODE: z.enum(["required", "off"]).default("required"),
  // How long somebody has to follow the prompts before the challenge lapses.
  FACE_LIVENESS_TTL_SECONDS: z.string().default("30"),
  // How far below the match threshold still counts as "too alike to enrol".
  // Two faces this close cannot be told apart at the kiosk, so enrolling the
  // second would break both.
  FACE_DUPLICATE_MARGIN: z.string().default("0.1"),

  // ── Delta Finance integration ────────────────────────────────────────────
  // Shared-secret credentials the finance server signs its requests with. Both
  // unset means the integration API is disabled and returns 503 — an
  // unconfigured deployment must not serve the employee directory to anyone
  // who finds the route. The secret has the same 32-char floor as the JWT keys
  // because it guards the same thing: the ability to speak as a trusted party.
  INTEGRATION_CLIENT_ID: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional()
  ),
  INTEGRATION_SECRET: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(32, "INTEGRATION_SECRET must be at least 32 characters").optional()
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
