import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { Organization } from "../models/Organization.js";
import { getOrgId } from "./orgContext.js";

/**
 * Outgoing mail.
 *
 * Credentials come from the organization's own settings where it has them, and
 * from the environment otherwise. The settings screen has always written
 * smtpHost/User/Pass, but nothing read them — so filling that form in appeared
 * to configure email and changed nothing.
 */

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** Transports are pooled per configuration; rebuilding one per email is wasteful. */
const transports = new Map<string, Transporter>();
let warnedNoConfig = false;

function envConfig(): SmtpConfig | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ? parseInt(env.SMTP_PORT, 10) : 587,
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM || env.SMTP_USER,
  };
}

/** The organization's own SMTP, if it has a usable set. */
async function orgConfig(orgId: unknown): Promise<SmtpConfig | null> {
  if (!orgId) return null;
  const org = await Organization.findById(orgId).select("settings").lean<{
    settings?: { smtpHost?: string; smtpPort?: string; smtpUser?: string; smtpPass?: string; smtpSecure?: boolean; mailFrom?: string };
  } | null>();
  const s = org?.settings;
  if (!s?.smtpHost || !s.smtpUser || !s.smtpPass) return null;
  return {
    host: s.smtpHost,
    port: s.smtpPort ? parseInt(s.smtpPort, 10) : 587,
    secure: s.smtpSecure === true,
    user: s.smtpUser,
    pass: s.smtpPass,
    from: s.mailFrom || s.smtpUser,
  };
}

function transportFor(cfg: SmtpConfig): Transporter {
  const key = `${cfg.host}:${cfg.port}:${cfg.secure}:${cfg.user}`;
  let t = transports.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    transports.set(key, t);
  }
  return t;
}

export interface MailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /**
   * Whose SMTP to send through. Defaults to the organization in scope, which
   * covers anything sent while handling a request; background jobs that walk
   * several tenants pass it explicitly.
   */
  organization?: unknown;
}

/**
 * Send an email. With no SMTP configured this is a no-op that logs the intended
 * recipients, so every caller is safe to run before credentials exist.
 */
export async function sendMail({ to, subject, html, text, organization }: MailInput): Promise<boolean> {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (recipients.length === 0) return false;

  // getOrgId() throws outside a request context, which a cron job is.
  let scopedOrg: unknown = organization;
  if (scopedOrg === undefined) {
    try { scopedOrg = getOrgId(); } catch { scopedOrg = null; }
  }

  const cfg = (await orgConfig(scopedOrg)) ?? envConfig();
  if (!cfg) {
    if (!warnedNoConfig) {
      warnedNoConfig = true;
      console.warn("✉️  No SMTP configured — emails are logged, not sent. Set it per organization in Settings, or SMTP_HOST/USER/PASS in the environment.");
    }
    console.log(`✉️  [dry-run] would email ${recipients.join(", ")} — "${subject}"`);
    return false;
  }

  try {
    await transportFor(cfg).sendMail({ from: cfg.from, to: recipients.join(", "), subject, html, text });
    console.log(`✉️  sent "${subject}" to ${recipients.length} recipient(s)`);
    return true;
  } catch (err) {
    console.error(`✉️  failed to send "${subject}":`, err instanceof Error ? err.message : err);
    return false;
  }
}
