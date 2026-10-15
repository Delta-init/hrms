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
  /**
   * Files to send along. Used for calendar invites: an `.ics` part is what puts
   * an interview into Outlook or Google without integrating with either.
   */
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
}

/**
 * Send an email. With no SMTP configured this is a no-op that logs the intended
 * recipients, so every caller is safe to run before credentials exist.
 */
export async function sendMail({ to, subject, html, text, organization, attachments }: MailInput): Promise<boolean> {
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
    console.log(`✉️  [dry-run] would email ${recipients.join(", ")} — "${subject}"${attachments?.length ? ` (+${attachments.length} attachment)` : ""}`);
    return false;
  }

  try {
    await transportFor(cfg).sendMail({ from: cfg.from, to: recipients.join(", "), subject, html, text, attachments });
    console.log(`✉️  sent "${subject}" to ${recipients.length} recipient(s)`);
    return true;
  } catch (err) {
    console.error(`✉️  failed to send "${subject}":`, err instanceof Error ? err.message : err);
    return false;
  }
}

export interface DetailedMailInput extends MailInput {
  /** Where replies go — a plus-address on the mailbox the inbox reader watches. */
  replyTo?: string;
  /** Our own Message-ID, so a reply's In-Reply-To can be matched back to it. */
  messageId?: string;
}

/**
 * Send one email and say what happened, rather than the bare yes/no above.
 *
 * For mail somebody is waiting on — an offer is sent from a button, and the
 * person who pressed it has to know it did not go. With no SMTP configured this
 * sends nothing and says so; it never pretends.
 */
export async function sendMailDetailed(input: DetailedMailInput): Promise<{ sent: boolean; reason?: string; from?: string; messageId?: string }> {
  const recipients = Array.isArray(input.to) ? input.to.filter(Boolean) : [input.to].filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: "There is no address to send to" };
  let scopedOrg: unknown = input.organization;
  if (scopedOrg === undefined) {
    try { scopedOrg = getOrgId(); } catch { scopedOrg = null; }
  }
  const cfg = (await orgConfig(scopedOrg)) ?? envConfig();
  if (!cfg) return { sent: false, reason: "Email isn't set up for this organisation — add SMTP in Settings" };
  try {
    const info = await transportFor(cfg).sendMail({
      from: cfg.from, to: recipients.join(", "), subject: input.subject, html: input.html, text: input.text,
      attachments: input.attachments, replyTo: input.replyTo, messageId: input.messageId,
    });
    console.log(`✉️  sent "${input.subject}" to ${recipients.length} recipient(s)`);
    return { sent: true, from: cfg.from, messageId: info.messageId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`✉️  failed to send "${input.subject}":`, reason);
    return { sent: false, reason: `The email could not be sent: ${reason}` };
  }
}

/** The SMTP mailbox's own address — where a plus-addressed reply lands. */
export async function mailboxAddress(orgId: unknown): Promise<string | null> {
  const cfg = (await orgConfig(orgId)) ?? envConfig();
  return cfg?.user && cfg.user.includes("@") ? cfg.user : null;
}

/**
 * Reading the same mailbox the organisation sends from: the SMTP login, with
 * the IMAP host beside the SMTP one (smtp.gmail.com → imap.gmail.com). Null
 * when there is no SMTP to start from.
 */
export async function imapConfig(orgId: unknown): Promise<{ host: string; port: number; user: string; pass: string } | null> {
  const cfg = (await orgConfig(orgId)) ?? envConfig();
  if (!cfg) return null;
  const host = cfg.host.replace(/^smtp\./i, "imap.");
  return { host, port: 993, user: cfg.user, pass: cfg.pass };
}
