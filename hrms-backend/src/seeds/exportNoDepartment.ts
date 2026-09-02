/**
 * The active employees with no department, as a spreadsheet.
 *
 * They are invisible to every department filter, absent from every
 * department's page, and no department head is ever told about their leave —
 * so the gap is worth looking at as a list rather than as a number.
 *
 * Read-only: it reads and writes a file, and changes nothing in the database.
 *
 *     bun src/seeds/exportNoDepartment.ts [outputPath]
 */
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import path from "node:path";
import { connectDB } from "../config/database.js";
import { Organization } from "../models/Organization.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Department } from "../models/Department.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Attendance } from "../models/Attendance.js";

const day = (d?: Date | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)) : "";

async function main() {
  await connectDB();
  const out = process.argv[2] ?? path.resolve("employees-without-department.xlsx");
  const book = XLSX.utils.book_new();

  for (const org of await Organization.find({ status: "active" }).select("_id name").lean()) {
    const missing = await Employee.find({
      organization: org._id,
      status: { $ne: "terminated" },
      $or: [{ department: null }, { department: { $exists: false } }],
    })
      .select("name employeeCode designation email user joiningDate status workMode reportingTo reportingToKind")
      .sort({ employeeCode: 1 })
      .lean();
    if (!missing.length) continue;

    // Everything the reader would otherwise have to look up one at a time:
    // whether they can even sign in, what shift they are on, and whether they
    // have anything waiting — the three things that decide how urgent each row is.
    const userIds = missing.filter((e) => e.user).map((e) => e.user);
    const users = await User.find({ _id: { $in: userIds } }).select("email status workSchedule").lean();
    const byUser = new Map(users.map((u) => [String(u._id), u]));
    const schedules = await WorkSchedule.find({ organization: org._id }).select("name loginTime logoutTime timeZone").lean();
    const bySchedule = new Map(schedules.map((w) => [String(w._id), w]));
    // `reportingTo` points at either an Employee record or a login, so both are
    // looked up — reading only one silently leaves the column blank for
    // everybody stored the other way.
    const managerIds = missing.map((e) => e.reportingTo).filter(Boolean);
    const [mgrEmployees, mgrUsers] = await Promise.all([
      Employee.find({ _id: { $in: managerIds } }).select("name").lean(),
      User.find({ _id: { $in: managerIds } }).select("name").lean(),
    ]);
    const byManager = new Map<string, string>([
      ...mgrEmployees.map((m) => [String(m._id), String(m.name ?? "")] as const),
      ...mgrUsers.map((m) => [String(m._id), String(m.name ?? "")] as const),
    ]);

    const pending = await LeaveRequest.find({ organization: org._id, status: "pending", user: { $in: userIds } })
      .select("user").lean();
    const pendingBy = pending.reduce<Record<string, number>>((a, r) => {
      a[String(r.user)] = (a[String(r.user)] ?? 0) + 1;
      return a;
    }, {});

    // A recent punch says the person is really working, which is what makes an
    // unassigned row worth chasing rather than archiving.
    const since = new Date(Date.now() - 30 * 86_400_000);
    const recent = await Attendance.find({ organization: org._id, user: { $in: userIds }, date: { $gte: since } })
      .select("user").lean();
    const activeUsers = new Set(recent.map((a) => String(a.user)));

    const rows = missing.map((e) => {
      const u = e.user ? byUser.get(String(e.user)) : null;
      const ws = u?.workSchedule ? bySchedule.get(String(u.workSchedule)) : null;
      return {
        "Employee Code": e.employeeCode ?? "",
        Name: e.name ?? "",
        Designation: e.designation ?? "",
        Department: "",                        // ← the column to fill in
        Email: u?.email ?? e.email ?? "",
        "Has Login": e.user ? "Yes" : "No",
        "Login Status": u?.status ?? (e.user ? "" : "no account"),
        "Work Schedule": ws?.name ?? "",
        Shift: ws ? `${ws.loginTime}–${ws.logoutTime} ${ws.timeZone}` : "",
        "Reporting Manager": e.reportingTo ? byManager.get(String(e.reportingTo)) ?? "" : "",
        "Work Mode": e.workMode ?? "",
        Joined: day(e.joiningDate as Date | null),
        "Pending Leave": e.user ? pendingBy[String(e.user)] ?? 0 : 0,
        "Punched Last 30d": e.user && activeUsers.has(String(e.user)) ? "Yes" : "No",
      };
    });

    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 14 }, { wch: 34 }, { wch: 30 }, { wch: 24 }, { wch: 32 }, { wch: 10 },
      { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 26 }, { wch: 11 }, { wch: 14 },
      { wch: 13 }, { wch: 16 },
    ];
    // Excel caps a sheet name at 31 characters and rejects several punctuation
    // marks outright, so the organisation name is trimmed rather than trusted.
    const tab = org.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 28);
    XLSX.utils.book_append_sheet(book, sheet, tab || "Sheet1");
    console.log(`${org.name}: ${rows.length} employee(s) with no department`);
  }

  // A reference tab, so whoever fills the Department column is choosing from
  // the names that exist rather than inventing new ones a second time.
  const depts = await Department.find({}).select("name code organization").sort({ name: 1 }).lean();
  const orgNames = new Map(
    (await Organization.find({}).select("name").lean()).map((o) => [String(o._id), o.name])
  );
  const deptSheet = XLSX.utils.json_to_sheet(
    depts.map((d) => ({
      Department: d.name,
      Code: d.code ?? "",
      Organisation: d.organization ? orgNames.get(String(d.organization)) ?? "" : "",
    }))
  );
  deptSheet["!cols"] = [{ wch: 34 }, { wch: 12 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(book, deptSheet, "Departments (reference)");

  XLSX.writeFile(book, out);
  console.log(`\nwritten: ${out}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
