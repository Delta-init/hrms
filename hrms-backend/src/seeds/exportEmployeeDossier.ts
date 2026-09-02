/**
 * Everything the system and the migration source still know about one person.
 *
 * Written for the case a login was deleted: the User document is gone and
 * nothing in the database describes it any more, but the GreytHR exports the
 * migration was fed from are still on disk, and they hold the fields the
 * deleted row carried — the role, the department, the shift, the manager.
 *
 * Read-only. It reads the database and those spreadsheets and writes one file.
 *
 *     bun src/seeds/exportEmployeeDossier.ts E0122 [outputPath]
 */
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import path from "node:path";
import { connectDB } from "../config/database.js";
import { readSheet } from "./migrateGreytHR/read.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Payslip } from "../models/Payslip.js";
import { Attendance } from "../models/Attendance.js";

const DIR = `${process.env.HOME}/Downloads`;
/** Every GreytHR export the migration reads, so nothing about them is missed. */
const SHEETS = [
  "EmployeeBasicInformation.xlsx", "previousemployees (1).xlsx", "ResignationDetails.xlsx",
  "CurrentEmployeeCategory.xlsx", "employeecategorylist.xlsx", "orgtreehistory.xlsx",
  "latestsalaryrevision.xlsx", "leaveinfo.xlsx", "leavebalance.xlsx", "leavedetails.xlsx",
  "yearwiseleavebalance.xlsx", "CurrentCardDetails.xlsx", "VisaDetails.xlsx",
  "employeepermanentaddress.xlsx", "employeeemergencycontacts.xlsx", "qualificationdetails.xlsx",
];

async function main() {
  const code = (process.argv[2] ?? "").trim();
  if (!code) { console.error("Give an employee code, e.g. E0122"); process.exit(1); }
  const out = process.argv[3] ?? path.resolve(`dossier-${code}.xlsx`);
  await connectDB();

  const emp = await Employee.findOne({ employeeCode: code }).lean();
  if (!emp) { console.error(`No employee ${code}`); process.exit(1); }
  const book = XLSX.utils.book_new();

  // What the live database still holds.
  const live: Array<{ Field: string; Value: string }> = [];
  const push = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return;
    live.push({ Field: k, Value: v instanceof Date ? v.toISOString().slice(0, 10) : String(v) });
  };
  for (const [k, v] of Object.entries(emp)) {
    if (typeof v === "object" && v !== null && !(v instanceof Date)) continue;
    push(k, v);
  }
  const login = emp.user ? await User.findById(emp.user).select("name email status").lean() : null;
  push("— login account", login ? `${login.email} (${login.status})` : "NONE — deleted or never created");

  const [leaves, payslips, attendance] = await Promise.all([
    LeaveRequest.countDocuments({ $or: [{ user: emp.user }, { user: null }] , _id: { $exists: true } }).then(() => LeaveRequest.countDocuments({ user: emp.user })),
    Payslip.countDocuments({ employee: emp._id }),
    Attendance.countDocuments({ user: emp.user }),
  ]);
  push("— records: leave", leaves);
  push("— records: payslips", payslips);
  push("— records: attendance", attendance);

  const liveSheet = XLSX.utils.json_to_sheet(live);
  liveSheet["!cols"] = [{ wch: 26 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(book, liveSheet, "In the system now");

  // And what the migration source says, which is where the deleted login's
  // own fields survive.
  const name = String(emp.name ?? "");
  const match = (r: Record<string, string>) =>
    Object.values(r).some((v) => String(v).trim() === code) ||
    (name && Object.values(r).some((v) => String(v).trim().toLowerCase() === name.toLowerCase()));

  let found = 0;
  for (const file of SHEETS) {
    const rows = readSheet(DIR, file).filter(match);
    if (!rows.length) continue;
    found += rows.length;
    // One row per field so a wide GreytHR sheet stays readable, and several
    // matching rows (a leave ledger, a category history) stay distinguishable.
    const flat: Array<Record<string, string>> = rows.map((r) =>
      Object.fromEntries(Object.entries(r).filter(([, v]) => String(v).trim()))
    );
    const sheet = XLSX.utils.json_to_sheet(flat);
    XLSX.utils.book_append_sheet(book, sheet, file.replace(/\.xlsx$/i, "").replace(/[\\/?*[\]:]/g, " ").slice(0, 28));
    console.log(`  ${file}: ${rows.length} row(s)`);
  }

  XLSX.writeFile(book, out);
  console.log(`\n${found} source row(s) across ${book.SheetNames.length - 1} export(s)\nwritten: ${out}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
