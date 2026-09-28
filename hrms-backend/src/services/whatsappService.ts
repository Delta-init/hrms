import { Employee } from "../models/Employee.js";
import { scoped } from "../utils/orgContext.js";
import { env } from "../config/env.js";

/**
 * WhatsApp, through Creatyvot's Meta Cloud API proxy.
 *
 * A business may only open a WhatsApp conversation with a Meta-approved
 * template — free text is refused unless the recipient messaged the business
 * number within the last 24 hours, which nobody does before an office keeping
 * request arrives. So every notification goes through one general Utility
 * template, whose single {{1}} carries the text.
 *
 * With the env vars unset this is a logged no-op, the same shape `sendMail`
 * and `sendPushToUser` take, so every caller is safe to run before WhatsApp
 * is configured. Nothing here ever throws: a notification is a courtesy on
 * top of something that has already happened, and must never undo it.
 */

const GRAPH_VERSION = "v25.0";
const TIMEOUT_MS = 10_000;

const configured = () =>
  !!(env.WHATSAPP_API_BASE_URL && env.WHATSAPP_API_KEY && env.WHATSAPP_PHONE_NUMBER_ID);

/** Last four digits only — a phone number is personal data and has no business in a log. */
const mask = (n: string) => `…${n.slice(-4)}`;

/**
 * A stored phone number as WhatsApp wants it: digits only, country code first.
 *
 * Numbers here are stored every which way — with +971, with +91, and a large
 * share with no country code at all. A number without a code is only
 * completed when its shape leaves no doubt: UAE local numbers (05x… or 5x…)
 * and Indian mobiles (ten digits starting 6–9, a shape no UAE number has).
 * Anything still ambiguous returns null and is skipped, because a message
 * sent to the wrong country's version of a number reaches a stranger.
 */
export function normalizeWhatsAppNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) digits = digits.slice(2);

  // Already carries a code — explicitly, or by its recognisable shape.
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }
  if (digits.startsWith("971") && digits.length === 12) return digits;
  if (digits.startsWith("91") && digits.length === 12) return digits;

  // UAE local formats.
  if (/^05\d{8}$/.test(digits)) return `971${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `971${digits}`;

  // Indian mobiles, with or without the domestic leading zero.
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;

  return null;
}

/**
 * What a template parameter may contain. Meta refuses a parameter with a
 * newline, a tab or more than four spaces in a row (error 132018), and one
 * that is empty — so the text is flattened, capped, and never blank.
 */
function templateSafe(text: string): string {
  const flat = text
    .replace(/[\r\n\t]+/g, " · ")
    .replace(/ {2,}/g, " ")
    .trim();
  const capped = flat.length > 900 ? `${flat.slice(0, 897)}…` : flat;
  return capped || "—";
}

interface SendResult { ok: boolean; error?: string }

async function post(payload: Record<string, unknown>): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${env.WHATSAPP_API_BASE_URL}/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    );
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
    if (!res.ok || body.error) {
      return { ok: false, error: `${body.error?.code ?? res.status}: ${body.error?.message ?? res.statusText}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** The general notification template, to one number. */
export async function sendWhatsAppTemplate(to: string, text: string): Promise<SendResult> {
  if (!configured()) {
    console.log(`📱 [dry-run] WhatsApp not configured — would message ${mask(to)}: "${templateSafe(text)}"`);
    return { ok: false, error: "not configured" };
  }
  const result = await post({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME,
      language: { code: env.WHATSAPP_TEMPLATE_LANG },
      components: [{ type: "body", parameters: [{ type: "text", text: templateSafe(text) }] }],
    },
  });
  if (!result.ok) console.error(`📱 WhatsApp to ${mask(to)} failed — ${result.error}`);
  return result;
}

/**
 * Free text, to one number. Only delivered when the recipient has messaged
 * the business number within the last 24 hours — used for the connection
 * test, never for notifications.
 */
export async function sendWhatsAppText(to: string, text: string): Promise<SendResult> {
  if (!configured()) return { ok: false, error: "not configured" };
  const result = await post({ messaging_product: "whatsapp", to, type: "text", text: { body: text } });
  if (!result.ok) console.error(`📱 WhatsApp text to ${mask(to)} failed — ${result.error}`);
  return result;
}

/**
 * These logins, by the mobile number on their employee record.
 *
 * Somebody with no usable number is skipped and logged rather than failing
 * the rest: one person's missing number must not cost everybody else their
 * message. Two logins sharing a number get it once.
 */
export async function sendWhatsAppToUsers(userIds: string[], text: string): Promise<void> {
  try {
    const ids = [...new Set(userIds.filter(Boolean).map(String))];
    if (!ids.length) return;

    const employees = await Employee.find(scoped({ user: { $in: ids } }))
      .select("name user mobileNumber phone alternatePhone")
      .lean<Array<{ name?: string; mobileNumber?: string; phone?: string; alternatePhone?: string }>>();

    const numbers = new Set<string>();
    for (const e of employees) {
      const n =
        normalizeWhatsAppNumber(e.mobileNumber) ??
        normalizeWhatsAppNumber(e.phone) ??
        normalizeWhatsAppNumber(e.alternatePhone);
      if (n) numbers.add(n);
      else console.warn(`📱 WhatsApp skipped for ${e.name ?? "an employee"} — no usable mobile number with a country code`);
    }

    await Promise.allSettled([...numbers].map((n) => sendWhatsAppTemplate(n, text)));
  } catch (err) {
    console.error("📱 WhatsApp fan-out failed:", err instanceof Error ? err.message : err);
  }
}
