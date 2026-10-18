import mongoose from "mongoose";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import { Attendance } from "../models/Attendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { JobRequisition } from "../models/JobRequisition.js";
import { Application } from "../models/Application.js";
import { Resignation } from "../models/Resignation.js";
import { PayrollBatch } from "../models/PayrollBatch.js";
import { Procurement } from "../models/Procurement.js";
import { OfficeKeepingRequest } from "../models/OfficeKeepingRequest.js";
import { Overtime } from "../models/Overtime.js";
import { Reimbursement } from "../models/Reimbursement.js";

/**
 * GET /api/v1/service/hrms-report?org&from&to — the Root portal's Reports →
 * HRMS tab (the user, 2026-10-18): what happened in one organization over a
 * period, each section by employee, by department and by month, with its rows —
 *
 *   attendance   attendance days in the period: present, late (and minutes),
 *                absent, half day, WFH, early out, hours worked
 *   leave        leave starting in the period: requests and how they were
 *                decided, days taken (approved), by type
 *   regularization  correction requests raised in the period, by type, how
 *                decided, escalated
 *   hiring       requisitions raised (headcount, approved, rejected, filled);
 *                candidates applying; offers sent and signed; people hired
 *   people       joiners (joining date in the period); exits by type, with
 *                who was relieved; headcount now by department
 *   payroll      the runs for the months in the period: employees, gross,
 *                deductions, net, and where each stands
 *   requests     purchase requests (cost, approved, received) and office
 *                keeping (raised, sorted) raised in the period
 *   claims       overtime (hours, amount) and reimbursements (claimed,
 *                approved, rejected) in the period
 *
 * Money in the organization's own currency. Read-only.
 */

const ROWS = 2000;
const UAE_MS = 4 * 3_600_000;
type Doc = Record<string, any>;
type Num = Record<string, number>;
const str = (v: unknown) => String(v ?? "");
const oid = (v: unknown) => (v ? String(v) : "");
const iso = (d: unknown) => (d ? new Date(d as Date).toISOString() : "");
const gulfDay = (d: Date) => new Date(d.getTime() + UAE_MS).toISOString().slice(0, 10);
const monthOf = (d: unknown) => (d ? gulfDay(new Date(d as Date)).slice(0, 7) : "");
const round = (n: number) => Math.round(n * 100) / 100;
const words = (s: unknown) => str(s).replace(/_/g, " ");
const toIds = (ids: Iterable<string>) => [...new Set(ids)].filter((x) => mongoose.isValidObjectId(x)).map((x) => new mongoose.Types.ObjectId(x));

/** Sums by person (and their department), by department and by month; the rows behind them, newest first. */
function grouper(blank: () => Num) {
  const people = new Map<string, Doc>(), teams = new Map<string, Doc>(), months = new Map<string, Doc>();
  const total = blank();
  const rows: Doc[] = [];
  const sum = (into: Doc, add: Num) => { for (const [k, v] of Object.entries(add)) into[k] = round((into[k] ?? 0) + v); };
  return {
    add(p: { id: string; name: string; team: string }, at: unknown, add: Num, row?: Doc) {
      const pk = p.id || p.name || "—";
      const person = people.get(pk) ?? { id: pk, name: p.name || "—", team: p.team, ...blank() };
      sum(person, add); people.set(pk, person);
      const tk = p.team || "No department";
      const team = teams.get(tk) ?? { team: tk, ...blank() };
      sum(team, add); teams.set(tk, team);
      const m = typeof at === "string" && /^\d{4}-\d{2}/.test(at) ? at.slice(0, 7) : monthOf(at);
      if (m) { const mo = months.get(m) ?? { month: m, ...blank() }; sum(mo, add); months.set(m, mo); }
      sum(total, add);
      if (row) rows.push({ owner_id: pk, owner: p.name || "—", team: tk, ...row });
    },
    out(sortKey: string) {
      const by = (a: Doc, b: Doc) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0) || str(a.name ?? a.team).localeCompare(str(b.name ?? b.team));
      return {
        total, people: [...people.values()].sort(by), teams: [...teams.values()].sort(by),
        months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
        rows: rows.sort((a, b) => str(b.at).localeCompare(str(a.at))).slice(0, ROWS),
      };
    },
  };
}
const bars = (m: Map<string, number>) => [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
const tally = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

export async function hrmsReportForPortal(q: { org?: string; from?: string; to?: string }, now = new Date()) {
  const orgs = (await Organization.find({ status: { $ne: "inactive" } }).select("name code currency").sort({ createdAt: 1 }).lean()) as Doc[];
  if (!orgs.length) return "No organization here";
  const org = q.org ? orgs.find((o) => String(o._id) === q.org) : orgs[0];
  if (!org) return "No such organization";
  const from = q.from ? new Date(q.from) : null, to = q.to ? new Date(q.to) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return "from / to must be dates";
  if (from && to && from > to) return "from is after to";
  const currency = str(org.currency || "AED");
  // One organization: everything. Several: each its own, and records from before organizations (none set) count
  // in the first.
  const orgMatch = orgs.length === 1 ? {} : String(org._id) === String(orgs[0]._id)
    ? { organization: { $in: [org._id, null] } } : { organization: org._id };
  const range = from || to ? { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } : null;
  const within = (field: string) => (range ? { [field]: range } : {});
  const fromDay = from ? gulfDay(from) : "", toDay = to ? gulfDay(to) : "";
  const fromMonth = fromDay.slice(0, 7), toMonth = toDay.slice(0, 7);

  const [attendance, leave, regularization, requisitions, applications, joiners, exits, payroll, procurement, office, overtime, claims, staffNow] = await Promise.all([
    Attendance.find({ ...orgMatch, ...(range ? { $or: [{ localDay: { ...(fromDay ? { $gte: fromDay } : {}), ...(toDay ? { $lte: toDay } : {}) } }, { localDay: null, date: range }] } : {}) })
      .select("user date localDay status workedMinutes lateMinutes checkIn checkOut").lean<Doc[]>(),
    LeaveRequest.find({ ...orgMatch, ...within("startDate") }).select("user type days startDate endDate halfDay status reviewedAt createdAt").lean<Doc[]>(),
    Regularization.find({ ...orgMatch, ...within("createdAt") }).select("user type date status escalated reviewedAt createdAt resultingStatus").lean<Doc[]>(),
    JobRequisition.find({ ...orgMatch, ...within("createdAt") }).select("title type department headcount raisedBy status rejectedBy createdAt").lean<Doc[]>(),
    Application.find({ ...orgMatch, ...(range ? { $or: [{ createdAt: range }, { "offer.sentAt": range }, { "offer.signedAt": range }, { stageHistory: { $elemMatch: { stage: "hired", at: range } } }] } : {}) })
      .select("requisition candidate stage status offer.sentAt offer.signedAt stageHistory movedToEmployee createdAt").lean<Doc[]>(),
    Employee.find({ ...orgMatch, ...within("joiningDate") }).select("user name employeeCode department joiningDate status employmentType").lean<Doc[]>(),
    Resignation.find({ ...orgMatch, ...(range ? { $or: [{ resignationDate: range }, { lastWorkingDay: range }] } : {}) })
      .select("employee user resignationType resignationDate lastWorkingDay status reason").lean<Doc[]>(),
    PayrollBatch.find({ ...orgMatch, ...(fromMonth || toMonth ? { month: { ...(fromMonth ? { $gte: fromMonth } : {}), ...(toMonth ? { $lte: toMonth } : {}) } } : {}) })
      .select("month currency status employeeCount grossTotal deductionTotal netTotal submittedBy submittedAt approvedAt paidAt returnedAt returnReason").lean<Doc[]>(),
    Procurement.find({ ...orgMatch, ...within("createdAt") }).select("item category quantity estimatedCost currency department requestedBy status rejectedBy createdAt").lean<Doc[]>(),
    OfficeKeepingRequest.find({ ...orgMatch, ...within("createdAt") }).select("issue location requestedBy handledBy status history createdAt").lean<Doc[]>(),
    Overtime.find({ ...orgMatch, ...within("date") }).select("employee user date hours amount month applied").lean<Doc[]>(),
    Reimbursement.find({ ...orgMatch, ...within("expenseDate") }).select("employee user category title amount expenseDate status reviewedAt").lean<Doc[]>(),
    Employee.find({ ...orgMatch, status: { $in: ["active", "probation", "on_leave", "notice_period"] } }).select("department").lean<Doc[]>(),
  ]);

  // Everyone named, and their department through their employee record.
  const userIds = new Set<string>(), employeeIds = new Set<string>();
  for (const d of [...attendance, ...leave, ...regularization]) userIds.add(oid(d.user));
  for (const d of requisitions) userIds.add(oid(d.raisedBy));
  for (const d of procurement) userIds.add(oid(d.requestedBy));
  for (const d of office) { userIds.add(oid(d.requestedBy)); userIds.add(oid(d.handledBy)); }
  for (const d of payroll) userIds.add(oid(d.submittedBy));
  for (const d of [...exits, ...overtime, ...claims]) { userIds.add(oid(d.user)); employeeIds.add(oid(d.employee)); }
  const [users, employees, candidates, reqsOfApps] = await Promise.all([
    User.find({ _id: { $in: toIds(userIds) } }).select("name email").lean<Doc[]>(),
    Employee.find({ $or: [{ user: { $in: toIds(userIds) } }, { _id: { $in: toIds(employeeIds) } }] }).select("user name employeeCode department").lean<Doc[]>(),
    mongoose.connection.collection("candidates").find({ _id: { $in: toIds(applications.map((a) => oid(a.candidate))) } }, { projection: { name: 1 } }).toArray(),
    JobRequisition.find({ _id: { $in: toIds(applications.map((a) => oid(a.requisition))) } }).select("title department").lean<Doc[]>(),
  ]);
  const deptIds = new Set<string>([...employees, ...joiners, ...staffNow, ...requisitions, ...procurement, ...reqsOfApps].map((d) => oid(d.department)));
  const depts = await Department.find({ _id: { $in: toIds(deptIds) } }).select("name").lean<Doc[]>();
  const deptName = new Map(depts.map((d) => [String(d._id), str(d.name)]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const empByUser = new Map(employees.filter((e) => e.user).map((e) => [oid(e.user), e]));
  const empById = new Map(employees.map((e) => [String(e._id), e]));
  const candName = new Map(candidates.map((c) => [String(c._id), str(c.name)]));
  const reqById = new Map(reqsOfApps.map((r) => [String(r._id), r]));

  /** A person by their user account (or employee record): name and department. */
  const who = (userId: unknown, employeeId?: unknown) => {
    const e = empByUser.get(oid(userId)) ?? empById.get(oid(employeeId));
    const id = oid(userId) || oid(e?.user) || oid(employeeId);
    return { id, name: str(userById.get(id)?.name || e?.name) || (id ? "Unknown" : "—"), team: deptName.get(oid(e?.department)) ?? "" };
  };

  /* ── Attendance ── */
  const att = grouper(() => ({ days: 0, present: 0, late: 0, late_minutes: 0, absent: 0, half_day: 0, wfh: 0, early_out: 0, on_leave: 0, worked_minutes: 0 }));
  const WORKING = new Set(["present", "late", "half_day", "early_out", "wfh"]);
  for (const a of attendance) {
    const s = str(a.status || "present");
    if (s === "holiday" || s === "weekend") continue;
    const dayKey = str(a.localDay) || gulfDay(new Date(a.date));
    const add: Num = { days: WORKING.has(s) ? 1 : 0, present: s === "present" ? 1 : 0, late: s === "late" ? 1 : 0, late_minutes: Number(a.lateMinutes) || 0,
      absent: s === "absent" ? 1 : 0, half_day: s === "half_day" ? 1 : 0, wfh: s === "wfh" ? 1 : 0, early_out: s === "early_out" ? 1 : 0, on_leave: s === "on_leave" ? 1 : 0,
      worked_minutes: Number(a.workedMinutes) || 0 };
    // The list keeps the days that need a look: late, absent, half day, early out.
    const listed = s === "late" || s === "absent" || s === "half_day" || s === "early_out";
    att.add(who(a.user), dayKey, add, listed ? { at: `${dayKey}T12:00:00.000Z`, id: String(a._id), day: dayKey, status: s, late_minutes: Number(a.lateMinutes) || 0,
      worked_minutes: Number(a.workedMinutes) || 0, check_in: iso(a.checkIn), check_out: iso(a.checkOut) } : undefined);
  }

  /* ── Leave ── */
  const lv = grouper(() => ({ requests: 0, approved: 0, rejected: 0, cancelled: 0, pending: 0, days: 0 }));
  const leaveTypes = new Map<string, number>();
  for (const l of leave) {
    const s = str(l.status), days = Number(l.days) || 0;
    if (s === "approved") tally(leaveTypes, words(l.type), days);
    lv.add(who(l.user), l.startDate, { requests: 1, approved: s === "approved" ? 1 : 0, rejected: s === "rejected" ? 1 : 0, cancelled: s === "cancelled" ? 1 : 0,
      pending: s === "pending" ? 1 : 0, days: s === "approved" ? days : 0 },
      { at: iso(l.startDate), id: String(l._id), type: words(l.type), from: gulfDay(new Date(l.startDate)), to: l.endDate ? gulfDay(new Date(l.endDate)) : "", days, half_day: !!l.halfDay, status: s });
  }

  /* ── Regularization ── */
  const rg = grouper(() => ({ requests: 0, approved: 0, rejected: 0, pending: 0, escalated: 0 }));
  const regTypes = new Map<string, number>();
  for (const r of regularization) {
    const s = str(r.status);
    tally(regTypes, words(r.type));
    rg.add(who(r.user), r.createdAt, { requests: 1, approved: s === "approved" ? 1 : 0, rejected: s === "rejected" ? 1 : 0, pending: s === "pending" ? 1 : 0, escalated: r.escalated ? 1 : 0 },
      { at: iso(r.createdAt), id: String(r._id), type: words(r.type), day: r.date ? gulfDay(new Date(r.date)) : "", becomes: words(r.resultingStatus || "present"), status: s, escalated: !!r.escalated });
  }

  /* ── Hiring ── */
  const hr = grouper(() => ({ requisitions: 0, headcount: 0, approved: 0, rejected: 0, filled: 0, applications: 0, offers_sent: 0, offers_signed: 0, hired: 0 }));
  const stages = new Map<string, number>();
  const inRange = (d: unknown) => { if (!d) return false; const t = new Date(d as Date).getTime(); return (!from || t >= from.getTime()) && (!to || t <= to.getTime()); };
  for (const r of requisitions) {
    const s = str(r.status), raiser = who(r.raisedBy);
    hr.add({ ...raiser, team: deptName.get(oid(r.department)) ?? raiser.team }, r.createdAt, { requisitions: 1, headcount: Number(r.headcount) || 1,
      approved: s === "approved" || s === "filled" ? 1 : 0, rejected: s === "rejected" ? 1 : 0, filled: s === "filled" ? 1 : 0 },
      { at: iso(r.createdAt), id: String(r._id), kind: "requisition", title: str(r.title), detail: `${Number(r.headcount) || 1} · ${words(r.type)}`, status: words(s) });
  }
  for (const a of applications) {
    const req = reqById.get(oid(a.requisition));
    const team = deptName.get(oid(req?.department)) ?? "";
    const hiredAt = (a.stageHistory ?? []).find((h: Doc) => h.stage === "hired")?.at;
    const add: Num = {
      applications: !range || inRange(a.createdAt) ? 1 : 0,
      offers_sent: inRange(a.offer?.sentAt) || (!range && a.offer?.sentAt) ? 1 : 0,
      offers_signed: inRange(a.offer?.signedAt) || (!range && a.offer?.signedAt) ? 1 : 0,
      hired: (hiredAt && (!range || inRange(hiredAt))) ? 1 : 0,
    };
    if (add.applications) tally(stages, words(a.status === "active" ? a.stage : a.status));
    // A candidate is not an employee: counted against the vacancy's department, not a person.
    hr.add({ id: "", name: "Candidates", team }, a.createdAt, add,
      { at: iso(hiredAt ?? a.offer?.signedAt ?? a.offer?.sentAt ?? a.createdAt), id: String(a._id), kind: "candidate", title: candName.get(oid(a.candidate)) ?? "Candidate",
        detail: str(req?.title), status: words(a.status === "active" ? a.stage : a.status) });
  }

  /* ── Joiners and leavers ── */
  const pp = grouper(() => ({ joined: 0, exits: 0, resignations: 0, terminations: 0, other_exits: 0, relieved: 0 }));
  const exitTypes = new Map<string, number>();
  for (const e of joiners) {
    pp.add({ id: oid(e.user) || String(e._id), name: str(e.name), team: deptName.get(oid(e.department)) ?? "" }, e.joiningDate, { joined: 1 },
      { at: iso(e.joiningDate), id: String(e._id), kind: "joined", detail: `${str(e.employeeCode)} · ${words(e.employmentType || "full_time")}`, status: words(e.status) });
  }
  for (const x of exits) {
    const t = str(x.resignationType || "resignation"), s = str(x.status);
    const raised = !range || inRange(x.resignationDate), relieved = s === "relieved" && (!range || inRange(x.lastWorkingDay));
    if (raised) tally(exitTypes, words(t));
    pp.add(who(x.user, x.employee), x.resignationDate, { exits: raised ? 1 : 0, resignations: raised && t === "resignation" ? 1 : 0,
      terminations: raised && t === "termination" ? 1 : 0, other_exits: raised && t !== "resignation" && t !== "termination" ? 1 : 0, relieved: relieved ? 1 : 0 },
      { at: iso(x.resignationDate), id: String(x._id), kind: words(t), detail: `last day ${x.lastWorkingDay ? gulfDay(new Date(x.lastWorkingDay)) : "—"}`, status: s });
  }
  const headcount = new Map<string, number>();
  for (const e of staffNow) tally(headcount, deptName.get(oid(e.department)) ?? "No department");

  /* ── Payroll ── */
  const pr = grouper(() => ({ runs: 0, employees: 0, gross: 0, deductions: 0, net: 0, paid: 0 }));
  for (const b of payroll) {
    const s = str(b.status);
    // Each run (the person view, named by its month) and by where it stands (the department view).
    const runName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${b.month}-01T00:00:00Z`));
    pr.add({ id: str(b.month), name: runName, team: words(s) }, `${b.month}-15`, { runs: 1, employees: Number(b.employeeCount) || 0, gross: Number(b.grossTotal) || 0,
      deductions: Number(b.deductionTotal) || 0, net: Number(b.netTotal) || 0, paid: s === "paid" ? Number(b.netTotal) || 0 : 0 },
      { at: `${b.month}-01T00:00:00.000Z`, id: String(b._id), month: str(b.month), currency: str(b.currency || currency), status: s, employees: Number(b.employeeCount) || 0,
        gross: Number(b.grossTotal) || 0, deductions: Number(b.deductionTotal) || 0, net: Number(b.netTotal) || 0, submitted_by: who(b.submittedBy).name,
        paid_at: iso(b.paidAt), returned: str(b.returnReason) });
  }

  /* ── Purchase requests and office keeping ── */
  const rq = grouper(() => ({ purchases: 0, cost: 0, approved: 0, rejected: 0, received: 0, office: 0, sorted: 0 }));
  const categories = new Map<string, number>();
  for (const p of procurement) {
    const s = str(p.status), r = who(p.requestedBy), cost = Number(p.estimatedCost) || 0;
    tally(categories, words(p.category || "other"));
    rq.add({ ...r, team: deptName.get(oid(p.department)) ?? r.team }, p.createdAt, { purchases: 1, cost, approved: ["approved", "ordered", "received"].includes(s) ? 1 : 0,
      rejected: s === "rejected" ? 1 : 0, received: s === "received" ? 1 : 0 },
      { at: iso(p.createdAt), id: String(p._id), kind: "purchase", title: str(p.item), detail: `${Number(p.quantity) || 1} × · ${words(p.category)}`, cost, status: words(s) });
  }
  for (const o of office) {
    const s = str(o.status);
    rq.add(who(o.requestedBy), o.createdAt, { office: 1, sorted: s === "sorted" ? 1 : 0 },
      { at: iso(o.createdAt), id: String(o._id), kind: "office keeping", title: str(o.issue), detail: str(o.location), status: words(s),
        handled_by: o.handledBy ? who(o.handledBy).name : "" });
  }

  /* ── Overtime and reimbursements ── */
  const cl = grouper(() => ({ overtime_hours: 0, overtime_amount: 0, claims: 0, claimed: 0, approved: 0, rejected: 0 }));
  const claimCats = new Map<string, number>();
  for (const o of overtime) {
    cl.add(who(o.user, o.employee), o.date, { overtime_hours: Number(o.hours) || 0, overtime_amount: Number(o.amount) || 0 },
      { at: iso(o.date), id: String(o._id), kind: "overtime", title: `${Number(o.hours) || 0} h`, amount: Number(o.amount) || 0, status: o.applied ? "on a payslip" : "not yet paid" });
  }
  for (const c of claims) {
    const s = str(c.status), amt = Number(c.amount) || 0;
    tally(claimCats, words(c.category || "other"), amt);
    cl.add(who(c.user, c.employee), c.expenseDate, { claims: 1, claimed: amt, approved: s === "approved" || s === "paid" ? amt : 0, rejected: s === "rejected" ? 1 : 0 },
      { at: iso(c.expenseDate), id: String(c._id), kind: "reimbursement", title: str(c.title), detail: words(c.category), amount: amt, status: s });
  }

  return {
    generatedAt: now.toISOString(),
    organizations: orgs.map((o) => ({ id: String(o._id), name: str(o.name), currency: str(o.currency || "AED") })),
    org: { id: String(org._id), name: str(org.name), currency },
    period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
    attendance: att.out("days"),
    leave: { ...lv.out("days"), types: bars(leaveTypes) },
    regularization: { ...rg.out("requests"), types: bars(regTypes) },
    hiring: { ...hr.out("requisitions"), stages: bars(stages) },
    people: { ...pp.out("joined"), exitTypes: bars(exitTypes), headcount: bars(headcount) },
    payroll: pr.out("net"),
    requests: { ...rq.out("purchases"), categories: bars(categories) },
    claims: { ...cl.out("claimed"), categories: bars(claimCats) },
  };
}
