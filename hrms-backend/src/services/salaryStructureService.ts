import { SalaryStructure } from "../models/SalaryStructure.js";
import { SalaryStructureAssignment } from "../models/SalaryStructureAssignment.js";
import { SalaryIncrement } from "../models/SalaryIncrement.js";
import { Employee } from "../models/Employee.js";
import type {
  CreateSalaryStructureInput,
  UpdateSalaryStructureInput,
  AssignStructureInput,
  UpdateAssignmentInput,
} from "../validations/salaryStructureValidation.js";
import type { PaginationQuery, ISalaryComponent } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";

const round = (n: number) => Math.round(n * 100) / 100;

interface StructureQuery extends PaginationQuery {
  status?: string;
}

const ASSIGN_POP = [
  { path: "employee", select: "name employeeCode designation currency" },
  { path: "structure", select: "name components" },
  { path: "createdBy", select: "name" },
];

export interface SalaryBreakup {
  /** Earning lines including Basic first. */
  earnings: { label: string; amount: number }[];
  /** Recurring deduction lines from the structure (excludes LOP/loans/one-time). */
  deductions: { label: string; amount: number }[];
  /** Sum of all earnings (Basic + allowances) = the LOP base. */
  gross: number;
  /** Name of the structure in force, or null when falling back to plain salary. */
  structureName: string | null;
}

/** Compute a component's monetary value given the employee's Basic. */
function componentAmount(c: ISalaryComponent, basic: number): number {
  return c.calc === "percent" ? round((basic * c.value) / 100) : round(c.value);
}

/**
 * The salary breakup in force for an employee as of `month` (YYYY-MM).
 * Uses the latest structure assignment effective on or before that month for
 * the *shape* of pay (which allowances/deductions apply), but the *amount* of
 * Basic comes from whichever is more recent: the assignment's basicAmount, or
 * a SalaryIncrement effective on or after that assignment. Without this, a
 * raise recorded after an employee is put on a structure would silently never
 * reach payroll — the assignment's frozen basicAmount would keep winning.
 * `baseSalary` (the employee's plain `salary` field) is the last-resort
 * fallback when neither an assignment nor an increment exists yet.
 */
export async function resolveSalaryBreakup(
  employeeId: string,
  month: string,
  baseSalary: number
): Promise<SalaryBreakup> {
  const [assignment, increment] = await Promise.all([
    SalaryStructureAssignment.findOne(scoped({ employee: employeeId, effectiveMonth: { $lte: month } }))
      .sort({ effectiveMonth: -1 })
      .populate<{ structure: { name: string; components: ISalaryComponent[] } | null }>("structure", "name components"),
    SalaryIncrement.findOne(scoped({ employee: employeeId, effectiveMonth: { $lte: month } })).sort({ effectiveMonth: -1 }),
  ]);

  const incrementWins = !!increment && (!assignment || increment.effectiveMonth >= assignment.effectiveMonth);
  const basic = incrementWins ? increment!.newSalary : assignment?.basicAmount ?? increment?.newSalary ?? baseSalary;

  if (!assignment || !assignment.structure) {
    return {
      earnings: [{ label: "Basic", amount: round(basic) }],
      deductions: [],
      gross: round(basic),
      structureName: null,
    };
  }

  const earnings = [{ label: "Basic", amount: round(basic) }];
  const deductions: { label: string; amount: number }[] = [];
  for (const c of assignment.structure.components) {
    const amount = componentAmount(c, basic);
    if (c.type === "earning") earnings.push({ label: c.name, amount });
    else deductions.push({ label: c.name, amount });
  }
  const gross = round(earnings.reduce((a, e) => a + e.amount, 0));
  return { earnings, deductions, gross, structureName: assignment.structure.name };
}

export class SalaryStructureService {
  // ── Structure templates ────────────────────────────────────────────────────
  async create(input: CreateSalaryStructureInput, createdBy: string) {
    const doc = await SalaryStructure.create({
      organization: getOrgId(),
      name: input.name,
      description: input.description,
      components: input.components ?? [],
      status: input.status ?? "active",
      createdBy,
    });
    return SalaryStructure.findById(doc._id);
  }

  async list(query: StructureQuery) {
    const { page, limit, skip } = parsePagination(query, 50, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status;
    if (query.search) filter.name = searchRegex(query.search);

    const [records, total] = await Promise.all([
      SalaryStructure.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
      SalaryStructure.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await SalaryStructure.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Salary structure not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateSalaryStructureInput) {
    const record = await SalaryStructure.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Salary structure not found"), { statusCode: 404 });
    Object.assign(record, input);
    await record.save();
    return SalaryStructure.findById(id);
  }

  async remove(id: string) {
    const record = await SalaryStructure.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Salary structure not found"), { statusCode: 404 });
    const inUse = await SalaryStructureAssignment.countDocuments(scoped({ structure: id }));
    if (inUse > 0)
      throw Object.assign(new Error(`This structure is assigned to ${inUse} employee(s); reassign them first`), { statusCode: 400 });
    await SalaryStructure.deleteOne({ _id: record._id });
    return { message: "Salary structure deleted successfully" };
  }

  // ── Assignments ─────────────────────────────────────────────────────────────
  async assign(input: AssignStructureInput, createdBy: string) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    const structure = await SalaryStructure.findOne(scoped({ _id: input.structure }));
    if (!structure) throw Object.assign(new Error("Salary structure not found"), { statusCode: 404 });

    // One assignment per employee-month: updating the same effective month replaces it.
    const existing = await SalaryStructureAssignment.findOne(
      scoped({ employee: input.employee, effectiveMonth: input.effectiveMonth })
    );
    if (existing) {
      existing.structure = input.structure as never;
      existing.basicAmount = input.basicAmount;
      existing.notes = input.notes;
      await existing.save();
      return SalaryStructureAssignment.findById(existing._id).populate(ASSIGN_POP);
    }

    const doc = await SalaryStructureAssignment.create({
      organization: getOrgId(),
      employee: input.employee,
      user: employee.user ?? null,
      structure: input.structure,
      basicAmount: input.basicAmount,
      effectiveMonth: input.effectiveMonth,
      notes: input.notes,
      createdBy,
    });
    return SalaryStructureAssignment.findById(doc._id).populate(ASSIGN_POP);
  }

  async listAssignments(query: StructureQuery & { employee?: string }) {
    const { page, limit, skip } = parsePagination(query, 50, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;

    const [records, total] = await Promise.all([
      SalaryStructureAssignment.find(filter).populate(ASSIGN_POP).sort({ effectiveMonth: -1 }).skip(skip).limit(limit),
      SalaryStructureAssignment.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async updateAssignment(id: string, input: UpdateAssignmentInput) {
    const record = await SalaryStructureAssignment.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Assignment not found"), { statusCode: 404 });
    Object.assign(record, input);
    await record.save();
    return SalaryStructureAssignment.findById(id).populate(ASSIGN_POP);
  }

  async removeAssignment(id: string) {
    const record = await SalaryStructureAssignment.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Assignment not found"), { statusCode: 404 });
    return { message: "Assignment removed successfully" };
  }

  /** Resolved breakup for an employee-month (for preview / employee salary tab). */
  async breakup(employeeId: string, month: string) {
    const emp = await Employee.findOne(scoped({ _id: employeeId })).select("salary");
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    return resolveSalaryBreakup(employeeId, month, emp.salary ?? 0);
  }
}
