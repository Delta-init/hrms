import cron from "node-cron";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";
import { sendMail } from "../utils/mailer.js";
import { birthdaysOn } from "../services/dashboardService.js";

/** Email addresses of all active HR Manager users. */
async function hrRecipients(): Promise<string[]> {
  const role = await Role.findOne({ roleName: "HR Manager" }).select("_id");
  if (!role) return [];
  const users = await User.find({ role: role._id, status: { $ne: "inactive" } }).select("email").lean();
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

/** Find today's birthdays and email HR. Safe to call manually (returns a summary). */
export async function runBirthdayCheck(now = new Date()) {
  const birthdays = await birthdaysOn(now);
  if (birthdays.length === 0) {
    console.log("🎂 birthday check: none today.");
    return { birthdays: 0, emailed: false, recipients: 0 };
  }
  const recipients = await hrRecipients();
  const dateLabel = now.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  const emailed = await sendMail({
    to: recipients,
    subject: `🎂 ${birthdays.length} birthday${birthdays.length === 1 ? "" : "s"} today — ${dateLabel}`,
    html: buildHtml(birthdays, dateLabel),
    text: `Today's birthdays: ${birthdays.map((b) => b.name).join(", ")}`,
  });
  return { birthdays: birthdays.length, emailed, recipients: recipients.length };
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
