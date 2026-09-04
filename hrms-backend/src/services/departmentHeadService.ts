import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { sendMail } from "../utils/mailer.js";
import { reportingManagerUserId, managerContact } from "./reportingManager.js";

/**
 * Who a department head may decide for.
 *
 * The approval engine beside this routes by Role — "HR Manager approves" — and
 * that answers a different question from the one being asked here. A head does
 * not approve a category of request; they approve the people who report into
 * their department, and who that is depends on who raised it rather than on
 * what kind of thing it is.
 *
 * So this is a second, narrower path to the same decision rather than a change
 * to the engine: HR keeps every approval it already had, and a head gains
 * exactly their own department on top. Nobody loses anything, which matters
 * when the alternative is discovering at review time that a queue has silently
 * stopped reaching the person who used to clear it.
 *
 * A head is recorded as an Employee or as a login, so both are checked — the
 * same person reached by two different references.
 */

/** The departments this login is head of. Empty for almost everybody. */
export async function departmentsHeadedBy(userId: string): Promise<string[]> {
  // Their employee record, because a head is usually recorded as an employee
  // rather than as a login even though the field accepts either.
  const employee = await Employee.findOne(scoped({ user: userId })).select("_id").lean();
  const ids = [userId, ...(employee ? [String(employee._id)] : [])];
  const depts = await Department.find(scoped({ leader: { $in: ids } })).select("_id").lean();
  return depts.map((d) => String(d._id));
}

/**
 * Whether this login may decide a request raised by that person.
 *
 * False is the answer for almost every pair, and deliberately says nothing
 * about HR's own permission — the caller checks that separately, because "I am
 * allowed because I am HR" and "I am allowed because they report to me" are
 * different claims and conflating them makes an audit trail unreadable.
 */
export async function headsDepartmentOf(userId: string, requesterUserId: string): Promise<boolean> {
  const owned = await departmentsHeadedBy(userId);
  if (!owned.length) return false;

  // Somebody cannot approve their own request by heading their own department.
  // The engine refuses self-review elsewhere; this refuses it here too, so the
  // narrower path cannot become a way around the wider one.
  if (String(userId) === String(requesterUserId)) return false;

  const requester = await Employee.findOne(scoped({ user: requesterUserId })).select("department").lean();
  if (!requester?.department) return false;
  return owned.includes(String(requester.department));
}

/** Everybody in the departments this login heads, for scoping a queue. */
export async function teamMemberUserIds(userId: string): Promise<string[]> {
  const owned = await departmentsHeadedBy(userId);
  if (!owned.length) return [];
  const members = await Employee.find(scoped({ department: { $in: owned }, user: { $ne: null } }))
    .select("user")
    .lean();
  // Their own id is left out: a head's own request belongs to HR, not to them.
  return members.map((m) => String(m.user)).filter((id) => id !== String(userId));
}

/**
 * The head of the department somebody belongs to, with an address to reach them.
 *
 * Null wherever any link in the chain is missing — no employee record, no
 * department, no head set, or a head with no email. Nineteen of twenty-one
 * departments have no head today, so null is the ordinary answer rather than an
 * error, and every caller treats it as "this one is HR's".
 */
export async function headContactFor(
  requesterUserId: string
): Promise<{ name: string; email: string; userId: string } | null> {
  const requester = await Employee.findOne(scoped({ user: requesterUserId })).select("department").lean();
  if (!requester?.department) return null;

  const dept = await Department.findOne(scoped({ _id: requester.department }))
    .select("leader leaderKind name")
    .lean();
  if (!dept?.leader) return null;

  // The head is stored as an Employee or as a login, so the lookup follows
  // whichever the record says — reading the wrong collection would find nothing
  // and silently report the department as headless.
  if (dept.leaderKind === "User") {
    const u = await User.findOne(scoped({ _id: dept.leader })).select("name email").lean();
    if (!u?.email) return null;
    return { name: String(u.name ?? "there"), email: u.email, userId: String(u._id) };
  }
  const e = await Employee.findOne(scoped({ _id: dept.leader })).select("name user").lean();
  if (!e?.user) return null;
  const u = await User.findOne(scoped({ _id: e.user })).select("email").lean();
  if (!u?.email) return null;
  return { name: String(e.name ?? "there"), email: u.email, userId: String(e.user) };
}

/**
 * Everyone who runs this person's line: the department head, and the
 * reporting manager, wherever each is set and however they differ.
 *
 * The two are separate relationships in this system — `Department.leader` and
 * `Employee.reportingTo` — and do not have to agree. Most of the customer
 * service teams built recently have the same person as both, because the head
 * is also who members report to; elsewhere they can be two different people,
 * and someone with only one of the two set should not go unmailed because the
 * other happens to be empty.
 *
 * Deduplicated by user id, so a person who is both — the common case — gets
 * one mail, not two. The requester themself is always excluded, whichever
 * relationship would have produced them: nobody needs telling that their own
 * request is waiting on them.
 */
export async function chainOfCommandFor(
  requesterUserId: string
): Promise<Array<{ name: string; email: string; userId: string }>> {
  const seen = new Map<string, { name: string; email: string; userId: string }>();
  const add = (c: { name: string; email: string; userId: string } | null) => {
    if (!c) return;
    if (String(c.userId) === String(requesterUserId)) return;
    seen.set(String(c.userId), c);
  };

  add(await headContactFor(requesterUserId));

  const managerId = await reportingManagerUserId(requesterUserId);
  if (managerId) {
    const m = await managerContact(managerId);
    if (m?.email) add({ name: String(m.name ?? "there"), email: m.email, userId: managerId });
  }

  return [...seen.values()];
}

/**
 * Tell whoever runs this person's line that they've asked for something.
 *
 * Best-effort, and always after the record is saved: a mail server having a
 * bad afternoon must not lose somebody's leave request. Silent where nobody
 * resolves — most people currently have neither a department head nor a
 * distinct reporting manager set, which is a data gap, not a fault worth
 * logging on every application.
 */
export async function notifyDepartmentHead(opts: {
  requesterUserId: string;
  requesterName: string;
  subject: string;
  headline: string;
  rows: Array<[string, string]>;
  link: string;
  /**
   * The two things that differ between "somebody has asked for something" and
   * "something was decided" — everything else about the mail is identical.
   * Defaults match the original apply-only notice exactly, so neither existing
   * call site needs to change to keep behaving as it always did.
   */
  heading?: string;
  ctaLabel?: string;
  accentColor?: string;
}): Promise<boolean> {
  const recipients = await chainOfCommandFor(opts.requesterUserId);
  if (!recipients.length) return false;

  const heading = opts.heading ?? "Waiting on you";
  const ctaLabel = opts.ctaLabel ?? "Review it";
  const accent = opts.accentColor ?? "#4f46e5";
  const cells = opts.rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#888">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>`
    )
    .join("");

  // One at a time rather than a single To: list — a mail server rejecting one
  // bad address must not cost every other recipient their copy, and each
  // person's reason for receiving this ("head of" vs "reports to") differs.
  let sentAny = false;
  for (const person of recipients) {
    try {
      await sendMail({
        to: person.email,
        organization: getOrgId() ?? undefined,
        subject: opts.subject,
        text:
          `${opts.headline}\n\n` +
          opts.rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
          `\n\n${ctaLabel}: ${opts.link}\n`,
        html:
          `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
          `<h2 style="color:${accent};margin-bottom:4px">${heading}</h2>` +
          `<p style="color:#555">${opts.headline}</p>` +
          `<table style="border-collapse:collapse;margin:16px 0;font-size:14px">${cells}</table>` +
          `<p><a href="${opts.link}" style="display:inline-block;background:${accent};color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">${ctaLabel}</a></p>` +
          `<p style="color:#999;font-size:12px;margin-top:20px">You receive this because you are ${opts.requesterName}'s department head or reporting manager.</p>` +
          `</div>`,
      });
      sentAny = true;
    } catch {
      /* the request is saved; a failed notice to one recipient must not cost the others */
    }
  }
  return sentAny;
}
