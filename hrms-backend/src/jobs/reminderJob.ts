import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { Reminder } from "../models/Reminder.js";
import { stageThresholds, recipientsFor } from "../services/reminderService.js";
import { notify } from "../services/notificationService.js";
import { sendMail } from "../utils/mailer.js";
import { runWithOrg } from "../utils/orgContext.js";
import { env } from "../config/env.js";
import type { IReminder, ReminderStage } from "../types/index.js";

/**
 * Polled every few minutes rather than fired at a fixed instant, the same
 * reasoning as the punch reminder: a reminder's own moment is different for
 * every reminder, so the job has to keep checking rather than run once at a
 * time that only ever suits one of them.
 *
 * A stage found due but well past its moment is marked fired without being
 * sent — a "starting in 30 minutes" notice delivered two hours late helps
 * nobody, and would only read as broken. `firedStages` is the per-reminder
 * ledger that keeps a five-minute poll from repeating a stage it already sent.
 */
const CATCH_UP_MS: Record<ReminderStage, number> = {
  "30min": 20 * 60_000,
  "5min": 20 * 60_000,
  ontime: 20 * 60_000,
  dayBefore: 12 * 60 * 60_000,
};

const STAGE_COPY: Record<ReminderStage, { emoji: string; lead: string }> = {
  "30min": { emoji: "⏰", lead: "starting in 30 minutes" },
  "5min": { emoji: "⏰", lead: "starting in 5 minutes" },
  ontime: { emoji: "🔔", lead: "starting now" },
  dayBefore: { emoji: "📅", lead: "coming up tomorrow" },
};

function messageFor(reminder: IReminder, stage: ReminderStage) {
  const { emoji, lead } = STAGE_COPY[stage];
  const timeSuffix = reminder.time && stage !== "dayBefore" ? ` at ${reminder.time}` : "";
  const lede = `${lead}${timeSuffix}`;
  const title = `${emoji} ${reminder.title} — ${lead}`;
  const extra = reminder.message ? ` ${reminder.message}` : "";

  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
    `<h2 style="color:#4f46e5;margin-bottom:4px">${emoji} ${reminder.title}</h2>` +
    `<p style="color:#555">${lede}.${extra}</p>` +
    `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p>` +
    `</div>`;
  const text = `${reminder.title}\n\n${lede}.${extra}\n`;
  return { title, body: reminder.message ?? "", subject: title, html, text };
}

/** runWithOrg is void-returning by design (built for Express's synchronous
 *  next()) — bridge it so a multi-org loop can await org-scoped work. */
function withOrg<T>(store: Parameters<typeof runWithOrg>[0], fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg(store, () => { fn().then(resolve, reject); });
  });
}

/**
 * One organisation's due reminder stages.
 *
 * Exported on its own so this can be pointed at a single, known org and
 * checked — the only safe way to verify firing/catch-up behaviour without
 * either mailing real staff or running the loop below, which is deliberately
 * org-context-free and has no way to limit itself to one.
 */
export async function processRemindersFor(orgId: string, now = new Date()): Promise<{ fired: number; emails: number }> {
  const reminders = await withOrg({ orgId, isSuperAdmin: false }, () =>
    Reminder.find({ organization: orgId, status: "scheduled" })
  );
  let fired = 0, emails = 0;

  for (const reminder of reminders) {
    const thresholds = stageThresholds(reminder);
    const stages = Object.keys(thresholds) as ReminderStage[];
    let changed = false;

    for (const stage of stages) {
      if (reminder.firedStages.includes(stage)) continue;
      const threshold = thresholds[stage]!;
      if (now.getTime() < threshold.getTime()) continue;

      const staleMs = now.getTime() - threshold.getTime();
      if (staleMs <= CATCH_UP_MS[stage]) {
        const recipients = await withOrg({ orgId, isSuperAdmin: false }, () => recipientsFor(reminder));
        if (recipients.length) {
          const { title, body, subject, html, text } = messageFor(reminder, stage);
          await notify({ users: recipients, kind: "reminder", title, body, href: "/reminders", organization: orgId });
          const users = await User.find({ _id: { $in: recipients } }).select("email").lean<Array<{ email?: string }>>();
          for (const u of users) {
            if (!u.email) continue;
            const ok = await sendMail({ to: u.email, organization: orgId, subject, html, text });
            if (ok) emails++;
          }
        }
        fired++;
      }
      reminder.firedStages.push(stage);
      changed = true;
    }

    if (stages.length > 0 && stages.every((s) => reminder.firedStages.includes(s))) {
      reminder.status = "sent";
      changed = true;
    }
    if (changed) await reminder.save();
  }

  return { fired, emails };
}

export async function runReminderJob(now = new Date()): Promise<{ fired: number; emails: number }> {
  const orgs = await Organization.find({ status: "active" }).select("_id").lean();
  let fired = 0, emails = 0;

  for (const org of orgs) {
    const result = await processRemindersFor(String(org._id), now);
    fired += result.fired;
    emails += result.emails;
  }

  if (!fired) console.log("⏰ reminders: nothing due.");
  else console.log(`⏰ reminders: ${fired} stage(s) fired, ${emails} email(s).`);
  return { fired, emails };
}

export function startReminderCron() {
  const expr = cronSetting("REMINDER_CRON", env.REMINDER_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runReminderJob().catch((e) => console.error("⏰ reminder job failed:", e));
  });
  console.log(`⏰ reminder cron scheduled: "${expr}"`);
}
