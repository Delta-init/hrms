/**
 * Send one WhatsApp message by hand, to check the connection.
 *
 *   bun src/seeds/sendWhatsAppTest.ts --to 971501234567                     # dry run: shows what it would send
 *   bun src/seeds/sendWhatsAppTest.ts --to 971501234567 --text --send       # plain text
 *   bun src/seeds/sendWhatsAppTest.ts --to 971501234567 --template --send   # the general notification template
 *
 * --text only arrives if that number messaged the business number within the
 * last 24 hours — message it "hi" first. --template needs the template
 * (WHATSAPP_TEMPLATE_NAME, default hrms_notification) approved in Creatyvot.
 * Nothing is sent without --send.
 */
import "dotenv/config";
import { env } from "../config/env.js";
import { normalizeWhatsAppNumber, sendWhatsAppText, sendWhatsAppTemplate } from "../services/whatsappService.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const raw = arg("--to");
  const useTemplate = process.argv.includes("--template");
  const send = process.argv.includes("--send");

  const to = normalizeWhatsAppNumber(raw ? (raw.startsWith("+") ? raw : `+${raw}`) : null);
  if (!to) {
    console.log("Give the number with its country code: --to 971501234567 (or --to +971501234567)");
    process.exit(1);
  }

  const text = useTemplate
    ? "Test from Delta HRMS — WhatsApp notifications are connected."
    : "Test from Delta HRMS — the WhatsApp connection works. ✅";

  console.log(`To:       ${to}`);
  console.log(`As:       ${useTemplate ? `template "${env.WHATSAPP_TEMPLATE_NAME}" (${env.WHATSAPP_TEMPLATE_LANG})` : "plain text (needs an open 24-hour window)"}`);
  console.log(`Message:  ${text}`);

  if (!send) {
    console.log("\nDry run — add --send to actually send it.");
    return;
  }

  const result = useTemplate ? await sendWhatsAppTemplate(to, text) : await sendWhatsAppText(to, text);
  if (result.ok) console.log("\n✓ Accepted by WhatsApp — check the phone.");
  else {
    console.log(`\n✗ Not sent: ${result.error}`);
    if (/131047/.test(result.error ?? "")) console.log("  The 24-hour window is closed — message the business number first, then retry.");
    if (/132001/.test(result.error ?? "")) console.log("  The template doesn't exist or isn't approved yet — check its name and status in Creatyvot.");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
