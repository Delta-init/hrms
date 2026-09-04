import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { CompOffCredit } from "../models/CompOffCredit.js";
import { CompOffService } from "../services/compOffService.js";
import { runWithOrg } from "../utils/orgContext.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";

/**
 * A day back, credited the same run it was earned rather than left for HR to
 * notice and grant by hand.
 *
 * `CompOffService.suggestions()` already does the finding — anyone who
 * worked a holiday or weekend with no credit yet for that day. This is only
 * the other half: turning each one straight into a credit and telling the
 * person it happened. Idempotent by construction, since a day already
 * credited drops out of `suggestions()` on its own — a missed run or a
 * re-run both catch up safely rather than crediting twice.
 *
 * Half a day under four hours worked, a full day at four or more — the
 * organisation's own call, made once here rather than left to whoever
 * happens to be granting it that week.
 */
const FULL_DAY_AFTER_MINUTES = 240;

const service = new CompOffService();

/** runWithOrg is void-returning by design (built for Express's synchronous
 *  next()) — bridge it so a multi-org loop can await org-scoped work. */
function withOrg<T>(store: Parameters<typeof runWithOrg>[0], fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg(store, () => { fn().then(resolve, reject); });
  });
}

/**
 * One organisation's share of the work.
 *
 * Exported on its own so this can be pointed at a single, known org and
 * checked — the only safe way to verify the credit amount and the mail
 * without either mailing real staff or running the loop below, which is
 * deliberately org-context-free and has no way to limit itself to one.
 */
export async function creditSuggestionsFor(orgId: string): Promise<{ credited: number; emails: number }> {
  const suggestions = await withOrg({ orgId, isSuperAdmin: false }, () => service.suggestions());
  let credited = 0, emails = 0;

  for (const s of suggestions) {
    const amount = s.workedMinutes >= FULL_DAY_AFTER_MINUTES ? 1 : 0.5;
    const reasonLabel = s.reason === "holiday" ? "a holiday" : "a weekend";

    await CompOffCredit.create({
      organization: orgId,
      employee: s.employee._id,
      user: s.user,
      date: s.date,
      amount,
      reason: `Worked ${reasonLabel} — credited automatically`,
      createdBy: null,
    });
    credited++;

    const user = await User.findById(s.user).select("name email").lean<{ name?: string; email?: string } | null>();
    if (!user?.email) continue;
    const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(s.date));
    const has = amount === 1 ? "has" : "have";
    const ok = await sendMail({
      to: user.email,
      organization: orgId,
      subject: `You've been credited ${amount} comp-off day${amount === 1 ? "" : "s"}`,
      text: `You worked ${reasonLabel} on ${day}, so ${amount} comp-off day${amount === 1 ? "" : "s"} ${has} been added to your balance.\n\nView it: ${env.CLIENT_URL}/leave`,
      html:
        `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto">` +
        `<h2 style="color:#4f46e5;margin-bottom:4px">A day back</h2>` +
        `<p style="color:#555">You worked ${reasonLabel} on <strong>${day}</strong>, so <strong>${amount} comp-off day${amount === 1 ? "" : "s"}</strong> ${has} been added to your balance.</p>` +
        `<p><a href="${env.CLIENT_URL}/leave" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">View my balance</a></p>` +
        `</div>`,
    });
    if (ok) emails++;
  }

  return { credited, emails };
}

export async function runCompOffAutoCredit(): Promise<{ credited: number; emails: number }> {
  const orgs = await Organization.find({ status: "active" }).select("_id").lean();
  let credited = 0, emails = 0;

  for (const org of orgs) {
    const result = await creditSuggestionsFor(String(org._id));
    credited += result.credited;
    emails += result.emails;
  }

  if (!credited) console.log("🗓️  comp-off auto-credit: nothing to credit.");
  else console.log(`🗓️  comp-off auto-credit: ${credited} credit(s), ${emails} email(s).`);
  return { credited, emails };
}

export function startCompOffAutoCreditCron() {
  const expr = cronSetting("COMP_OFF_AUTO_CREDIT_CRON", env.COMP_OFF_AUTO_CREDIT_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runCompOffAutoCredit().catch((e) => console.error("🗓️  comp-off auto-credit failed:", e));
  });
  console.log(`🗓️  comp-off auto-credit cron scheduled: "${expr}"`);
}
