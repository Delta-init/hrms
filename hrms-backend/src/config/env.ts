import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("5000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
  SUPER_ADMIN_NAME: z.string().default("Super Admin"),
  // No defaults: a deployment that forgets to set these must fail to boot rather
  // than silently ship a well-known super-admin login.
  SUPER_ADMIN_EMAIL: z.string().email("SUPER_ADMIN_EMAIL is required"),
  SUPER_ADMIN_PASSWORD: z.string().min(1, "SUPER_ADMIN_PASSWORD is required"),
  CLIENT_URL: z.string().default("http://localhost:3000"),

  // SMTP (optional) — when unset, email sending is a logged no-op.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().optional(), // "true" | "false"
  MAIL_FROM: z.string().optional(),   // e.g. "HRMS <no-reply@company.com>"
  // Cron expression for the daily birthday check (server local time).
  BIRTHDAY_CRON: z.string().default("0 8 * * *"),

  // Cloudflare R2 (S3-compatible) object storage for employee documents/photos.
  // When unset, document upload is disabled (routes return a clear error).
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(), // e.g. https://pub-xxxx.r2.dev or a custom domain
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
