import { Resignation } from "../models/Resignation.js";
import { Employee } from "../models/Employee.js";
import type { CreateResignationInput, ReviewResignationInput, UpdateResignationInput, ExitDetailsInput } from "../validations/resignationValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

interface ResignationQuery extends PaginationQuery {
  employee?: string;
}

const POP = [
  { path: "employee", select: "name employeeCode designation department", populate: { path: "department", select: "name code" } },
  { path: "user", select: "name email" },
  { path: "reviewedBy", select: "name" },
];

const addDays = (d: Date, days: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
};

export class ResignationService {
  async create(input: CreateResignationInput) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    // Only one open (pending/accepted) resignation per employee.
    const open = await Resignation.findOne(scoped({ employee: input.employee, status: { $in: ["pending", "accepted"] } }));
    if (open) throw Object.assign(new Error("This employee already has an active resignation"), { statusCode: 409 });

    const noticeRequired = input.noticeRequired ?? true;
    // When notice is waived, the exit is immediate: 0 notice days and LWD = resign date.
    const noticePeriodDays = !noticeRequired
      ? 0
      : input.noticePeriodDays ?? employee.noticePeriodDays ?? 60;
    const lastWorkingDay =
      input.lastWorkingDay ??
      (noticeRequired ? addDays(input.resignationDate, noticePeriodDays) : input.resignationDate);

    const doc = await Resignation.create({
      organization: getOrgId(),
      employee: input.employee,
      user: employee.user ?? null,
      resignationType: input.resignationType ?? "resignation",
      resignationDate: input.resignationDate,
      noticeRequired,
      noticePeriodDays,
      lastWorkingDay,
      reason: input.reason,
      status: "pending",
    });
    return Resignation.findById(doc._id).populate(POP);
  }

  async list(query: ResignationQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    if (query.employee) filter.employee = query.employee;

    const sortable = new Set(["resignationDate", "lastWorkingDay", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Resignation.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      Resignation.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Resignation.findById(id).populate(POP);
    if (!record) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateResignationInput) {
    const record = await Resignation.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("Only a pending resignation can be edited"), { statusCode: 400 });
    }
    Object.assign(record, input);
    // Waiving notice makes the exit immediate (0 days, LWD = resign date).
    if (record.noticeRequired === false) {
      record.noticePeriodDays = 0;
      if (input.lastWorkingDay === undefined) record.lastWorkingDay = record.resignationDate;
    } else if ((input.noticePeriodDays !== undefined || input.resignationDate || input.noticeRequired) && input.lastWorkingDay === undefined) {
      // Recompute LWD if notice/date/toggle changed and no explicit LWD supplied.
      record.lastWorkingDay = addDays(record.resignationDate, record.noticePeriodDays);
    }
    await record.save();
    return Resignation.findById(id).populate(POP);
  }

  /** Accept or reject a pending resignation. Accept puts the employee on notice. */
  async review(id: string, input: ReviewResignationInput, reviewerId: string) {
    const record = await Resignation.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("This resignation has already been reviewed"), { statusCode: 400 });
    }
    if (input.noticePeriodDays !== undefined) record.noticePeriodDays = input.noticePeriodDays;
    if (input.lastWorkingDay) record.lastWorkingDay = input.lastWorkingDay;
    else if (input.noticePeriodDays !== undefined) record.lastWorkingDay = addDays(record.resignationDate, record.noticePeriodDays);

    record.status = input.status;
    record.reviewedBy = reviewerId as never;
    record.reviewedAt = new Date();
    if (input.reviewNote) record.reviewNote = input.reviewNote;
    await record.save();

    if (input.status === "accepted") {
      await Employee.findByIdAndUpdate(record.employee, { status: "notice_period" });
    }
    return Resignation.findById(id).populate(POP);
  }

  /** Withdraw a pending/accepted resignation; revert the employee to active if needed. */
  async withdraw(id: string) {
    const record = await Resignation.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
    if (!["pending", "accepted"].includes(record.status)) {
      throw Object.assign(new Error("Only a pending or accepted resignation can be withdrawn"), { statusCode: 400 });
    }
    const wasAccepted = record.status === "accepted";
    record.status = "withdrawn";
    await record.save();
    if (wasAccepted) await Employee.findByIdAndUpdate(record.employee, { status: "active" });
    return Resignation.findById(id).populate(POP);
  }

  /** Relieve an accepted resignation — employee is terminated. */
  async relieve(id: string, reviewerId: string) {
    const record = await Resignation.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
    if (record.status !== "accepted") {
      throw Object.assign(new Error("Only an accepted resignation can be relieved"), { statusCode: 400 });
    }
    record.status = "relieved";
    record.reviewedBy = reviewerId as never;
    record.reviewedAt = new Date();
    await record.save();
    await Employee.findByIdAndUpdate(record.employee, { status: "terminated" });
    return Resignation.findById(id).populate(POP);
  }

  /**
   * Record exit details on an accepted/relieved resignation. Ticking `left`
   * marks the employee as gone (status → terminated, resignation → relieved);
   * un-ticking reverts them to serving notice.
   */
  async setExitDetails(id: string, input: ExitDetailsInput) {
    const record = await Resignation.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
    if (!["accepted", "relieved"].includes(record.status)) {
      throw Object.assign(new Error("Accept the resignation before recording exit details"), { statusCode: 400 });
    }
    if (input.leavingDate !== undefined) record.leavingDate = input.leavingDate;
    if (input.finalSettlement !== undefined) record.finalSettlement = input.finalSettlement;
    if (input.noticePeriodServed !== undefined) record.noticePeriodServed = input.noticePeriodServed;

    if (input.left !== undefined) {
      record.left = input.left;
      if (input.left) {
        record.status = "relieved";
        if (!record.leavingDate) record.leavingDate = record.lastWorkingDay ?? new Date();
        await Employee.findByIdAndUpdate(record.employee, { status: "terminated" });
      } else {
        record.status = "accepted";
        await Employee.findByIdAndUpdate(record.employee, { status: "notice_period" });
      }
    }
    await record.save();
    return Resignation.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Resignation.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Resignation not found"), { statusCode: 404 });
  }

  /** Cron: relieve accepted resignations whose last working day has passed. */
  async autoRelieveDue(now = new Date()) {
    const due = await Resignation.find({ status: "accepted", lastWorkingDay: { $lte: now } }).select("_id employee");
    for (const r of due) {
      r.status = "relieved";
      r.reviewedAt = new Date();
      await r.save();
      await Employee.findByIdAndUpdate(r.employee, { status: "terminated" });
    }
    return due.length;
  }
}
