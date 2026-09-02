import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { Employee } from "../models/Employee.js";
import { Organization } from "../models/Organization.js";
import { env } from "../config/env.js";
import { sendMail } from "../utils/mailer.js";
import { hrRecipients } from "./birthdayJob.js";

/**
 * What is still waiting on HR, at midday.
 *
 * A leave request sits until somebody opens the page, and nobody opens a page
 * to find out whether there is anything on it. The badge in the sidebar answers
 * that for whoever is already in the app; this answers it for whoever is not.
 *
 * Midday rather than morning on purpose. A request raised overnight is in the
 * queue by then, and somebody told at noon still has an afternoon to answer it
 * — which is the whole point of telling them.
 *
 * Nothing waiting means nothing sent, like every other digest here: a daily
 * "0 pending" is the fastest way to teach somebody to delete the one that says
 * eleven.
 */

const DAY_MS = 86_400_000;
/** Past this, a request is not waiting — it has been forgotten. */
const STALE_DAYS = 3;

interface Waiting {
  name: string;
  code: string;
  type: string;
  days: number;
  from: Date;
  raisedAt: Date;
  /** Which queue it is in — both are answered by the same people. */
  queue: "leave" | "correction";
}

async function waitingFor(orgId: unknown): Promise<Waiting[]> {
  const rows = await LeaveRequest.find({ organization: orgId, status: "pending" })
    .select("user type days startDate createdAt")
    .sort({ createdAt: 1 })
    .lean();
  if (!rows.length) return [];

  // One lookup for the names rather than one per row: a queue of forty would
  // otherwise be forty round trips to say forty names.
  const employees = await Employee.find({ organization: orgId, user: { $in: rows.map((r) => r.user) } })
    .select("name employeeCode user")
    .lean();
  const byUser = new Map(employees.map((e) => [String(e.user), e]));

  return rows.map((r) => {
    const e = byUser.get(String(r.user));
    return {
      name: String(e?.name ?? "Unknown"),
      code: String(e?.employeeCode ?? ""),
      type: String(r.type ?? ""),
      days: Number(r.days ?? 0),
      from: new Date(r.startDate),
      raisedAt: new Date(r.createdAt),
      queue: "leave",
    };
  });
}

/**
 * Attendance corrections, in the same mail rather than one of their own.
 *
 * Both queues are answered by the same people from the same chair, and two
 * mails at noon is one more than anybody reads. They are listed together and
 * marked, so the shape of the afternoon is visible in one glance.
 */
async function correctionsFor(orgId: unknown): Promise<Waiting[]> {
  const rows = await Regularization.find({ organization: orgId, status: "pending" })
    .select("user type date createdAt")
    .sort({ createdAt: 1 })
    .lean();
  if (!rows.length) return [];

  const employees = await Employee.find({ organization: orgId, user: { $in: rows.map((r) => r.user) } })
    .select("name employeeCode user")
    .lean();
  const byUser = new Map(employees.map((e) => [String(e.user), e]));

  return rows.map((r) => {
    const e = byUser.get(String(r.user));
    return {
      name: String(e?.name ?? "Unknown"),
      code: String(e?.employeeCode ?? ""),
      type: String(r.type ?? ""),
      days: 1,
      from: new Date(r.date),
      raisedAt: new Date(r.createdAt),
      queue: "correction" as const,
    };
  });
}

function buildHtml(rows: Waiting[], now: Date) {
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const stale = rows.filter((r) => now.getTime() - r.raisedAt.getTime() > STALE_DAYS * DAY_MS);
  const body = rows
    .map((r) => {
      const waited = Math.floor((now.getTime() - r.raisedAt.getTime()) / DAY_MS);
      const old = waited >= STALE_DAYS;
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600">${r.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-family:ui-monospace,monospace;font-size:12px">${r.code}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${
          r.queue === "correction"
            ? `<span style="background:#eef2ff;color:#4338ca;border-radius:999px;padding:2px 8px;font-size:11px">Correction</span> `
            : ""
        }<span style="text-transform:capitalize">${r.type.replace(/_/g, " ")}</span></td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666">${r.days} day${r.days === 1 ? "" : "s"} from ${fmt(r.from)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;${old ? "color:#b45309;font-weight:600" : "color:#666"}">${waited === 0 ? "today" : `${waited} day${waited === 1 ? "" : "s"}`}</td>
      </tr>`;
    })
    .join("");
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:640px;margin:auto">
    <h2 style="color:#4f46e5;margin-bottom:4px">${rows.length} request${rows.length === 1 ? "" : "s"} waiting on you</h2>
    <p style="color:#555;margin-top:0">${
      stale.length
        ? `<strong style="color:#b45309">${stale.length} ${stale.length === 1 ? "has" : "have"} been waiting more than ${STALE_DAYS} days.</strong> `
        : ""
    }Oldest first — the part that has actually gone wrong is at the top.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase">
        <th style="padding:8px 12px">Who</th><th style="padding:8px 12px">Code</th>
        <th style="padding:8px 12px">Type</th><th style="padding:8px 12px">When</th>
        <th style="padding:8px 12px">Waiting</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p style="margin-top:18px"><a href="${env.CLIENT_URL}/leave" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open the queue</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS. An empty queue sends no email.</p>
  </div>`;
}

export async function runLeaveQueueDigest(now = new Date()) {
  const orgs = await Organization.find({ status: "active" }).select("_id name").lean();
  let waiting = 0, sent = 0;

  for (const org of orgs) {
    const [leave, corrections] = await Promise.all([waitingFor(org._id), correctionsFor(org._id)]);
    // Oldest first across both, because the reader is asking "what have I left
    // longest", not "what kind of thing is it".
    const rows = [...leave, ...corrections].sort((a, b) => a.raisedAt.getTime() - b.raisedAt.getTime());
    if (!rows.length) continue;
    waiting += rows.length;

    const recipients = await hrRecipients(String(org._id));
    if (!recipients.length) {
      console.log(`🗓️ ${org.name}: ${rows.length} pending but no HR recipients — skipped.`);
      continue;
    }
    const ok = await sendMail({
      organization: org._id,
      to: recipients,
      subject:
        corrections.length && leave.length
          ? `${leave.length} leave request${leave.length === 1 ? "" : "s"} and ${corrections.length} correction${corrections.length === 1 ? "" : "s"} waiting`
          : corrections.length
            ? `${corrections.length} attendance correction${corrections.length === 1 ? "" : "s"} waiting`
            : `${leave.length} leave request${leave.length === 1 ? "" : "s"} waiting on you`,
      html: buildHtml(rows, now),
      text: rows
        .map((r) => `${r.code} ${r.name} — ${r.queue === "correction" ? "correction: " : ""}${r.days} day(s) ${r.type}, raised ${Math.floor((now.getTime() - r.raisedAt.getTime()) / DAY_MS)} day(s) ago`)
        .join("\n"),
    });
    if (ok) sent++;
  }

  if (!waiting) console.log("🗓️ leave queue: nothing pending.");
  else console.log(`🗓️ leave queue: ${waiting} pending, ${sent} email(s).`);
  return { waiting, emails: sent };
}

export function startLeaveQueueCron() {
  const expr = cronSetting("LEAVE_QUEUE_CRON", env.LEAVE_QUEUE_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runLeaveQueueDigest().catch((e) => console.error("🗓️ leave queue digest failed:", e));
  });
  console.log(`🗓️ leave queue cron scheduled: "${expr}"`);
}
