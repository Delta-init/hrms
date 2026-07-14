import { Loan } from "../models/Loan.js";
import { Employee } from "../models/Employee.js";
import type { CreateLoanInput, UpdateLoanInput } from "../validations/loanValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

interface LoanQuery extends PaginationQuery {
  employee?: string;
  status?: string;
}

const POP = [
  { path: "employee", select: "name employeeCode designation currency" },
  { path: "user", select: "name email" },
];

export class LoanService {
  async create(input: CreateLoanInput) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    const installments = input.installments ?? 1;
    const monthlyDeduction =
      input.monthlyDeduction ?? Math.round((input.amount / Math.max(1, installments)) * 100) / 100;

    const doc = await Loan.create({
      organization: getOrgId(),
      employee: input.employee,
      user: employee.user ?? null,
      amount: input.amount,
      purpose: input.purpose,
      disbursedDate: input.disbursedDate ?? null,
      installments,
      monthlyDeduction,
      amountRepaid: 0,
      status: "active",
      notes: input.notes,
    });
    return Loan.findById(doc._id).populate(POP);
  }

  async list(query: LoanQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    if (query.employee) filter.employee = query.employee;

    const sortable = new Set(["amount", "disbursedDate", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Loan.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      Loan.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Loan.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Loan not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateLoanInput) {
    const record = await Loan.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Loan not found"), { statusCode: 404 });
    Object.assign(record, input);
    // Auto-close once fully repaid (unless explicitly cancelled).
    if (record.status !== "cancelled") {
      record.status = record.amountRepaid >= record.amount ? "closed" : "active";
    }
    await record.save();
    return Loan.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Loan.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Loan not found"), { statusCode: 404 });
  }
}

export interface LoanDeductionLine {
  label: string;
  amount: number;
}
interface Repayment {
  loanId: string;
  amount: number;
}

/**
 * Compute this month's salary-deduction lines for an employee's active loans.
 * Returns the deduction lines to add to a payslip and the repayments to record
 * once the payslip is saved. Each instalment is capped at the outstanding balance.
 */
export async function computeLoanDeductions(
  employeeId: string
): Promise<{ lines: LoanDeductionLine[]; repayments: Repayment[] }> {
  const loans = await Loan.find(scoped({ employee: employeeId, status: "active" }));
  const lines: LoanDeductionLine[] = [];
  const repayments: Repayment[] = [];
  for (const loan of loans) {
    const outstanding = loan.amount - loan.amountRepaid;
    if (outstanding <= 0) continue;
    const instalment = Math.min(loan.monthlyDeduction || outstanding, outstanding);
    if (instalment <= 0) continue;
    lines.push({
      label: `Loan repayment${loan.purpose ? ` (${loan.purpose})` : ""}`,
      amount: Math.round(instalment * 100) / 100,
    });
    repayments.push({ loanId: String(loan._id), amount: instalment });
  }
  return { lines, repayments };
}

/** Apply the recorded repayments to the loans; close any that are fully repaid. */
export async function recordLoanRepayments(repayments: Repayment[]): Promise<void> {
  for (const r of repayments) {
    const loan = await Loan.findById(r.loanId);
    if (!loan) continue;
    loan.amountRepaid = Math.min(loan.amount, Math.round((loan.amountRepaid + r.amount) * 100) / 100);
    if (loan.amountRepaid >= loan.amount) loan.status = "closed";
    await loan.save();
  }
}

/** Label prefix used for auto-generated loan deduction lines. */
export const LOAN_DEDUCTION_PREFIX = "Loan repayment";
