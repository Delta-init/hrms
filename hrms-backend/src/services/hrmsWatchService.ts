import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { JobRequisition } from "../models/JobRequisition.js";
import { OfficeKeepingRequest } from "../models/OfficeKeepingRequest.js";
import { Procurement } from "../models/Procurement.js";

/**
 * GET /api/v1/service/hrms-watch — the Root portal's Pending → HRMS tab (the
 * user, 2026-10-17): what is waiting in HRMS, each with the requester's
 * department —
 *
 *   leave            leave requests pending a decision
 *   regularization   attendance corrections pending a decision
 *   hiring           requisitions pending — with HR, or past HR and waiting
 *                    on finance (finance_pending)
 *   office keeping   requests not sorted yet — requested, or on the way
 *   procurement      purchase requests not finished — with HR, with finance,
 *                    approved and to be ordered, ordered and not received
 *   on leave today   approved leave covering today (Gulf day)
 *
 * A person's department is their employee record's; hiring and procurement
 * carry their own. Read-only.
 */

const UAE_MS = 4 * 3_600_000;
const LIMIT = 2000;
type Doc = Record<string, any>;

/** Today's Gulf day as [start, end) instants, and as YYYY-MM-DD. */
function gulfToday(now: number) {
  const ymd = new Date(now + UAE_MS).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${ymd}T00:00:00Z`) - UAE_MS);
  return { ymd, start, end: new Date(start.getTime() + 86_400_000) };
}
const iso = (d: unknown) => (d ? new Date(d as Date).toISOString() : "");
const day = (d: unknown) => (d ? new Date(new Date(d as Date).getTime() + UAE_MS).toISOString().slice(0, 10) : "");
const str = (v: unknown) => String(v ?? "");
const oid = (v: unknown) => (v ? String(v) : "");

export async function hrmsWatchForPortal(now = Date.now()) {
  const today = gulfToday(now);
  const [leave, regularization, hiring, officeKeeping, procurement, onLeave] = await Promise.all([
    LeaveRequest.find({ status: "pending" }).sort({ createdAt: 1 }).limit(LIMIT)
      .select("user type days startDate endDate reason halfDay createdAt").lean<Doc[]>(),
    Regularization.find({ status: "pending" }).sort({ createdAt: 1 }).limit(LIMIT)
      .select("user type date resultingStatus reason escalated createdAt").lean<Doc[]>(),
    JobRequisition.find({ status: { $in: ["pending", "finance_pending"] } }).sort({ createdAt: 1 }).limit(LIMIT)
      .select("title type headcount department raisedBy status budgetApprovalRequired createdAt").lean<Doc[]>(),
    OfficeKeepingRequest.find({ status: { $in: ["requested", "arriving"] } }).sort({ createdAt: 1 }).limit(LIMIT)
      .select("issue location requestedBy handledBy status createdAt").lean<Doc[]>(),
    Procurement.find({ status: { $in: ["requested", "hr_approved", "approved", "ordered"] } }).sort({ createdAt: 1 }).limit(LIMIT)
      .select("item kind category quantity estimatedCost currency vendor department requestedBy neededBy status createdAt").lean<Doc[]>(),
    LeaveRequest.find({ status: "approved", startDate: { $lt: today.end }, endDate: { $gte: today.start } }).limit(LIMIT)
      .select("user type days startDate endDate halfDay").lean<Doc[]>(),
  ]);

  // Everybody named, and their department through their employee record.
  const userIds = new Set<string>();
  for (const d of [...leave, ...regularization, ...onLeave]) userIds.add(oid(d.user));
  for (const d of hiring) userIds.add(oid(d.raisedBy));
  for (const d of officeKeeping) { userIds.add(oid(d.requestedBy)); userIds.add(oid(d.handledBy)); }
  for (const d of procurement) userIds.add(oid(d.requestedBy));
  userIds.delete("");
  const ids = [...userIds].filter((x) => mongoose.isValidObjectId(x)).map((x) => new mongoose.Types.ObjectId(x));
  const [users, employees] = await Promise.all([
    User.find({ _id: { $in: ids } }).select("name email status").lean<Doc[]>(),
    Employee.find({ user: { $in: ids } }).select("user department name employeeCode").lean<Doc[]>(),
  ]);
  const deptIds = new Set<string>(employees.map((e) => oid(e.department)));
  for (const d of [...hiring, ...procurement]) deptIds.add(oid(d.department));
  deptIds.delete("");
  const depts = await Department.find({ _id: { $in: [...deptIds].map((x) => new mongoose.Types.ObjectId(x)) } }).select("name").lean<Doc[]>();
  const deptName = new Map(depts.map((d) => [String(d._id), str(d.name)]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const empByUser = new Map(employees.map((e) => [oid(e.user), e]));

  const who = (userId: unknown) => {
    const id = oid(userId);
    const u = userById.get(id), e = empByUser.get(id);
    return {
      personId: id,
      person: str(u?.name || e?.name) || (id ? "Unknown" : "—"),
      email: str(u?.email).toLowerCase(),
      code: str(e?.employeeCode),
      department: deptName.get(oid(e?.department)) ?? "",
    };
  };
  const ownDept = (d: Doc, fallback: string) => deptName.get(oid(d.department)) ?? fallback;

  const leaveRows = leave.map((d) => ({
    id: String(d._id), ...who(d.user), type: str(d.type).replace(/_/g, " "), days: Number(d.days) || 0, halfDay: !!d.halfDay,
    from: day(d.startDate), to: day(d.endDate), reason: str(d.reason), raisedAt: iso(d.createdAt),
  }));
  const regularizationRows = regularization.map((d) => ({
    id: String(d._id), ...who(d.user), type: str(d.type).replace(/_/g, " "), date: day(d.date),
    becomes: str(d.resultingStatus || "present").replace(/_/g, " "), reason: str(d.reason), escalated: !!d.escalated, raisedAt: iso(d.createdAt),
  }));
  const hiringRows = hiring.map((d) => {
    const raiser = who(d.raisedBy);
    return {
      id: String(d._id), title: str(d.title), type: str(d.type).replace(/_/g, " "), headcount: Number(d.headcount) || 1,
      department: ownDept(d, raiser.department), personId: raiser.personId, person: raiser.person, email: raiser.email,
      stage: d.status === "finance_pending" ? "with_finance" : "with_hr", raisedAt: iso(d.createdAt),
    };
  });
  const officeRows = officeKeeping.map((d) => {
    const handler = oid(d.handledBy) ? who(d.handledBy).person : "";
    return {
      id: String(d._id), ...who(d.requestedBy), issue: str(d.issue), location: str(d.location),
      stage: str(d.status), handledBy: handler, raisedAt: iso(d.createdAt),
    };
  });
  const STAGE: Record<string, string> = { requested: "with_hr", hr_approved: "with_finance", approved: "to_order", ordered: "ordered" };
  const procurementRows = procurement.map((d) => {
    const r = who(d.requestedBy);
    return {
      id: String(d._id), item: str(d.item), category: str(d.category), quantity: Number(d.quantity) || 1,
      estimatedCost: Number(d.estimatedCost) || 0, currency: str(d.currency || "AED"), vendor: str(d.vendor),
      department: ownDept(d, r.department), personId: r.personId, person: r.person, email: r.email,
      stage: STAGE[str(d.status)] ?? str(d.status), neededBy: day(d.neededBy), raisedAt: iso(d.createdAt),
    };
  });
  const onLeaveRows = onLeave.map((d) => ({
    id: String(d._id), ...who(d.user), type: str(d.type).replace(/_/g, " "), days: Number(d.days) || 0, halfDay: !!d.halfDay,
    from: day(d.startDate), to: day(d.endDate),
  })).sort((a, b) => a.department.localeCompare(b.department) || a.person.localeCompare(b.person));

  // Office keeping and procurement's own stages: "pending" means waiting on a decision.
  const counts = {
    leave: leaveRows.length,
    regularization: regularizationRows.length,
    hiring: hiringRows.length,
    hiring_with_finance: hiringRows.filter((r) => r.stage === "with_finance").length,
    office_keeping: officeRows.length,
    office_keeping_arriving: officeRows.filter((r) => r.stage === "arriving").length,
    procurement: procurementRows.length,
    procurement_waiting: procurementRows.filter((r) => r.stage === "with_hr" || r.stage === "with_finance").length,
    on_leave_today: onLeaveRows.length,
  };
  return {
    generatedAt: new Date(now).toISOString(),
    today: today.ymd,
    counts,
    items: { leave: leaveRows, regularization: regularizationRows, hiring: hiringRows, officeKeeping: officeRows, procurement: procurementRows, onLeaveToday: onLeaveRows },
  };
}
