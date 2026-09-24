import { MonthlyPerformanceReport } from "../models/MonthlyPerformanceReport.js";
import { Employee } from "../models/Employee.js";
import type { CreateMonthlyPerformanceReportInput } from "../validations/monthlyPerformanceReportValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";
import { publicUrl, putObject, deleteObject, attachmentKey } from "./uploadService.js";
import { extFromMime } from "../middleware/upload.js";
import { hasPermission } from "../middleware/permissions.js";
import { headsDepartmentOf, departmentsHeadedBy, teamMemberUserIds } from "./departmentHeadService.js";
import type { IRole } from "../types/index.js";

class ReportError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const POP = [
  { path: "employee", select: "name employeeCode designation department" },
  { path: "submittedBy", select: "name email" },
];

interface Query extends PaginationQuery {
  employee?: string;
  month?: string;
}

/** A stored report with its file as a link rather than a key. */
function shape<T extends { reportKey?: string | null }>(doc: T | null) {
  if (!doc) return doc;
  return { ...doc, reportUrl: doc.reportKey ? publicUrl(doc.reportKey) : "" };
}

export class MonthlyPerformanceReportService {
  /**
   * Whether `actorUserId` may file or read a report for `targetUserId` —
   * their own, or their department head's, or HR's, and nothing wider.
   *
   * Not a route permission: filing your own needs none, exactly like leave or
   * office keeping, and a department head's authority comes from the org
   * chart rather than from a role. `headsDepartmentOf` already refuses a head
   * "approving" their own request by heading their own department, so self
   * and head are checked as two separate, non-overlapping claims.
   */
  private async canActFor(actorRole: IRole | undefined, actorUserId: string, targetUserId: string): Promise<boolean> {
    if (actorUserId === targetUserId) return true;
    if (hasPermission(actorRole, "performance", "edit")) return true;
    return headsDepartmentOf(actorUserId, targetUserId);
  }

  async create(
    input: CreateMonthlyPerformanceReportInput,
    actor: { userId: string; role: IRole | undefined },
    file?: Express.Multer.File
  ) {
    const employee = await Employee.findOne(scoped({ _id: input.employee })).select("user name").lean<{ _id: unknown; user?: unknown; name?: string } | null>();
    if (!employee) throw new ReportError("Employee not found", 404);
    if (!employee.user) throw new ReportError("This employee has no login to file a report against", 400);
    const targetUserId = String(employee.user);

    if (!(await this.canActFor(actor.role, actor.userId, targetUserId))) {
      throw new ReportError("You may only file a report for yourself or your own department", 403);
    }

    let reportKey = "";
    let reportFileName = "";
    if (file) {
      const ext = extFromMime(file.mimetype);
      reportKey = attachmentKey(getOrgId(), String(employee._id), "performance-reports", ext, Date.now());
      await putObject(reportKey, file.buffer, file.mimetype);
      reportFileName = file.originalname;
    }

    // One per employee per month: filing again replaces it — but only the
    // parts actually sent this time. Attaching a file with no text repeated
    // must not blank out text filed earlier the same month; leaving the text
    // untouched means whatever it was before is still there.
    const existing = await MonthlyPerformanceReport.findOne(scoped({ employee: input.employee, month: input.month }));
    const reportText = input.reportText !== undefined ? input.reportText.trim() : (existing?.reportText ?? "");
    const finalKey = file ? reportKey : (existing?.reportKey ?? "");
    if (!reportText && !finalKey) {
      throw new ReportError("Write something, or attach a file — one of the two is needed", 400);
    }

    if (existing) {
      // A prior file is deleted from storage rather than left orphaned once
      // it is no longer what the record points to.
      if (file && existing.reportKey && existing.reportKey !== reportKey) await deleteObject(existing.reportKey);
      existing.reportText = reportText;
      if (file) { existing.reportKey = reportKey; existing.reportFileName = reportFileName; }
      existing.submittedBy = actor.userId as never;
      await existing.save();
      const updated = await MonthlyPerformanceReport.findById(existing._id).populate(POP);
      return shape(updated!.toObject());
    }

    const record = await MonthlyPerformanceReport.create({
      organization: getOrgId(),
      employee: input.employee,
      user: employee.user,
      month: input.month,
      reportText,
      reportKey,
      reportFileName,
      submittedBy: actor.userId,
    });
    const created = await MonthlyPerformanceReport.findById(record._id).populate(POP);
    return shape(created!.toObject());
  }

  /** The caller's own reports, across every month. */
  async listMine(userId: string, query: Query) {
    const { page, limit, skip } = parsePagination(query, 20, 200);
    const filter: Record<string, unknown> = { ...orgFilter(), user: userId };
    if (query.month) filter.month = query.month;
    const [records, total] = await Promise.all([
      MonthlyPerformanceReport.find(filter).populate(POP).sort({ month: -1 }).skip(skip).limit(limit).lean(),
      MonthlyPerformanceReport.countDocuments(filter),
    ]);
    return { records: records.map((r) => shape(r)), pagination: buildPagination(total, page, limit) };
  }

  /**
   * Everybody's, for whoever asked — HR sees the lot; a department head who
   * does not also hold the permission is narrowed to their own team, the
   * same rule procurement's list already follows.
   */
  async list(query: Query, actor: { userId: string; role: IRole | undefined }) {
    const { page, limit, skip } = parsePagination(query, 20, 200);
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.month) filter.month = query.month;
    if (query.employee) filter.employee = query.employee;

    if (!hasPermission(actor.role, "performance", "edit")) {
      const heads = await departmentsHeadedBy(actor.userId);
      if (!heads.length) throw new ReportError("You do not have access to this", 403);
      const team = await Employee.find(scoped({ department: { $in: heads } })).select("_id").lean();
      filter.employee = { $in: team.map((e) => e._id) };
    }

    const [records, total] = await Promise.all([
      MonthlyPerformanceReport.find(filter).populate(POP).sort({ month: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      MonthlyPerformanceReport.countDocuments(filter),
    ]);
    return { records: records.map((r) => shape(r)), pagination: buildPagination(total, page, limit) };
  }

  /** Everybody a caller may file for: themselves, plus their own team. */
  async whoCanFileFor(userId: string) {
    const team = await teamMemberUserIds(userId);
    const ids = [...new Set([userId, ...team])];
    const employees = await Employee.find(scoped({ user: { $in: ids } })).select("name employeeCode user").lean();
    return employees.map((e) => ({ _id: String(e._id), name: e.name, employeeCode: e.employeeCode, isSelf: String(e.user) === userId }));
  }
}
