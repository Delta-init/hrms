import { Organization } from "../models/Organization.js";
import { Announcement } from "../models/Announcement.js";
import { Appraisal } from "../models/Appraisal.js";
import { ApprovalWorkflow } from "../models/ApprovalWorkflow.js";
import { Asset } from "../models/Asset.js";
import { Attendance } from "../models/Attendance.js";
import { AttendancePenaltyPolicy } from "../models/AttendancePenaltyPolicy.js";
import { Card } from "../models/Card.js";
import { CompOffCredit } from "../models/CompOffCredit.js";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { GeneratedLetter } from "../models/GeneratedLetter.js";
import { HelpdeskTicket } from "../models/HelpdeskTicket.js";
import { Holiday } from "../models/Holiday.js";
import { LeavePolicy } from "../models/LeavePolicy.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { LetterTemplate } from "../models/LetterTemplate.js";
import { Loan } from "../models/Loan.js";
import { OnboardingChecklist } from "../models/OnboardingChecklist.js";
import { OnboardingTemplate } from "../models/OnboardingTemplate.js";
import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
import { Overtime } from "../models/Overtime.js";
import { PayrollChecklistItem } from "../models/PayrollChecklistItem.js";
import { Payslip } from "../models/Payslip.js";
import { PerformanceCycle } from "../models/PerformanceCycle.js";
import { Regularization } from "../models/Regularization.js";
import { Reimbursement } from "../models/Reimbursement.js";
import { Resignation } from "../models/Resignation.js";
import { RosterAssignment } from "../models/RosterAssignment.js";
import { SalaryIncrement } from "../models/SalaryIncrement.js";
import { SalaryStructure } from "../models/SalaryStructure.js";
import { SalaryStructureAssignment } from "../models/SalaryStructureAssignment.js";
import { Survey } from "../models/Survey.js";
import { SurveyResponse } from "../models/SurveyResponse.js";
import { User } from "../models/User.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "../validations/organizationValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";

/** Every collection that carries an `organization` ref — deleted in full when the tenant is removed. */
const ORG_SCOPED_MODELS: { deleteMany: (filter: Record<string, unknown>) => Promise<unknown> }[] = [
  Announcement, Appraisal, ApprovalWorkflow, Asset, Attendance, AttendancePenaltyPolicy,
  Card, CompOffCredit, Department, Employee, GeneratedLetter, HelpdeskTicket, Holiday,
  LeavePolicy, LeaveRequest, LetterTemplate, Loan, OnboardingChecklist, OnboardingTemplate,
  OneTimeAdjustment, Overtime, PayrollChecklistItem, Payslip, PerformanceCycle, Regularization,
  Reimbursement, Resignation, RosterAssignment, SalaryIncrement, SalaryStructure,
  SalaryStructureAssignment, Survey, SurveyResponse, User, WorkSchedule,
];

/**
 * Organizations are the tenant registry — NOT scoped by org themselves.
 * Only the Super Admin manages them.
 */
export class OrganizationService {
  async create(input: CreateOrganizationInput) {
    const existing = await Organization.findOne({ code: input.code.trim().toUpperCase() });
    if (existing) throw Object.assign(new Error("Organization code already exists"), { statusCode: 409 });
    return Organization.create(input);
  }

  async list(query: PaginationQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.search) {
      const rx = new RegExp(query.search, "i");
      filter.$or = [{ name: rx }, { code: rx }];
    }
    if (query.status) filter.status = query.status;

    const sortable = new Set(["name", "code", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "name";
    const sortDir = query.sortOrder === "desc" ? -1 : 1;

    const [records, total] = await Promise.all([
      Organization.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      Organization.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  /** Lightweight list for the switcher. */
  async listAll() {
    return Organization.find({ status: "active" }).select("name code logo").sort({ name: 1 });
  }

  async getById(id: string) {
    const record = await Organization.findById(id);
    if (!record) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateOrganizationInput) {
    const record = await Organization.findById(id);
    if (!record) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
    if (input.code && input.code.trim().toUpperCase() !== record.code) {
      const dupe = await Organization.findOne({ code: input.code.trim().toUpperCase(), _id: { $ne: id } });
      if (dupe) throw Object.assign(new Error("Organization code already exists"), { statusCode: 409 });
    }
    // Merge settings shallowly so partial updates don't wipe the rest.
    const { settings, ...rest } = input;
    Object.assign(record, rest);
    if (settings) record.settings = { ...record.settings, ...settings };
    await record.save();
    return record;
  }

  /**
   * Deleting a tenant cascades to every org-scoped collection first, then the
   * Organization record itself — previously this only deleted the Organization
   * document, silently orphaning every employee/attendance/payslip/etc. row
   * that referenced it.
   */
  async remove(id: string) {
    const record = await Organization.findById(id);
    if (!record) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });

    await Promise.all(ORG_SCOPED_MODELS.map((model) => model.deleteMany({ organization: id })));
    await Organization.findByIdAndDelete(id);
  }
}
