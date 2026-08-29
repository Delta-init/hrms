import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import { sendMail } from "../utils/mailer.js";

/**
 * Telling HR what the accounts department did with a payroll.
 *
 * Each system notifies its own people, and only about events the other side
 * caused. HRMS has no addresses for anybody in finance and no idea who there is
 * allowed to act on a payroll — the finance half sends its own. What HRMS owns
 * are the two things that arrive here from outside and that nobody would
 * otherwise notice: a month sent back to be fixed, and a month that has been
 * paid.
 *
 * Every send is best-effort and never throws. The transition being announced
 * has already happened, and a payroll must not fail because a mail server did.
 */

/**
 * Who to tell.
 *
 * Anyone whose role can approve payroll — the same people allowed to submit a
 * month are the ones who need to know it came back. Derived from permissions
 * rather than a maintained list, which would drift the moment somebody changed
 * roles.
 */
async function payrollApprovers(organizationId: unknown): Promise<string[]> {
  const roles = await Role.find({
    $or: [
      { "permissions.payroll.approve": true },
      { isSystemRole: true, roleName: "Super Admin" },
    ],
  })
    .select("_id")
    .lean();
  if (!roles.length) return [];

  const users = await User.find({
    role: { $in: roles.map((r) => r._id) },
    status: { $ne: "inactive" },
    ...(organizationId ? { organization: organizationId } : {}),
  })
    .select("email")
    .lean();

  return [...new Set(users.map((u) => u.email).filter(Boolean))];
}

function shell(title: string, lines: string[]): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#111;max-width:600px;margin:40px auto;padding:0 24px">
<div style="border:1px solid #e2e8f0;border-radius:12px;padding:28px">
  <h2 style="margin:0 0 16px;font-size:18px">${title}</h2>
  ${lines.map((l) => `<p style="margin:0 0 12px;color:#334155">${l}</p>`).join("")}
</div></body></html>`;
}

/**
 * Accounts have sent a month back.
 *
 * The one notification that genuinely cannot wait: the month is unlocked and
 * sitting with HR, and until somebody fixes what was wrong and resubmits it,
 * nobody is getting paid. The reason travels with it, because a payroll landing
 * back with no explanation is one nobody knows how to act on.
 */
export async function notifyPayrollReturned(
  organizationId: unknown,
  month: string,
  reason: string,
): Promise<void> {
  try {
    const to = await payrollApprovers(organizationId);
    if (!to.length) return;

    await sendMail({
      to,
      organization: organizationId,
      subject: `Payroll for ${month} has been sent back by accounts`,
      html: shell("Accounts have returned a payroll", [
        `<strong>${month}</strong> is back with HR and its payslips are editable again.`,
        `The reason given was: <strong>${reason}</strong>`,
        "Correct it and submit the month again — nobody on this payroll is paid until you do.",
      ]),
      text: `Payroll for ${month} was returned by accounts. Reason: ${reason}`,
    });
  } catch {
    // Never fail the transition over a mail server.
  }
}

/** Accounts have paid, in whole or in part. */
export async function notifyPayrollPaid(
  organizationId: unknown,
  month: string,
  opts: { fullyPaid: boolean; paidCount: number; outstanding: number },
): Promise<void> {
  try {
    const to = await payrollApprovers(organizationId);
    if (!to.length) return;

    const lines = opts.fullyPaid
      ? [`<strong>${month}</strong> has been paid in full. Every payslip now reads as paid.`]
      : [
          `<strong>${month}</strong> has been partly paid — ${opts.paidCount} payslip(s) settled, ` +
            `${opts.outstanding} still outstanding.`,
          "Somebody usually remains unpaid because they have no bank details on record. " +
            "Adding them and telling accounts is what closes the month.",
        ];

    await sendMail({
      to,
      organization: organizationId,
      subject: opts.fullyPaid ? `Payroll for ${month} has been paid` : `Payroll for ${month} has been partly paid`,
      html: shell(opts.fullyPaid ? "Payroll paid" : "Payroll partly paid", lines),
      text: `Payroll for ${month}: ${opts.fullyPaid ? "paid in full" : `${opts.paidCount} paid, ${opts.outstanding} outstanding`}`,
    });
  } catch {
    // As above.
  }
}
