import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
import { Payslip } from "../models/Payslip.js";
import { Employee } from "../models/Employee.js";
import { PayrollBatch } from "../models/PayrollBatch.js";
import { PayslipService } from "./payslipService.js";
import { getOrgId, scoped } from "../utils/orgContext.js";

/**
 * The accounts department's additions and deductions on a month HR has already
 * handed over.
 *
 * This is the one door through which a locked month may still change, and it is
 * narrow on purpose: only while the month is `in_finance`, only for employees
 * who already have a payslip in it, and only through items that carry an
 * accounts-side id so the same request arriving twice cannot pay somebody
 * twice.
 *
 * The reason it exists at all is that the payslip an employee downloads has to
 * match the money that leaves the bank. Accounts could keep their additions on
 * their own side and pay a different number — and then no payslip in the
 * company would be true.
 */

const err = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

const payslips = new PayslipService();

export interface FinanceAdjustmentInput {
  externalId: string;
  employeeId: string;
  kind: "payment" | "deduction";
  label: string;
  amount: number;
  notes?: string;
}

export interface AdjustmentOutcome {
  externalId: string;
  employeeId: string;
  payslipId: string;
  label: string;
  kind: "payment" | "deduction";
  /** What accounts asked for. */
  amount: number;
  /**
   * What the month could actually take, for a deduction. A deduction larger
   * than the take-home is collected over several months rather than driving one
   * payslip negative, so asking for 2,000 and recovering 1,400 is a normal
   * outcome — and accounts must be told, or they will book a recovery that did
   * not happen.
   */
  appliedAmount: number;
  /** Still owed after this month. */
  outstanding: number;
  netBefore: number;
  netAfter: number;
  /** Scheduled recovery the payslip as a whole still could not afford. */
  deferred: number;
}

/** The month must be open to accounts, and only accounts, before anything moves. */
async function requireInFinance(month: string) {
  const batch = await PayrollBatch.findOne(scoped({ month }));
  if (!batch) throw err(`No payroll has been submitted for ${month}`, 404);
  if (batch.status !== "in_finance") {
    throw err(
      batch.status === "submitted"
        ? `${month} has not been imported yet. Claim it before adding anything.`
        : `${month} is ${batch.status.replace("_", " ")} and can no longer be adjusted.`,
      409
    );
  }
  return batch;
}

export class FinanceAdjustmentService {
  /**
   * Apply a set of additions and deductions, then rebuild every payslip they
   * touched.
   *
   * Recomputed per employee rather than per item, so somebody receiving three
   * additions has their payslip rebuilt once and the allocator sees all three
   * together — which matters, because what a month can afford depends on the
   * total, not on the order the items happened to arrive in.
   */
  async apply(month: string, items: FinanceAdjustmentInput[]) {
    await requireInFinance(month);
    if (!items.length) throw err("No adjustments were sent", 400);

    const duplicates = items.filter((it, i) => items.findIndex((o) => o.externalId === it.externalId) !== i);
    if (duplicates.length) {
      throw err(`The same externalId appears more than once: ${duplicates[0]!.externalId}`, 400);
    }

    const employeeIds = [...new Set(items.map((i) => i.employeeId))];
    const employees = await Employee.find(scoped({ _id: { $in: employeeIds } })).select("user").lean();
    const empById = new Map(employees.map((e) => [String(e._id), e]));

    const slips = await Payslip.find(scoped({ month, employee: { $in: employeeIds } })).select("employee").lean();
    const slipByEmployee = new Map(slips.map((s) => [String(s.employee), String(s._id)]));

    for (const item of items) {
      if (!empById.has(item.employeeId)) throw err(`Employee ${item.employeeId} is not in this organization`, 404);
      if (!slipByEmployee.has(item.employeeId)) {
        // Refused rather than creating one: a payslip appearing after the
        // handover is a person finance never saw when they took the month.
        throw err(`${item.employeeId} has no payslip for ${month}`, 409);
      }
      if (!(item.amount > 0)) throw err(`"${item.label}" must be a positive amount`, 400);
    }

    // Upserted on externalId, so a retried request updates the row it created
    // last time instead of adding a second one.
    for (const item of items) {
      const employee = empById.get(item.employeeId)!;
      await OneTimeAdjustment.findOneAndUpdate(
        { externalId: item.externalId },
        {
          $set: {
            organization: getOrgId(),
            employee: item.employeeId,
            user: employee.user ?? null,
            kind: item.kind,
            label: item.label,
            amount: item.amount,
            month,
            notes: item.notes ?? "",
            source: "finance",
          },
          $setOnInsert: { applied: false, appliedAmount: 0 },
        },
        { upsert: true, new: true }
      );
    }

    const outcomes: AdjustmentOutcome[] = [];
    for (const employeeId of employeeIds) {
      const result = await payslips.recompute(slipByEmployee.get(employeeId)!);
      const mine = items.filter((i) => i.employeeId === employeeId);
      const rows = await OneTimeAdjustment.find({ externalId: { $in: mine.map((m) => m.externalId) } }).lean();
      const byExternal = new Map(rows.map((r) => [r.externalId!, r]));

      for (const item of mine) {
        const row = byExternal.get(item.externalId);
        // A payment is paid whole; only a deduction can come up short.
        const applied = item.kind === "payment" ? item.amount : (row?.appliedAmount ?? 0);
        outcomes.push({
          externalId: item.externalId,
          employeeId,
          payslipId: result.payslipId,
          label: item.label,
          kind: item.kind,
          amount: item.amount,
          appliedAmount: applied,
          outstanding: Math.round((item.amount - applied) * 100) / 100,
          netBefore: result.before.net,
          netAfter: result.after.net,
          deferred: result.deferred,
        });
      }
    }

    return { month, applied: outcomes.length, outcomes };
  }

  /**
   * Withdraw one of accounts' items and rebuild the payslip without it.
   *
   * Only their own: an externalId identifies a finance-raised row, and HR's own
   * adjustments are not theirs to remove.
   */
  async remove(month: string, externalId: string) {
    await requireInFinance(month);

    const row = await OneTimeAdjustment.findOne(scoped({ externalId, source: "finance" }));
    if (!row) throw err("No such adjustment", 404);
    if (row.month !== month) throw err(`That adjustment belongs to ${row.month}`, 409);

    const employeeId = String(row.employee);
    const slip = await Payslip.findOne(scoped({ month, employee: employeeId })).select("_id").lean();
    await OneTimeAdjustment.deleteOne({ _id: row._id });

    // The payslip is rebuilt after the row is gone, so the allocator never sees
    // it. Deleting without rebuilding would leave its money in the payslip with
    // nothing behind it.
    const result = slip ? await payslips.recompute(String(slip._id)) : null;
    return { message: `Removed "${row.label}"`, externalId, recomputed: result };
  }

  /** Everything accounts have added to a month so far. */
  async list(month: string) {
    const rows = await OneTimeAdjustment.find(scoped({ month, source: "finance" })).lean();
    return rows.map((r) => ({
      externalId: r.externalId,
      employeeId: String(r.employee),
      kind: r.kind,
      label: r.label,
      amount: r.amount,
      appliedAmount: r.appliedAmount ?? 0,
      outstanding: Math.round((r.amount - (r.appliedAmount ?? 0)) * 100) / 100,
      applied: r.applied,
    }));
  }
}

export const financeAdjustmentService = new FinanceAdjustmentService();
