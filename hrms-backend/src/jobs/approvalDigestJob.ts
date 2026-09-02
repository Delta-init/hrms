import cron from "node-cron";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";
import { sendMail } from "../utils/mailer.js";
import { ApprovalInboxService, STALE_AFTER_DAYS, SYSTEM_SCOPE } from "../services/approvalInboxService.js";
import type { ApprovalRow } from "../services/approvalRegistry.js";

/**
 * A daily note to management about what is still waiting.
 *
 * The console solved "where do I look"; it did not solve "nobody looked". A
 * request can sit for a fortnight without anyone knowing, because the person
 * who raised it has no way to chase and the people who can decide it have no
 * reason to visit the page.
 *
 * One digest a day rather than a mail per request: at any real volume the
 * second is noise, and noise is how a queue stops being read. The digest leads
 * with what has been waiting longest, because that is the part that has
 * actually gone wrong.
 *
 * Nothing waiting means nothing sent. An email that says "0 items" every
 * morning trains people to delete it unopened, which is exactly the habit this
 * relies on not existing.
 */

const service = new ApprovalInboxService();

/**
 * Everyone who can act on this queue.
 *
 * Deliberately not scoped to an organisation, unlike the birthday digest: the
 * console itself is cross-organisation and open to Super Admins only, so this
 * carries exactly what its recipients already see on the page. Anyone else is
 * not a recipient precisely because they could not act on it.
 */
async function managementRecipients(): Promise<string[]> {
  const role = await Role.findOne({ roleName: "Super Admin", isSystemRole: true }).select("_id");
  if (!role) return [];
  const users = await User.find({ role: role._id, status: { $ne: "inactive" } }).select("email").lean();
  return users.map((u) => u.email).filter(Boolean);
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const daysWaiting = (raisedAt: Date | null): number =>
  raisedAt ? Math.floor((Date.now() - new Date(raisedAt).getTime()) / 86_400_000) : 0;

/** Shared by both bodies, so the plain-text fallback cannot say "1 days". */
const age = (raisedAt: Date | null): string => {
  const days = daysWaiting(raisedAt);
  return days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
};

function buildHtml(rows: ApprovalRow[], stale: ApprovalRow[]): string {
  const line = (r: ApprovalRow) => {
    const days = daysWaiting(r.raisedAt);
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-size:12px;white-space:nowrap">${esc(r.moduleLabel)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600">${esc(r.title)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666">${esc(r.organization.name ?? "—")}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:${days >= STALE_AFTER_DAYS ? "#b45309" : "#666"};white-space:nowrap">${age(r.raisedAt)}</td>
    </tr>`;
  };

  const table = (title: string, list: ApprovalRow[]) => `
    <h3 style="margin:24px 0 4px;font-size:14px;color:#333">${esc(title)}</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase">
        <th style="padding:8px 12px">Type</th><th style="padding:8px 12px">Request</th>
        <th style="padding:8px 12px">Organisation</th><th style="padding:8px 12px">Waiting</th>
      </tr></thead>
      <tbody>${list.map(line).join("")}</tbody>
    </table>`;

  // The oldest few, then the rest — a reader who only looks at the top of the
  // mail should still see the things that have gone wrong.
  const rest = rows.filter((r) => !stale.includes(r)).slice(0, 15);

  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:680px;margin:auto">
    <h2 style="color:#4f46e5;margin-bottom:4px">${rows.length} request${rows.length === 1 ? "" : "s"} waiting for a decision</h2>
    <p style="color:#555;margin-top:0">Across every organisation${stale.length ? `, of which <strong style="color:#b45309">${stale.length} ${stale.length === 1 ? "has" : "have"} been waiting over ${STALE_AFTER_DAYS} days</strong>` : ""}.</p>
    ${stale.length ? table(`Waiting longest`, stale) : ""}
    ${rest.length ? table(stale.length ? "Everything else" : "Waiting", rest) : ""}
    ${rows.length > stale.length + rest.length ? `<p style="color:#888;font-size:13px">…and ${rows.length - stale.length - rest.length} more.</p>` : ""}
    <p style="margin-top:24px"><a href="${env.CLIENT_URL}/approvals" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open the approvals console</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS. You receive this because you can approve these requests.</p>
  </div>`;
}

/** Build and send today's digest. Safe to call by hand — returns a summary. */
export async function runApprovalDigest() {
  const { rows } = await service.list({ view: "pending" }, SYSTEM_SCOPE);
  if (rows.length === 0) {
    console.log("📥 approvals digest: nothing waiting.");
    return { waiting: 0, stale: 0, emailed: false, recipients: 0 };
  }

  const cutoff = Date.now() - STALE_AFTER_DAYS * 86_400_000;
  const stale = rows.filter((r) => r.raisedAt && new Date(r.raisedAt).getTime() < cutoff);

  const recipients = await managementRecipients();
  if (recipients.length === 0) {
    console.log(`📥 approvals digest: ${rows.length} waiting but no Super Admin recipients — skipped.`);
    return { waiting: rows.length, stale: stale.length, emailed: false, recipients: 0 };
  }

  // No `organization` on the mail: this is cross-tenant by nature, so it goes
  // out through the default transport rather than any one tenant's SMTP.
  const emailed = await sendMail({
    to: recipients,
    subject: stale.length
      ? `${rows.length} waiting for approval — ${stale.length} over ${STALE_AFTER_DAYS} days`
      : `${rows.length} request${rows.length === 1 ? "" : "s"} waiting for approval`,
    html: buildHtml(rows, stale),
    text: rows
      .map((r) => `${r.moduleLabel}: ${r.title} (${r.organization.name ?? "—"}) — waiting ${age(r.raisedAt)}`)
      .join("\n"),
  });

  console.log(`📥 approvals digest: ${rows.length} waiting (${stale.length} stale) → ${recipients.length} recipient(s).`);
  return { waiting: rows.length, stale: stale.length, emailed, recipients: recipients.length };
}

/** Schedule the daily digest (server local time). */
export function startApprovalDigestCron() {
  const expr = env.APPROVAL_DIGEST_CRON;
  if (!cron.validate(expr)) {
    console.error(`📥 invalid APPROVAL_DIGEST_CRON "${expr}" — approval digests disabled.`);
    return;
  }
  cron.schedule(expr, () => {
    runApprovalDigest().catch((e) => console.error("📥 approvals digest failed:", e));
  });
  console.log(`📥 approvals digest cron scheduled: "${expr}"`);
}
