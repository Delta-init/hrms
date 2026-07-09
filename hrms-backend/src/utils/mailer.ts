import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

let transporter: Transporter | null = null;
let ready = false;

/** Lazily build an SMTP transport from env. Returns null if SMTP isn't configured. */
function getTransport(): Transporter | null {
  if (ready) return transporter;
  ready = true;
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    console.warn("✉️  SMTP not configured — emails will be logged, not sent. Set SMTP_HOST/USER/PASS to enable.");
    return null;
  }
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ? parseInt(env.SMTP_PORT, 10) : 587,
    secure: env.SMTP_SECURE === "true",
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export interface MailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send an email. When SMTP isn't configured this is a no-op that logs the
 * intended recipients — so the birthday job is safe to run before creds exist.
 */
export async function sendMail({ to, subject, html, text }: MailInput): Promise<boolean> {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (recipients.length === 0) return false;

  const t = getTransport();
  if (!t) {
    console.log(`✉️  [dry-run] would email ${recipients.join(", ")} — "${subject}"`);
    return false;
  }
  try {
    await t.sendMail({
      from: env.MAIL_FROM || env.SMTP_USER,
      to: recipients.join(", "),
      subject,
      html,
      text,
    });
    console.log(`✉️  sent "${subject}" to ${recipients.length} recipient(s)`);
    return true;
  } catch (err) {
    console.error(`✉️  failed to send "${subject}":`, err instanceof Error ? err.message : err);
    return false;
  }
}
