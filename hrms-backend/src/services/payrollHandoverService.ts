import { PayrollBatch } from "../models/PayrollBatch.js";
import { Payslip } from "../models/Payslip.js";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import type { PayrollBatchStatus } from "../types/index.js";

/**
 * What the accounts system is allowed to see of a month's payroll, and how it
 * takes possession of one.
 *
 * Cross-organization by design and therefore free of `scoped()`, exactly like
 * directoryService: the caller is a server with no user and no org context, so
 * every query filters on an organization the caller named. The org is never
 * inferred here — inferring it would return nothing at best and another
 * tenant's payroll at worst.
 *
 * Unlike the directory, this one *does* carry money and bank details. That is
 * the point: a payroll run cannot be paid without them. What keeps it
 * proportionate is that they are only served for a month that HR has actually
 * submitted — an unsubmitted month is not visible here at all, whatever the
 * caller asks for.
 */

const err = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

/** Statuses a month must be in before finance may read its figures. */
const VISIBLE: PayrollBatchStatus[] = [
  "submitted", "in_finance", "approved", "partially_paid", "paid",
];

export interface HandoverLine {
  payslipId: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  departmentId: string | null;
  departmentName: string;
  designation: string;
  /**
   * What this person is paid in.
   *
   * Per payslip, not per batch. A batch carries one currency because it needs
   * a heading, but the people in it need not share it — a month can hold
   * salaries in dirhams and salaries in rupees, and finance summing them as
   * one figure is out by a factor of twenty-two on every rupee line.
   */
  currency: string;
  /** Rounded to the currency's minor unit before it leaves, never after. */
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  earnings: Array<{ label: string; amount: number }>;
  deductions: Array<{ label: string; amount: number }>;
  status: string;
  paidAt: string | null;
  bank: { iban: string; accountNumber: string; bankName: string; nameInBank: string };
  payable: boolean;
  /**
   * The payslip refers to an employee record that no longer exists.
   *
   * Payslips outlive the people they belong to — deleting an employee leaves
   * theirs behind — and the line then carries no code and no name. Accounts
   * cannot map somebody who is not there, so the difference between "not
   * mapped yet" and "cannot be mapped" has to travel with the line rather than
   * being guessed from two empty strings at the other end.
   */
  employeeMissing: boolean;
}

export class PayrollHandoverService {
  /** Months an organization has handed over, newest first. */
  async listBatches(organizationId: string, status?: string) {
    const filter: Record<string, unknown> = {
      organization: organizationId,
      status: status ? status : { $in: VISIBLE },
    };
    if (status && !VISIBLE.includes(status as PayrollBatchStatus)) {
      throw err(`Payroll that is "${status}" has not been handed over`, 400);
    }
    const rows = await PayrollBatch.find(filter).sort({ month: -1 }).limit(24).lean();
    return rows.map((b) => ({
      month: b.month,
      status: b.status,
      currency: b.currency,
      employeeCount: b.employeeCount,
      grossTotal: b.grossTotal,
      deductionTotal: b.deductionTotal,
      netTotal: b.netTotal,
      submittedAt: b.submittedAt ? new Date(b.submittedAt).toISOString() : null,
      financeRunId: b.financeRunId ?? "",
    }));
  }

  /**
   * One month in full: every payslip, itemised, with the bank details needed to
   * pay it.
   *
   * A month HR has not submitted is reported as not found rather than as
   * forbidden. There is nothing here to be forbidden from yet — the figures are
   * still being worked on, and saying "exists but you may not have it" would
   * invite a retry loop against a month that simply is not ready.
   */
  async getBatch(organizationId: string, month: string) {
    const batch = await PayrollBatch.findOne({ organization: organizationId, month }).lean();
    if (!batch || !VISIBLE.includes(batch.status)) {
      throw err(`No payroll has been submitted for ${month}`, 404);
    }

    const slips = await Payslip.find({ organization: organizationId, month })
      // currency included deliberately: a projection that omits it makes
      // every payslip look like the batch's own, which is the thing this is
      // here to distinguish.
      .select("employee currency earnings deductions grossPay totalDeductions netPay status paidAt")
      .lean();

    const employees = await Employee.find({ _id: { $in: slips.map((s) => s.employee) } })
      .select("employeeCode name department designation bank")
      .lean();
    const empById = new Map(employees.map((e) => [String(e._id), e]));

    const deptIds = [...new Set(employees.map((e) => e.department).filter(Boolean))];
    const depts = await Department.find({ _id: { $in: deptIds } }).select("name").lean();
    const deptById = new Map(depts.map((d) => [String(d._id), d.name]));

    const lines: HandoverLine[] = slips.map((s) => {
      const emp = empById.get(String(s.employee));
      const bank = (emp as { bank?: { ibanIfsc?: string; bankAccountNumber?: string; bankName?: string; nameInBank?: string } } | undefined)?.bank;
      const iban = bank?.ibanIfsc ?? "";
      const accountNumber = bank?.bankAccountNumber ?? "";
      return {
        payslipId: String(s._id),
        employeeId: String(s.employee),
        employeeCode: emp?.employeeCode ?? "",
        // Named so the line is identifiable in a list. An empty string reads
        // as a rendering fault rather than as missing data.
        name: emp?.name ?? "(employee record deleted)",
        departmentId: emp?.department ? String(emp.department) : null,
        departmentName: emp?.department ? (deptById.get(String(emp.department)) ?? "") : "",
        designation: emp?.designation ?? "",
        // The payslip's own, falling back to the batch's where a payslip
        // predates the field.
        currency: (s.currency as string) || batch.currency,
        grossPay: s.grossPay ?? 0,
        totalDeductions: s.totalDeductions ?? 0,
        netPay: s.netPay ?? 0,
        earnings: (s.earnings ?? []).map((l) => ({ label: l.label, amount: l.amount })),
        deductions: (s.deductions ?? []).map((l) => ({ label: l.label, amount: l.amount })),
        status: s.status,
        paidAt: s.paidAt ? new Date(s.paidAt).toISOString() : null,
        bank: { iban, accountNumber, bankName: bank?.bankName ?? "", nameInBank: bank?.nameInBank ?? "" },
        employeeMissing: !emp,
        // Said here rather than left for finance to work out, so both systems
        // agree on who can actually receive money.
        payable: Boolean(iban || accountNumber),
      };
    });

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const totals = lines.reduce(
      (a, l) => ({
        gross: r2(a.gross + l.grossPay),
        deductions: r2(a.deductions + l.totalDeductions),
        net: r2(a.net + l.netPay),
      }),
      { gross: 0, deductions: 0, net: 0 }
    );

    return {
      month: batch.month,
      organizationId,
      status: batch.status,
      currency: batch.currency,
      submittedAt: batch.submittedAt ? new Date(batch.submittedAt).toISOString() : null,
      financeRunId: batch.financeRunId ?? "",
      lines,
      totals: {
        employeeCount: lines.length,
        grossTotal: totals.gross,
        deductionTotal: totals.deductions,
        netTotal: totals.net,
        unpayable: lines.filter((l) => !l.payable).length,
      },
      /**
       * The totals HR snapshotted at submit. Sent alongside the recomputed ones
       * so finance can refuse an import where the two disagree, rather than
       * importing a number nobody agreed to.
       */
      snapshot: {
        employeeCount: batch.employeeCount,
        grossTotal: batch.grossTotal,
        deductionTotal: batch.deductionTotal,
        netTotal: batch.netTotal,
      },
    };
  }
}

export const payrollHandoverService = new PayrollHandoverService();
