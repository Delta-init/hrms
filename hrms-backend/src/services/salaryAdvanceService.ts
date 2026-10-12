import { SalaryAdvance } from "../models/SalaryAdvance.js";
import { Loan } from "../models/Loan.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import type { CreateSalaryAdvanceInput, ReviewSalaryAdvanceInput, CreateAdvanceForEmployeeInput } from "../validations/salaryAdvanceValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";
import { isMonthEditable } from "./payrollBatchService.js";
import { resolveSalaryBreakup } from "./salaryStructureService.js";
import { SALARY_ADVANCE_LABEL } from "./loanService.js";
import { sendMail } from "../utils/mailer.js";
import { notify } from "./notificationService.js";
import { watchersFor } from "./watchers.js";
import { env } from "../config/env.js";

/**
 * Salary advances: an employee asks, HR agrees and sets the recovery, finance
 * pays it out, and payroll takes it back.
 *
 * Finance never logs in here. Its half arrives over the integration API from
 * the finance system, the same way procurement's does — `listForFinance` and
 * `recordFinanceDecision` below, called with the organization named outright
 * because a machine request has no user to infer it from.
 */

class AdvanceError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const POP = [
  { path: "employee", select: "name employeeCode designation department" },
  { path: "user", select: "name email" },
  { path: "hrReviewedBy", select: "name email" },
  { path: "raisedBy", select: "name" },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const currentMonth = () => new Date().toISOString().slice(0, 7);
const money = (n: number, c: string) => `${c} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

interface Query extends PaginationQuery {
  status?: string;
}

async function mail(to: string, subject: string, heading: string, body: string) {
  try {
    await sendMail({
      to,
      organization: String(getOrgId() ?? ""),
      subject,
      text: `${heading}\n\n${body.replace(/<[^>]+>/g, "")}\n\n${env.CLIENT_URL}/payroll\n`,
      html:
        `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
        `<h2 style="color:#4f46e5;margin-bottom:4px">${heading}</h2><p style="color:#555">${body}</p>` +
        `<p><a href="${env.CLIENT_URL}/payroll" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open payroll</a></p>` +
        `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`,
    });
  } catch {
    /* the request stands whether or not the mail got out */
  }
}

/** Tell the person who asked, in-app and by mail. Never throws. */
async function tellRequester(record: { user: unknown }, title: string, body: string, tone: "positive" | "negative" | "neutral", organization?: unknown) {
  try {
    await notify({ users: [String(record.user)], kind: "payroll", tone, title, body, href: "/payroll", organization });
  } catch { /* mail below */ }
  const who = await User.findById(record.user).select("email").lean<{ email?: string } | null>();
  if (who?.email) await mail(who.email, title, title, body);
}

/** Everyone who decides advances, in-app and by mail. Never throws. */
async function tellApprovers(title: string, body: string, exclude?: unknown, organization?: unknown) {
  try {
    const ids = await watchersFor("advances", exclude ? String(exclude) : undefined);
    if (!ids.length) return;
    await notify({ users: ids, kind: "approval", title, body, href: "/payroll", actor: exclude, organization });
    const people = await User.find({ _id: { $in: ids }, status: { $ne: "inactive" } }).select("email").lean();
    for (const p of people) if (p.email) await mail(p.email, title, title, body);
  } catch { /* the decision stands either way */ }
}

export class SalaryAdvanceService {
  /**
   * What this person may ask for right now, and why not if they can't.
   *
   * The limit is one month's salary — the contractual gross for this month,
   * the same figure payroll pays from. Someone still repaying an earlier
   * advance, or with one already in someone's hands, has to finish that first.
   */
  async eligibility(userId: string) {
    const emp = await Employee.findOne(scoped({ user: userId })).select("_id").lean<{ _id: unknown } | null>();
    if (!emp) return { canRequest: false, reason: "No employee record is linked to your login", monthlySalary: 0, maxAmount: 0, currency: "AED", owing: 0 };
    return this.eligibilityFor(String(emp._id));
  }

  /** The same answer for any employee — HR's form asks it about the person chosen. */
  async eligibilityFor(employeeId: string) {
    const emp = await Employee.findOne(scoped({ _id: employeeId })).select("_id salary currency").lean<{ _id: unknown; salary?: number; currency?: string } | null>();
    if (!emp) return { canRequest: false, reason: "Employee not found", monthlySalary: 0, maxAmount: 0, currency: "AED", owing: 0 };
    const currency = emp.currency ?? "AED";

    const breakup = await resolveSalaryBreakup(employeeId, currentMonth(), emp.salary ?? 0);
    const monthlySalary = r2(breakup.gross || emp.salary || 0);

    const [open, owingLoans] = await Promise.all([
      SalaryAdvance.findOne(scoped({ employee: employeeId, status: { $in: ["pending", "hr_approved"] } })).select("_id status").lean(),
      Loan.find(scoped({ employee: employeeId, kind: "advance", status: "active" })).select("amount amountRepaid").lean(),
    ]);
    const owing = r2(owingLoans.reduce((a, l) => a + (l.amount - l.amountRepaid), 0));

    let reason = "";
    if (monthlySalary <= 0) reason = "No salary is on record for you yet — ask HR to add it first";
    else if (open) reason = "You already have an advance request in progress";
    else if (owing > 0) reason = `You are still repaying an earlier advance (${money(owing, currency)} left)`;

    return { canRequest: !reason, reason, monthlySalary, maxAmount: monthlySalary, currency, owing, open: !!open };
  }

  /**
   * HR raising one for an employee — someone without the app to hand, or a
   * request agreed in person. HR's approval comes with it, recovery and all,
   * so it starts with finance; nothing is owed until finance approves.
   *
   * The same rules as an employee's own request, except that HR may go over
   * one month's salary — and then must say why, and the request says it went
   * over, so finance sees that before approving.
   */
  async createForEmployee(input: CreateAdvanceForEmployeeInput, hrUserId: string) {
    const emp = await Employee.findOne(scoped({ _id: input.employee })).select("_id name user").lean<{ _id: unknown; name?: string; user?: unknown } | null>();
    if (!emp) throw new AdvanceError("Employee not found", 404);
    if (!emp.user) throw new AdvanceError(`${emp.name ?? "This employee"} has no login, so they can't be told about it or see it — add their login first`, 400);
    if (String(emp.user) === String(hrUserId)) throw new AdvanceError("You can't raise an advance for yourself — ask someone else in HR", 403);

    const elig = await this.eligibilityFor(String(emp._id));
    if (elig.open) throw new AdvanceError(`${emp.name} already has an advance in progress`, 409);
    if (elig.owing > 0) throw new AdvanceError(`${emp.name} is still repaying an earlier advance (${money(elig.owing, elig.currency)} left)`, 409);

    const overLimit = input.amount > elig.maxAmount;
    if (overLimit && !input.note?.trim()) {
      throw new AdvanceError(
        elig.maxAmount > 0
          ? `That is more than one month's salary (${money(elig.maxAmount, elig.currency)}) — add a note saying why`
          : `${emp.name} has no salary on record, so any amount is over the limit — add a note saying why`,
        400
      );
    }

    if (input.startMonth < currentMonth()) throw new AdvanceError("Recovery can't start in a month that has already passed", 400);
    if (!(await isMonthEditable(input.startMonth))) {
      throw new AdvanceError(`${input.startMonth} has already gone to accounts — start the recovery in a later month`, 409);
    }

    const note = (input.note ?? "").trim();
    let record;
    try {
      record = await SalaryAdvance.create({
        organization: getOrgId(),
        employee: emp._id,
        user: emp.user,
        amount: r2(input.amount),
        currency: elig.currency,
        reason: input.reason,
        neededBy: input.neededBy ? new Date(`${input.neededBy}T00:00:00.000Z`) : null,
        monthlySalary: elig.monthlySalary,
        status: "hr_approved",
        months: input.months,
        startMonth: input.startMonth,
        hrReviewedBy: hrUserId,
        hrReviewedAt: new Date(),
        // Finance reads HR's note, not these flags — so going over says so there.
        hrNote: (overLimit ? `Over one month's salary — ${note}` : note).slice(0, 500),
        raisedBy: hrUserId,
        overLimit,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new AdvanceError(`${emp.name} already has an advance in progress`, 409);
      throw err;
    }

    const per = money(r2(record.amount / input.months), record.currency);
    await tellRequester(
      record,
      "HR has raised a salary advance for you",
      `${money(record.amount, record.currency)}, recovered over ${input.months} month${input.months === 1 ? "" : "s"} (${per} a month) from ${input.startMonth}. ` +
        `It is now with finance; nothing is taken from your pay until they approve it.${note ? `<br><br>${note}` : ""}`,
      "neutral"
    );

    return SalaryAdvance.findById(record._id).populate(POP);
  }

  async create(input: CreateSalaryAdvanceInput, userId: string) {
    const emp = await Employee.findOne(scoped({ user: userId })).select("_id name").lean<{ _id: unknown; name?: string } | null>();
    if (!emp) throw new AdvanceError("No employee record is linked to your login", 404);

    const elig = await this.eligibility(userId);
    if (!elig.canRequest) throw new AdvanceError(elig.reason, 409);
    if (input.amount > elig.maxAmount) {
      throw new AdvanceError(`You can ask for up to one month's salary — ${money(elig.maxAmount, elig.currency)}`, 400);
    }

    let record;
    try {
      record = await SalaryAdvance.create({
        organization: getOrgId(),
        employee: emp._id,
        user: userId,
        amount: r2(input.amount),
        currency: elig.currency,
        reason: input.reason,
        neededBy: input.neededBy ? new Date(`${input.neededBy}T00:00:00.000Z`) : null,
        monthlySalary: elig.monthlySalary,
        status: "pending",
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new AdvanceError("You already have an advance request in progress", 409);
      throw err;
    }

    await tellApprovers(
      `Salary advance requested — ${emp.name ?? "an employee"}`,
      `<strong>${emp.name}</strong> asked for an advance of <strong>${money(record.amount, record.currency)}</strong>` +
        `${record.neededBy ? `, needed by ${record.neededBy.toISOString().slice(0, 10)}` : ""}.<br>${input.reason}`,
      userId
    );

    return SalaryAdvance.findById(record._id).populate(POP);
  }

  async listMine(userId: string, query: Query) {
    const { page, limit, skip } = parsePagination(query, 20, 200);
    const filter: Record<string, unknown> = { ...orgFilter(), user: userId };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    const [records, total] = await Promise.all([
      SalaryAdvance.find(filter).populate(POP).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SalaryAdvance.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  /** The panel: everyone's, waiting on HR first. */
  async list(query: Query) {
    const { page, limit, skip } = parsePagination(query, 20, 200);
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    const [records, total] = await Promise.all([
      SalaryAdvance.find(filter).populate(POP).sort({ status: 1, createdAt: 1 }).skip(skip).limit(limit).lean(),
      SalaryAdvance.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  /**
   * HR's decision. Approving sets the recovery and passes it to finance —
   * nothing is owed yet, because nothing has been paid.
   */
  async review(id: string, input: ReviewSalaryAdvanceInput, reviewerId: string) {
    const record = await SalaryAdvance.findOne(scoped({ _id: id }));
    if (!record) throw new AdvanceError("Request not found", 404);
    if (record.status !== "pending") throw new AdvanceError("This request has already been decided by HR", 400);
    if (String(record.user) === String(reviewerId)) throw new AdvanceError("You can't decide your own advance", 403);

    if (input.decision === "approve") {
      const start = input.startMonth!;
      if (start < currentMonth()) throw new AdvanceError("Recovery can't start in a month that has already passed", 400);
      if (!(await isMonthEditable(start))) {
        throw new AdvanceError(`${start} has already gone to accounts — start the recovery in a later month`, 409);
      }
      record.status = "hr_approved";
      record.months = input.months!;
      record.startMonth = start;
    } else {
      record.status = "rejected";
      record.rejectedBy = "hr";
    }
    record.hrReviewedBy = reviewerId as never;
    record.hrReviewedAt = new Date();
    record.hrNote = input.note ?? "";
    await record.save();

    const amount = money(record.amount, record.currency);
    if (input.decision === "approve") {
      const per = money(r2(record.amount / record.months!), record.currency);
      await tellRequester(
        record,
        "Your salary advance was approved by HR",
        `${amount}, recovered over ${record.months} month${record.months === 1 ? "" : "s"} (${per} a month) from ${record.startMonth}. ` +
          `It is now with finance.${input.note ? `<br><br>${input.note}` : ""}`,
        "positive"
      );
    } else {
      await tellRequester(record, "Your salary advance was not approved", `${amount}${input.note ? `<br><br>${input.note}` : ""}`, "negative");
    }

    return SalaryAdvance.findById(record._id).populate(POP);
  }

  /** The requester withdrawing their own, before HR has decided it. */
  async cancelMine(id: string, userId: string) {
    const record = await SalaryAdvance.findOne(scoped({ _id: id, user: userId }));
    if (!record) throw new AdvanceError("Request not found", 404);
    if (record.status !== "pending") throw new AdvanceError("HR has already decided this — ask them if it needs to change", 400);
    await SalaryAdvance.deleteOne({ _id: record._id });
    return { message: "Request withdrawn" };
  }

  // ── Finance integration ────────────────────────────────────────────────────

  /** What HR has approved and finance has not yet approved or refused. */
  async listForFinance(organization: string) {
    return SalaryAdvance.find({ organization, status: "hr_approved" })
      .populate([
        { path: "employee", select: "name employeeCode designation department", populate: { path: "department", select: "name" } },
        { path: "user", select: "name email" },
        { path: "hrReviewedBy", select: "name email" },
      ])
      .sort({ neededBy: 1, hrReviewedAt: 1 })
      .lean();
  }

  /**
   * Finance's decision. Approving means finance will pay it: the recovery loan is
   * created here, on HR's terms, and payroll takes it from the start month.
   *
   * Idempotent for approval — a retry after a lost response finds the request
   * already approved with its loan, and answers with that rather than
   * refusing, so finance can safely send again.
   */
  async recordFinanceDecision(
    organization: string,
    id: string,
    input: { decision: "approve" | "reject"; note?: string | null; reference?: string | null; paidOn?: string | null }
  ) {
    const record = await SalaryAdvance.findOne({ _id: id, organization });
    if (!record) throw new AdvanceError("Advance not found", 404);
    if (input.decision === "approve" && record.status === "approved" && record.loan) {
      return SalaryAdvance.findById(record._id).populate(POP).lean();
    }
    if (record.status !== "hr_approved") throw new AdvanceError("Only an advance HR has approved is waiting on finance", 409);

    if (input.decision === "approve") {
      const months = record.months ?? 1;
      const paidOn = input.paidOn && /^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) ? input.paidOn : new Date().toISOString().slice(0, 10);
      // Dated mid-month in the start month: a loan's first instalment falls in
      // the month it is dated, and the 15th is that month in every timezone.
      const loan = await Loan.create({
        organization,
        employee: record.employee,
        user: record.user,
        amount: record.amount,
        purpose: SALARY_ADVANCE_LABEL,
        disbursedDate: new Date(`${record.startMonth}-15T00:00:00.000Z`),
        installments: months,
        monthlyDeduction: r2(record.amount / months),
        amountRepaid: 0,
        status: "active",
        kind: "advance",
        advance: record._id,
        notes: `Salary advance approved by finance on ${paidOn}${input.reference ? ` (${input.reference})` : ""}; recovered over ${months} month${months === 1 ? "" : "s"} from ${record.startMonth}.`.slice(0, 500),
      });
      record.status = "approved";
      record.loan = loan._id;
      record.financeRef = (input.reference ?? "").slice(0, 120);
    } else {
      record.status = "rejected";
      record.rejectedBy = "finance";
    }
    record.financeReviewedAt = new Date();
    record.financeNote = (input.note ?? "").slice(0, 500);
    await record.save();

    // Finance is waiting on this answer; the mail can follow it.
    this.announceFinanceDecision(record, organization).catch((err) =>
      console.error(`advances: could not announce finance's decision on ${record._id}:`, err instanceof Error ? err.message : err)
    );
    return SalaryAdvance.findById(record._id).populate(POP).lean();
  }

  private async announceFinanceDecision(
    record: { _id: unknown; user: unknown; employee: unknown; amount: number; currency: string; status: string; months?: number | null; startMonth?: string | null; financeNote?: string },
    organization: string
  ) {
    const amount = money(record.amount, record.currency);
    const emp = await Employee.findById(record.employee).select("name").lean<{ name?: string } | null>();
    if (record.status === "approved") {
      const per = money(r2(record.amount / (record.months ?? 1)), record.currency);
      await tellRequester(
        record,
        "Your salary advance was approved by finance",
        `${amount}. ${per} a month will be taken from your salary for ${record.months} month${record.months === 1 ? "" : "s"}, from ${record.startMonth}.`,
        "positive",
        organization
      );
      await tellApprovers(`Salary advance approved by finance — ${emp?.name ?? "an employee"}`, `${amount}, recovered from ${record.startMonth}.`, undefined, organization);
    } else {
      await tellRequester(record, "Your salary advance was not approved by finance", `${amount}${record.financeNote ? `<br><br>${record.financeNote}` : ""}`, "negative", organization);
      await tellApprovers(`Salary advance refused by finance — ${emp?.name ?? "an employee"}`, `${amount}${record.financeNote ? `<br><br>${record.financeNote}` : ""}`, undefined, organization);
    }
  }
}
