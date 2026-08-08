import { User } from "../models/User.js";
import { sendMail } from "../utils/mailer.js";
import { scoped } from "../utils/orgContext.js";
import { env } from "../config/env.js";

/**
 * Tells someone what happened to a request they raised.
 *
 * Approvals were entirely silent: a decision landed in the database and the
 * person who asked found out by going and looking. This is deliberately generic
 * — regularization uses it today, and leave, resignations and reimbursements
 * are the same shape.
 */

export interface ReviewNotice {
  /** Who raised the request. */
  userId: unknown;
  /** "Regularization request", "Leave request", … */
  subject: string;
  approved: boolean;
  /** Short lines of context: the day, what it became, the times. */
  details: Array<{ label: string; value: string }>;
  /** The reviewer's note, when they left one. */
  note?: string | null;
  /** Path on the client to see it, e.g. "/regularization". */
  path?: string;
}

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function html(n: ReviewNotice, name: string): string {
  const colour = n.approved ? "#059669" : "#dc2626";
  const verdict = n.approved ? "Approved" : "Rejected";
  const rows = n.details
    .map(
      (d) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#888">${esc(d.label)}</td>` +
        `<td style="padding:4px 0;font-weight:600">${esc(d.value)}</td></tr>`
    )
    .join("");
  const link = n.path ? `${env.CLIENT_URL}${n.path}` : env.CLIENT_URL;

  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">
    <h2 style="color:${colour};margin-bottom:4px">${esc(n.subject)} ${verdict.toLowerCase()}</h2>
    <p style="color:#555">Hi ${esc(name)}, your ${esc(n.subject.toLowerCase())} has been <strong style="color:${colour}">${verdict.toLowerCase()}</strong>.</p>
    <table style="border-collapse:collapse;margin:16px 0;font-size:14px">${rows}</table>
    ${n.note ? `<p style="color:#555;border-left:3px solid #ddd;padding-left:12px;margin:16px 0"><em>${esc(n.note)}</em></p>` : ""}
    <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">View in Delta HRMS</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p>
  </div>`;
}

/**
 * Email the requester the outcome. Never throws: a review must not fail because
 * the mail server is unreachable, and the decision is already saved by now.
 */
export async function notifyReviewed(n: ReviewNotice): Promise<void> {
  try {
    const user = await User.findOne(scoped({ _id: n.userId })).select("name email").lean<{ name?: string; email?: string } | null>();
    if (!user?.email) return;

    const verdict = n.approved ? "approved" : "rejected";
    const plain = [
      `Your ${n.subject.toLowerCase()} has been ${verdict}.`,
      ...n.details.map((d) => `${d.label}: ${d.value}`),
      ...(n.note ? [`Note: ${n.note}`] : []),
    ].join("\n");

    await sendMail({
      to: user.email,
      subject: `${n.subject} ${verdict} — ${n.details[0]?.value ?? ""}`.trim(),
      html: html(n, user.name ?? "there"),
      text: plain,
    });
  } catch (err) {
    console.error("✉️  review notification failed:", err instanceof Error ? err.message : err);
  }
}
