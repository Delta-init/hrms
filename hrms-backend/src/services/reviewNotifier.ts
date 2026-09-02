import { User } from "../models/User.js";
import { sendMail } from "../utils/mailer.js";
import { scoped } from "../utils/orgContext.js";
import { env } from "../config/env.js";
import { notify } from "./notificationService.js";

/**
 * Tells someone what happened to a request they raised.
 *
 * Approvals were entirely silent: a decision landed in the database and the
 * person who asked found out by going and looking. This is deliberately generic
 * — regularization and leave use it today, and resignations and reimbursements
 * are the same shape.
 *
 * Two channels, on purpose. Mail reaches somebody who is not in the app, which
 * is most of the day; the in-app notice reaches somebody who is, without making
 * them go and check another program. Neither is a substitute: an email nobody
 * opens and a bell nobody is looking at fail on opposite days.
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
  /** Which bell icon and grouping the in-app notice gets. */
  kind?: "leave" | "regularization" | "approval" | "payroll" | "system";
  /** Who decided it, so the notice can name them rather than use the passive. */
  reviewer?: { id: unknown; name?: string } | null;
  /**
   * Others to tell in-app that this was decided — HR and the department head.
   *
   * They are not emailed. They did not raise the request, so the outcome is
   * something they may want to see rather than something they need to be
   * interrupted for, and a mail per decision to everybody who could have made
   * it is how an inbox becomes noise.
   */
  watchers?: Array<unknown>;
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
    const verdict = n.approved ? "approved" : "rejected";
    const who = n.reviewer?.name ? ` by ${n.reviewer.name}` : "";

    // In-app first, and independently of the email: somebody with no address on
    // file still gets told, which before this returned early and told them
    // nothing at all.
    await notify({
      users: [n.userId],
      kind: n.kind ?? "system",
      tone: n.approved ? "positive" : "negative",
      title: `${n.subject} ${verdict}${who}`,
      body: [n.details[0] ? `${n.details[0].label}: ${n.details[0].value}` : "", n.note ?? ""].filter(Boolean).join(" · "),
      href: n.path ?? "",
      actor: n.reviewer?.id ?? null,
    });

    if (n.watchers?.length) {
      await notify({
        users: n.watchers,
        kind: n.kind ?? "system",
        tone: "neutral",
        title: `${user?.name ?? "Someone"}'s ${n.subject.toLowerCase()} was ${verdict}${who}`,
        body: n.details[0] ? `${n.details[0].label}: ${n.details[0].value}` : "",
        href: n.path ?? "",
        actor: n.reviewer?.id ?? null,
      });
    }

    if (!user?.email) return;
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
