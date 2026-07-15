import { SalaryIncrement } from "../models/SalaryIncrement.js";
import { Employee } from "../models/Employee.js";
import type { CreateSalaryIncrementInput, UpdateSalaryIncrementInput } from "../validations/salaryIncrementValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

interface IncrementQuery extends PaginationQuery {
  employee?: string;
}

const POP = [
  { path: "employee", select: "name employeeCode designation currency salary" },
  { path: "createdBy", select: "name" },
];

/**
 * The salary in force for an employee as of `month` (YYYY-MM): the newSalary of
 * the latest increment effective on or before that month, else the base salary.
 * effectiveMonth is a fixed-width YYYY-MM string, so lexical compare = chronological.
 */
export async function effectiveSalaryFor(employeeId: string, baseSalary: number, month: string): Promise<number> {
  const inc = await SalaryIncrement.findOne(
    scoped({ employee: employeeId, effectiveMonth: { $lte: month } })
  ).sort({ effectiveMonth: -1 });
  return inc ? inc.newSalary : baseSalary;
}

export class SalaryIncrementService {
  async create(input: CreateSalaryIncrementInput, createdBy: string) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    // Snapshot the salary in force just BEFORE this increment's effective month.
    const prevInc = await SalaryIncrement.findOne(
      scoped({ employee: input.employee, effectiveMonth: { $lt: input.effectiveMonth } })
    ).sort({ effectiveMonth: -1 });
    const previousSalary = prevInc ? prevInc.newSalary : employee.salary ?? 0;

    const doc = await SalaryIncrement.create({
      organization: getOrgId(),
      employee: input.employee,
      user: employee.user ?? null,
      previousSalary,
      newSalary: input.newSalary,
      effectiveMonth: input.effectiveMonth,
      reason: input.reason,
      createdBy,
    });
    return SalaryIncrement.findById(doc._id).populate(POP);
  }

  async list(query: IncrementQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;

    const sortable = new Set(["effectiveMonth", "newSalary", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "effectiveMonth";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      SalaryIncrement.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      SalaryIncrement.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await SalaryIncrement.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Salary increment not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateSalaryIncrementInput) {
    const record = await SalaryIncrement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Salary increment not found"), { statusCode: 404 });
    Object.assign(record, input);
    await record.save();
    return SalaryIncrement.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await SalaryIncrement.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Salary increment not found"), { statusCode: 404 });
  }
}
