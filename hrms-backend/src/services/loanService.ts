import { Loan } from "../models/Loan.js";
import { Employee } from "../models/Employee.js";
import type { CreateLoanInput, UpdateLoanInput } from "../validations/loanValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";

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
    const { page, limit, skip } = parsePagination(query, 20, 200);

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

/** Instalments that should have been collected by the end of `month`, inclusive. */
function instalmentsDueBy(disbursedDate: Date | undefined | null, month: string): number {
  if (!disbursedDate) return 0;
  const d = new Date(disbursedDate);
  const [y, m] = month.split("-").map(Number);
  return (y - d.getFullYear()) * 12 + (m - (d.getMonth() + 1)) + 1;
}

/**
 * What an employee's active loans should recover in `month`.
 *
 * The figure is the whole schedule to date minus what has actually been repaid,
 * not a flat instalment — so a month that could only collect part of one (a
 * salary too small to cover it, unpaid leave) is made up automatically the next
 * time there is room, with no arrears field to keep in step. Still capped at
 * the outstanding balance, and the caller caps it again at what the payslip can
 * actually afford.
 */
export async function computeLoanDeductions(
  employeeId: string,
  month: string
): Promise<{ lines: LoanDeductionLine[]; repayments: Repayment[] }> {
  const loans = await Loan.find(scoped({ employee: employeeId, status: "active" }));
  const lines: LoanDeductionLine[] = [];
  const repayments: Repayment[] = [];
  for (const loan of loans) {
    const outstanding = round2(loan.amount - loan.amountRepaid);
    if (outstanding <= 0) continue;

    const elapsed = instalmentsDueBy(loan.disbursedDate, month);
    if (elapsed <= 0) continue;
    const schedule = loan.monthlyDeduction || loan.amount;
    const dueToDate = Math.min(loan.amount, round2(schedule * elapsed));
    const want = Math.min(round2(dueToDate - loan.amountRepaid), outstanding);
    if (want <= 0) continue;

    lines.push({
      label: `${LOAN_DEDUCTION_PREFIX}${loan.purpose ? ` (${loan.purpose})` : ""}`,
      amount: want,
    });
    repayments.push({ loanId: String(loan._id), amount: want });
  }
  return { lines, repayments };
}

/** Apply the recorded repayments to the loans; close any that are fully repaid. */
export async function recordLoanRepayments(repayments: Repayment[]): Promise<void> {
  for (const r of repayments) {
    const loan = await Loan.findById(r.loanId);
    if (!loan) continue;
    loan.amountRepaid = Math.min(loan.amount, round2(loan.amountRepaid + r.amount));
    if (loan.amountRepaid >= loan.amount) loan.status = "closed";
    await loan.save();
  }
}

/**
 * Undo repayments a payslip recorded, for when it is edited or deleted.
 *
 * Without this, correcting a payslip left the money counted as collected: the
 * balance fell, the loan could even close, and nothing had actually been paid.
 */
export async function reverseLoanRepayments(repayments: Repayment[]): Promise<void> {
  for (const r of repayments) {
    const loan = await Loan.findById(r.loanId);
    if (!loan) continue;
    loan.amountRepaid = Math.max(0, round2(loan.amountRepaid - r.amount));
    if (loan.amountRepaid < loan.amount && loan.status === "closed") loan.status = "active";
    await loan.save();
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Label prefix used for auto-generated loan deduction lines. */
export const LOAN_DEDUCTION_PREFIX = "Loan repayment";
