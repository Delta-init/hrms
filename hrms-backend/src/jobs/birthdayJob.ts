import cron from "node-cron";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";
import { env } from "../config/env.js";
import { sendMail } from "../utils/mailer.js";
import { birthdaysOn } from "../services/dashboardService.js";

/**
 * Active HR Manager addresses **within one organization**.
 *
 * Scoped deliberately: this job runs outside a request, so there is no ambient
 * org context to inherit. Without the filter it emailed every tenant's employee
 * names, codes and departments to every tenant's HR — a cross-tenant leak that
 * left the system over email.
 */
async function hrRecipients(orgId: string): Promise<string[]> {
  const role = await Role.findOne({ roleName: "HR Manager", organization: null }).select("_id");
  if (!role) return [];
  const users = await User.find({ role: role._id, organization: orgId, status: { $ne: "inactive" } })
    .select("email")
    .lean();
  return users.map((u) => u.email).filter(Boolean);
}

function buildHtml(birthdays: Array<{ name: string; employeeCode?: string; department?: string | null; designation?: string }>, dateLabel: string) {
  const rows = birthdays
    .map((b) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600">${b.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666">${b.employeeCode ?? ""}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666">${b.department ?? "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666">${b.designation ?? ""}</td>
    </tr>`)
    .join("");
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#4f46e5">🎂 Today's Birthdays</h2>
    <p style="color:#555">The following team member${birthdays.length === 1 ? " has" : "s have"} a birthday on ${dateLabel}:</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase">
        <th style="padding:8px 12px">Name</th><th style="padding:8px 12px">Code</th><th style="padding:8px 12px">Department</th><th style="padding:8px 12px">Designation</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p>
  </div>`;
}

/**
 * Find today's birthdays and email HR — one email per organization, containing
 * only that organization's people. Safe to call manually (returns a summary).
 */
export async function runBirthdayCheck(now = new Date()) {
  const orgs = await Organization.find({ status: "active" }).select("_id name").lean();
  const dateLabel = now.toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  let totalBirthdays = 0;
  let emailsSent = 0;
  let totalRecipients = 0;

  for (const org of orgs) {
    const orgId = String(org._id);
    const birthdays = await birthdaysOn(now, orgId);
    if (birthdays.length === 0) continue;
    totalBirthdays += birthdays.length;

    const recipients = await hrRecipients(orgId);
    if (recipients.length === 0) {
      console.log(`🎂 ${org.name}: ${birthdays.length} birthday(s) but no HR recipients — skipped.`);
      continue;
    }
    totalRecipients += recipients.length;

    const emailed = await sendMail({
      // A cron run has no request scope, so the tenant is named explicitly —
      // each organization's mail goes out through its own SMTP.
      organization: org._id,
      to: recipients,
      subject: `🎂 ${birthdays.length} birthday${birthdays.length === 1 ? "" : "s"} today — ${dateLabel}`,
      html: buildHtml(birthdays, dateLabel),
      text: `Today's birthdays: ${birthdays.map((b) => b.name).join(", ")}`,
    });
    if (emailed) emailsSent += 1;
  }

  if (totalBirthdays === 0) console.log("🎂 birthday check: none today.");
  return { birthdays: totalBirthdays, emailed: emailsSent > 0, emails: emailsSent, recipients: totalRecipients };
}

/** Schedule the daily birthday check (server local time). */
export function startBirthdayCron() {
  const expr = env.BIRTHDAY_CRON;
  if (!cron.validate(expr)) {
    console.error(`🎂 invalid BIRTHDAY_CRON "${expr}" — birthday emails disabled.`);
    return;
  }
  cron.schedule(expr, () => {
    runBirthdayCheck().catch((e) => console.error("🎂 birthday job failed:", e));
  });
  console.log(`🎂 birthday cron scheduled: "${expr}"`);
}
