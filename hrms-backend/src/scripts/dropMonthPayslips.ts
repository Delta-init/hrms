/**
 * Take people off one month's payroll: delete their payslips for that month
 * (the user, 2026-10-30: five people were on October's handover though the
 * final salary sheet did not have them — the sheet import leaves anybody not in
 * it alone, so payslips made earlier by Run payroll or an earlier upload went to
 * accounts with the rest).
 *
 * Name them, or hand it the salary sheet and it takes off everybody on the
 * month who is not in it:
 *
 *   bun src/scripts/dropMonthPayslips.ts --month 2026-10 --codes E0016,E0133,E0155,E0192,E0194
 *   bun src/scripts/dropMonthPayslips.ts --month 2026-10 --sheet "/path/Salary sheet Oct 2026.xlsx"
 *
 * Lists what it would delete and changes nothing without --apply. With --apply
 * each payslip goes the way the Delete button takes it — anything it took from
 * a loan, an advance or a one-time item is handed back first — and with
 * --submit too, the month then goes to accounts again (as whoever submitted it
 * last), ready for finance to import.
 *
 * Only while HR may edit the month: draft, or returned by accounts. A month
 * accounts hold has to be sent back from finance first (the run's "Send back to
 * HR"); a submitted one, recalled on the Payroll page. A paid payslip is never
 * deleted. --org <HRMS organization id> when an employee code is in more than
 * one organization.
 *
 * Run it from hrms-backend on the server: it reads MONGODB_URI from the .env there.
 */
import mongoose, { Types } from "mongoose";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { Employee } from "../models/Employee.js";
import { Payslip } from "../models/Payslip.js";
import { PayrollBatch } from "../models/PayrollBatch.js";
import { runWithOrg } from "../utils/orgContext.js";
import { PayslipService } from "../services/payslipService.js";
import { payrollBatchService } from "../services/payrollBatchService.js";

const CODE = /^[A-Z]\d{4}$/;
const EDITABLE = ["draft", "returned"];

/** Every employee code in a salary sheet: the "Employee No" column, wherever its header row is. */
export function sheetCodes(file: string): Set<string> {
  const wb = XLSX.read(readFileSync(file));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, blankrows: false });
  const header = rows.findIndex((r) => r.some((c) => String(c ?? "").trim().toLowerCase() === "employee no"));
  if (header < 0) throw new Error(`No "Employee No" column in ${file}`);
  const col = rows[header]!.findIndex((c) => String(c ?? "").trim().toLowerCase() === "employee no");
  return new Set(rows.slice(header + 1).map((r) => String(r[col] ?? "").trim().toUpperCase()).filter((c) => CODE.test(c)));
}

export interface Planned {
  payslipId: string;
  organization: string;
  employeeCode: string;
  name: string;
  status: string;
  currency: string;
  netPay: number;
  paid: boolean;
}

/**
 * The month's payslips to take off: those of the codes named, or of everybody
 * not in the sheet. A code that matches no payslip this month is reported.
 */
export async function plan(month: string, opts: { codes?: string[]; keep?: Set<string>; orgId?: string }) {
  const orgFilter = opts.orgId ? { organization: new Types.ObjectId(opts.orgId) } : {};
  const slips = await Payslip.find({ month, ...orgFilter }).select("employee organization status currency netPay paidAt").lean();
  const emps = await Employee.find({ _id: { $in: slips.map((s) => s.employee) } }).select("employeeCode name").lean();
  const empById = new Map(emps.map((e) => [String(e._id), e]));
  const want = opts.codes ? new Set(opts.codes.map((c) => c.trim().toUpperCase())) : null;
  const picked: Planned[] = [];
  for (const s of slips) {
    const e = empById.get(String(s.employee));
    const code = String(e?.employeeCode ?? "").toUpperCase();
    const take = want ? want.has(code) : !!opts.keep && !opts.keep.has(code);
    if (!take) continue;
    picked.push({
      payslipId: String(s._id), organization: String(s.organization ?? ""), employeeCode: code, name: String(e?.name ?? "(no employee)"),
      status: String(s.status), currency: String(s.currency ?? ""), netPay: Number(s.netPay ?? 0), paid: s.status === "paid" || !!s.paidAt,
    });
  }
  const found = new Set(picked.map((p) => p.employeeCode));
  const notFound = want ? [...want].filter((c) => !found.has(c)) : [];
  // The same code in two organizations is two people: refuse to guess.
  const twice = [...found].filter((c) => new Set(picked.filter((p) => p.employeeCode === c).map((p) => p.organization)).size > 1);
  const orgs = [...new Set(picked.map((p) => p.organization))];
  const batches = await PayrollBatch.find({ month, organization: { $in: orgs.map((o) => new Types.ObjectId(o)) } })
    .select("organization status submittedBy").lean();
  return { picked, notFound, twice, batches: batches.map((b) => ({ organization: String(b.organization), status: String(b.status), submittedBy: b.submittedBy ? String(b.submittedBy) : "" })) };
}

/** Run `fn` inside one organization's scope, as the services expect. */
function inOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => runWithOrg({ orgId, isSuperAdmin: false }, () => { fn().then(resolve, reject); }));
}

/** Delete them as the Delete button does; then, if asked, hand each month to accounts again. */
export async function apply(month: string, picked: Planned[], opts: { submit: boolean; submittedBy: Map<string, string> }) {
  const service = new PayslipService();
  let deleted = 0;
  for (const p of picked) {
    await inOrg(p.organization, () => service.remove(p.payslipId));
    deleted++;
  }
  const submitted: string[] = [];
  if (opts.submit) {
    for (const org of [...new Set(picked.map((p) => p.organization))]) {
      const by = opts.submittedBy.get(org);
      if (!by) throw new Error(`Nobody has submitted ${month} for ${org} before — submit it on the Payroll page`);
      await inOrg(org, () => payrollBatchService.submit(month, by));
      submitted.push(org);
    }
  }
  return { deleted, submitted };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const after = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const month = after("--month") ?? "";
  const codes = after("--codes")?.split(",").filter(Boolean);
  const sheet = after("--sheet");
  const orgId = after("--org");
  if (!/^\d{4}-\d{2}$/.test(month) || (!codes?.length && !sheet) || (codes?.length && sheet) || (orgId && !Types.ObjectId.isValid(orgId))) {
    console.error('--month YYYY-MM and either --codes E0001,E0002 or --sheet <file> [--org <id>] [--apply [--submit]]');
    process.exit(1);
  }
  const { env } = await import("../config/env.js");
  await mongoose.connect(env.MONGODB_URI);
  try {
    const keep = sheet ? sheetCodes(sheet) : undefined;
    if (keep) console.log(`${sheet}: ${keep.size} employees in the sheet`);
    const p = await plan(month, { codes, keep, orgId });

    console.log(`\n${month}: ${p.picked.length} payslip(s) to take off`);
    for (const x of p.picked) {
      console.log(`    ${x.employeeCode.padEnd(7)} ${x.name.slice(0, 36).padEnd(36)} ${x.status.padEnd(7)} ${x.currency} ${x.netPay}${x.paid ? "   PAID — kept" : ""}`);
    }
    if (p.notFound.length) console.log(`  No ${month} payslip for: ${p.notFound.join(", ")}`);
    for (const b of p.batches) console.log(`  The month for ${b.organization} is ${b.status}${EDITABLE.includes(b.status) ? "" : " — not editable"}`);

    if (p.twice.length) throw new Error(`${p.twice.join(", ")} are in more than one organization — name the one with --org`);
    if (p.picked.some((x) => x.paid)) throw new Error("A paid payslip is the record of that payment — not deleted. Leave it out.");
    const locked = p.batches.filter((b) => !EDITABLE.includes(b.status));
    if (!argv.includes("--apply")) {
      console.log(`\nDry run — nothing deleted.${locked.length ? " The month must be sent back from finance (or recalled) first." : ""} Add --apply${argv.includes("--submit") ? "" : " (and --submit to hand the month to accounts again)"}.`);
    } else {
      if (locked.length) {
        throw new Error(`The month is ${locked.map((b) => b.status).join(", ")}: send it back from finance (the run's "Send back to HR"), or recall it, first.`);
      }
      const r = await apply(month, p.picked, { submit: argv.includes("--submit"), submittedBy: new Map(p.batches.map((b) => [b.organization, b.submittedBy])) });
      console.log(`\nDeleted ${r.deleted} payslip(s).${r.submitted.length ? ` ${month} handed to accounts again — import it in finance.` : " Submit the month on the Payroll page when ready."}`);
    }
  } catch (e) {
    console.error(`\n${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
