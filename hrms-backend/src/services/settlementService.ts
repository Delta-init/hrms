import { Resignation } from "../models/Resignation.js";
import { Employee } from "../models/Employee.js";
import { Loan } from "../models/Loan.js";
import { Reimbursement } from "../models/Reimbursement.js";
import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
import { resolveSalaryBreakup } from "./salaryStructureService.js";
import { effectiveSalaryFor } from "./salaryIncrementService.js";
import type { SettlementInput } from "../validations/resignationValidation.js";
import type { IFinalSettlement, ISettlementLine } from "../types/index.js";
import { scoped } from "../utils/orgContext.js";

const round = (n: number) => Math.round(n * 100) / 100;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * UAE-style end-of-service gratuity: nothing under a year of service, then
 * 21 days' basic wage per year for the first five years and 30 days' per year
 * beyond, capped at two years' total pay. Exposed as an editable line so it can
 * be overridden for a different jurisdiction or policy.
 */
export function computeGratuity(tenureYears: number, dayRate: number, basic: number): number {
  if (tenureYears < 1) return 0;
  const firstFive = Math.min(tenureYears, 5) * 21;
  const beyond = Math.max(0, tenureYears - 5) * 30;
  const gratuity = (firstFive + beyond) * dayRate;
  const cap = basic * 24; // two years' total pay
  return round(Math.min(gratuity, cap));
}

interface SettlementSources {
  reimbursementIds: string[];
  oneTimeIds: string[];
  loanIds: string[];
}

/** The dues records an employee's settlement draws on — collected so settling
 *  can mark them consumed (reimbursements paid, one-time applied, loans closed). */
async function collectSettlementSources(employeeId: string): Promise<SettlementSources> {
  const [reimbursements, oneTime, loans] = await Promise.all([
    Reimbursement.find(scoped({ employee: employeeId, status: "approved" })).select("_id").lean(),
    OneTimeAdjustment.find(scoped({ employee: employeeId, applied: false })).select("_id").lean(),
    Loan.find(scoped({ employee: employeeId, status: "active" })).select("_id").lean(),
  ]);
  return {
    reimbursementIds: reimbursements.map((r) => String(r._id)),
    oneTimeIds: oneTime.map((o) => String(o._id)),
    loanIds: loans.map((l) => String(l._id)),
  };
}

/**
 * Compute a full-&-final settlement for a resignation from current data +
 * manual inputs, WITHOUT persisting.
 */
export async function computeFinalSettlement(
  resignationId: string,
  input: SettlementInput = {}
): Promise<IFinalSettlement> {
  const resig = await Resignation.findOne(scoped({ _id: resignationId }))
    .populate<{ employee: { _id: unknown; salary?: number; currency?: string; joiningDate?: Date } }>(
      "employee", "name employeeCode salary currency joiningDate designation"
    );
  if (!resig) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
  const emp = resig.employee as unknown as { _id: unknown; salary?: number; currency?: string; joiningDate?: Date };
  if (!emp?._id) throw Object.assign(new Error("Employee not found for this resignation"), { statusCode: 404 });
  const employeeId = String(emp._id);

  const lastDay = resig.lastWorkingDay ?? new Date();
  const month = `${lastDay.getUTCFullYear()}-${String(lastDay.getUTCMonth() + 1).padStart(2, "0")}`;

  // Basic in force (structure Basic, else effective-dated salary).
  const fallbackSalary = await effectiveSalaryFor(employeeId, emp.salary ?? 0, month);
  const breakup = await resolveSalaryBreakup(employeeId, month, fallbackSalary);
  const basic = breakup.earnings[0]?.amount ?? fallbackSalary; // Basic line
  const dayRate = round(basic / 30);
  const currency = emp.currency ?? "AED";

  // Tenure from joining to last working day.
  const tenureYears = emp.joiningDate ? Math.max(0, (lastDay.getTime() - new Date(emp.joiningDate).getTime()) / MS_PER_YEAR) : 0;

  const gratuity = input.gratuityOverride != null ? round(input.gratuityOverride) : computeGratuity(tenureYears, dayRate, basic);
  const leaveEncashmentDays = input.leaveEncashmentDays ?? 0;
  const noticeShortfallDays = input.noticeShortfallDays ?? 0;
  const leaveEncashment = round(leaveEncashmentDays * dayRate);
  const noticeShortfall = round(noticeShortfallDays * dayRate);

  // Approved-but-unpaid reimbursements owed to the employee.
  const reimbursements = await Reimbursement.find(scoped({ employee: employeeId, status: "approved" }))
    .select("title amount").lean();
  // Unapplied one-time payments (earnings) and deductions.
  const oneTime = await OneTimeAdjustment.find(scoped({ employee: employeeId, applied: false }))
    .select("kind label amount").lean();
  // Outstanding balance on active loans, recovered in full.
  const loans = await Loan.find(scoped({ employee: employeeId, status: "active" }))
    .select("amount amountRepaid").lean();
  const loanOutstanding = round(loans.reduce((a, l) => a + Math.max(0, (l.amount ?? 0) - (l.amountRepaid ?? 0)), 0));

  const earnings: ISettlementLine[] = [];
  if (gratuity > 0) earnings.push({ label: `Gratuity (${tenureYears.toFixed(2)} yrs)`, amount: gratuity });
  if (leaveEncashment > 0) earnings.push({ label: `Leave encashment (${leaveEncashmentDays}d)`, amount: leaveEncashment });
  for (const r of reimbursements) earnings.push({ label: `Reimbursement: ${r.title}`, amount: round(r.amount) });
  for (const o of oneTime) if (o.kind === "payment") earnings.push({ label: o.label, amount: round(o.amount) });
  for (const e of input.extraEarnings ?? []) earnings.push({ label: e.label, amount: round(e.amount) });

  const deductions: ISettlementLine[] = [];
  if (loanOutstanding > 0) deductions.push({ label: "Loan recovery", amount: loanOutstanding });
  if (noticeShortfall > 0) deductions.push({ label: `Notice shortfall (${noticeShortfallDays}d)`, amount: noticeShortfall });
  for (const o of oneTime) if (o.kind === "deduction") deductions.push({ label: o.label, amount: round(o.amount) });
  for (const d of input.extraDeductions ?? []) deductions.push({ label: d.label, amount: round(d.amount) });

  const totalEarnings = round(earnings.reduce((a, l) => a + l.amount, 0));
  const totalDeductions = round(deductions.reduce((a, l) => a + l.amount, 0));

  const settlement: IFinalSettlement = {
    computedAt: new Date(),
    basic, dayRate, tenureYears: round(tenureYears),
    gratuity, leaveEncashmentDays, noticeShortfallDays,
    earnings, deductions, totalEarnings, totalDeductions,
    netPayable: round(totalEarnings - totalDeductions),
    currency,
    settled: resig.settlement?.settled ?? false,
    settledAt: resig.settlement?.settledAt ?? null,
    notes: input.notes ?? resig.settlement?.notes ?? undefined,
  };

  return settlement;
}

export class SettlementService {
  /** Non-persisting preview from current data + inputs. */
  async preview(resignationId: string, input: SettlementInput) {
    return computeFinalSettlement(resignationId, input);
  }

  /** Persist the computed settlement snapshot (not yet settled). */
  async save(resignationId: string, input: SettlementInput) {
    const settlement = await computeFinalSettlement(resignationId, input);
    const resig = await Resignation.findOne(scoped({ _id: resignationId }));
    if (!resig) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
    if (resig.settlement?.settled)
      throw Object.assign(new Error("This settlement has already been finalised"), { statusCode: 400 });
    resig.settlement = settlement as never;
    await resig.save();
    return resig.settlement;
  }

  /**
   * Finalise the saved settlement: mark it settled using the stored snapshot
   * (so any manually-added lines are preserved), mirror the net onto the
   * resignation's finalSettlement, and consume the sources (reimbursements →
   * paid, one-time → applied, loans → closed) so the same dues are never paid
   * again through payroll.
   */
  async settle(resignationId: string) {
    const resig = await Resignation.findOne(scoped({ _id: resignationId }));
    if (!resig) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
    if (!resig.settlement)
      throw Object.assign(new Error("Compute and save the settlement before finalising it"), { statusCode: 400 });
    if (resig.settlement.settled)
      throw Object.assign(new Error("This settlement has already been finalised"), { statusCode: 400 });

    const employeeId = String(resig.employee);
    const sources = await collectSettlementSources(employeeId);

    resig.settlement.settled = true;
    resig.settlement.settledAt = new Date();
    resig.finalSettlement = resig.settlement.netPayable;
    resig.markModified("settlement");
    await resig.save();

    // Consume the dues so payroll never pays them twice.
    if (sources.reimbursementIds.length)
      await Reimbursement.updateMany(scoped({ _id: { $in: sources.reimbursementIds } }), { $set: { status: "paid" } });
    if (sources.oneTimeIds.length)
      await OneTimeAdjustment.updateMany(scoped({ _id: { $in: sources.oneTimeIds } }), { $set: { applied: true } });
    for (const loanId of sources.loanIds) {
      const loan = await Loan.findOne(scoped({ _id: loanId }));
      if (loan) { loan.amountRepaid = loan.amount; loan.status = "closed"; await loan.save(); }
    }

    return resig.settlement;
  }
}
