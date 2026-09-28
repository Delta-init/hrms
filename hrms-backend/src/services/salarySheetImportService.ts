import * as XLSX from "xlsx";
import { Employee } from "../models/Employee.js";
import { Payslip } from "../models/Payslip.js";
import { Loan } from "../models/Loan.js";
import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { assertMonthEditable } from "./payrollBatchService.js";
import { computeOneTimeAdjustments } from "./oneTimeAdjustmentService.js";
import { computeReimbursements } from "./reimbursementService.js";
import { computeOvertime } from "./overtimeService.js";
import { hasLeft } from "../utils/employeeStatus.js";
import {
  PayslipService, buildImportedPayslip, consumeImported, undoRecoveries,
} from "./payslipService.js";
import type { IPayslipImport } from "../types/index.js";

/**
 * Import a month's salary sheet — the layout accounts receive, and the one
 * "Download salary sheet" writes — as that month's payslips.
 *
 * Two passes over the same file. Without `apply` nothing is written: every
 * row is matched to an employee by Employee No and set beside what the system
 * has for them, with anything wrong or surprising said out loud. With `apply`
 * the same checks run again (the file is sent twice, so nothing is trusted
 * from the first pass) and each row that passed becomes a draft payslip
 * holding exactly the sheet's figures, replacing one already there.
 *
 * Rows with an error are never applied; the rest are. Employees on the payroll
 * who are not in the sheet are listed and left alone.
 */

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

/**
 * Reimbursements, overtime and one-time payments this month owes somebody —
 * pending ones, plus any an existing payslip has already consumed (replacing
 * it hands those back). For someone off the payroll list, who has no run row
 * to read the figure from.
 */
async function extrasFor(empId: string, month: string, slip?: { _id: unknown; earnings?: Array<{ label: string; amount: number }> }) {
  const [oneTime, reimb, ot] = await Promise.all([
    computeOneTimeAdjustments(empId, month), computeReimbursements(empId, month), computeOvertime(empId, month),
  ]);
  const pending = [...oneTime.earnings, ...reimb.earnings, ...ot.earnings].reduce((a, l) => a + l.amount, 0);
  if (!slip) return r2(pending);
  const inSlip = (slip.earnings ?? []).filter((l) => l.label.startsWith("Reimbursement") || l.label.startsWith("Overtime")).reduce((a, l) => a + l.amount, 0);
  const paidOneTime = (await OneTimeAdjustment.find({ kind: "payment", payslip: slip._id }).select("appliedAmount amount").lean())
    .reduce((a, x) => a + (x.appliedAmount ?? x.amount ?? 0), 0);
  return r2(pending + inSlip + paidOneTime);
}
const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Header text (normalised) → the field it fills. Name and BASIC are read but never trusted for money. */
const COLUMNS: Record<string, string> = {
  employeeno: "code", name: "name", lop: "lopDays", empeffectiveworkdays: "paidDays",
  basic: "basic", gross: "gross", loan: "loan", salaryadvance: "advance",
  lossofpaydeduction: "lop", otherdeduction: "other", totaldeductions: "total", netpay: "net",
};
const REQUIRED = ["code", "lopDays", "gross", "loan", "advance", "lop", "other"];

interface SheetFigures {
  lopDays: number; paidDays: number; gross: number; loan: number; advance: number;
  lop: number; other: number; totalDeductions: number; net: number;
}

export interface ImportRow {
  line: number;
  code: string;
  name: string;
  employee: { _id: string; name: string } | null;
  action: "create" | "replace" | "skip";
  errors: string[];
  warnings: string[];
  sheet: SheetFigures;
  system: {
    gross: number; lopDays: number; loan: number; advance: number; lop: number; other: number; net: number;
    status: string | null; imported: boolean;
  } | null;
}

interface ParsedRow { line: number; code: string; name: string; cells: Record<string, unknown> }

function parse(buffer: Buffer) {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw Object.assign(new Error("That file could not be read as an Excel sheet"), { statusCode: 400 });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw Object.assign(new Error("The workbook has no sheets"), { statusCode: 400 });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });

  const headerAt = grid.findIndex((r) => (r ?? []).some((c) => norm(c) === "employeeno"));
  if (headerAt < 0) {
    throw Object.assign(new Error('No "Employee No" header found — use the layout from "Download salary sheet"'), { statusCode: 400 });
  }
  const map = new Map<number, string>();
  grid[headerAt].forEach((c, i) => { const f = COLUMNS[norm(c)]; if (f) map.set(i, f); });
  const have = new Set(map.values());
  const missing = REQUIRED.filter((f) => !have.has(f));
  if (missing.length) {
    const names = Object.entries(COLUMNS).filter(([, f]) => missing.includes(f)).map(([h]) => h.toUpperCase());
    throw Object.assign(new Error(`Columns missing from the sheet: ${names.join(", ")}`), { statusCode: 400 });
  }

  const rows: ParsedRow[] = [];
  const skipped: Array<{ line: number; name: string; reason: string }> = [];
  for (let i = headerAt + 1; i < grid.length; i++) {
    const cells: Record<string, unknown> = {};
    for (const [col, field] of map) cells[field] = grid[i]?.[col] ?? null;
    const code = String(cells.code ?? "").trim();
    const name = String(cells.name ?? "").trim();
    if (norm(code) === "employeeno") continue; // a repeated header
    if (!code) {
      // Total rows and gaps have no name either; a named row without a number
      // is somebody the sheet pays who can't be matched, and is worth saying.
      if (name) skipped.push({ line: i + 1, name, reason: "No Employee No — can't be matched to anyone" });
      continue;
    }
    rows.push({ line: i + 1, code, name, cells });
  }
  return { rows, skipped };
}

/** A money or day cell: a number, a numeric string, or empty (0). Anything else is an error. */
function num(v: unknown, label: string, errors: string[]): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) { errors.push(`${label} is not a number ("${v}")`); return 0; }
  if (n < 0) { errors.push(`${label} is negative`); return 0; }
  return r2(n);
}

export class SalarySheetImportService {
  private payslips = new PayslipService();

  async run(month: string, file: { buffer: Buffer; originalname: string }, apply: boolean, actorId: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw Object.assign(new Error("month (YYYY-MM) is required"), { statusCode: 400 });

    let locked: string | null = null;
    try { await assertMonthEditable(month, "payslips"); } catch (e) { locked = (e as Error).message; }
    if (apply && locked) throw Object.assign(new Error(locked), { statusCode: 409 });

    const { rows: parsed, skipped } = parse(file.buffer);
    if (!parsed.length) throw Object.assign(new Error("No employee rows found under the header"), { statusCode: 400 });

    const codes = [...new Set(parsed.map((r) => r.code))];
    const employees = await Employee.find(scoped({ employeeCode: { $in: codes } })).select("name employeeCode status currency").lean();
    const byCode = new Map(employees.map((e) => [String(e.employeeCode), e]));

    // What the Payroll page shows for the month — the system side of every
    // comparison, and the payroll list for "who is missing from the sheet".
    const { rows: run } = await this.payslips.runPreview(month);
    const runByEmp = new Map(run.map((r) => [String(r.employee._id), r]));

    const existing = await Payslip.find(scoped({ month })).select("employee status recoveries imported earnings deductions grossPay totalDeductions netPay lopDays workingDays").lean();
    /** Money inside GROSS the sheet has no column for, per sheet line — read again when applying. */
    const extrasByLine = new Map<number, number>();
    const slipByEmp = new Map(existing.map((p) => [String(p.employee), p]));

    const seen = new Map<string, number>();
    for (const r of parsed) seen.set(r.code, (seen.get(r.code) ?? 0) + 1);

    const out: ImportRow[] = [];
    for (const p of parsed) {
      const errors: string[] = [];
      const warnings: string[] = [];
      const c = p.cells;
      const lopDays = num(c.lopDays, "LOP", errors);
      const gross = num(c.gross, "GROSS", errors);
      const loan = num(c.loan, "LOAN", errors);
      const advance = num(c.advance, "SALARY ADVANCE", errors);
      // A formula the file was saved without a result for reads as empty; the
      // August sheet's own formula for this column is GROSS ÷ 30 × LOP.
      const lop = c.lop === null && lopDays > 0 ? r2((gross / 30) * lopDays) : num(c.lop, "LOSS OF PAY DEDUCTION", errors);
      const other = num(c.other, "OTHER DEDUCTION", errors);
      const paidDays = c.paidDays === null || c.paidDays === undefined ? Math.max(0, r2(30 - lopDays)) : num(c.paidDays, "EMP EFFECTIVE WORKDAYS", errors);
      const totalDeductions = r2(loan + advance + lop + other);
      const net = r2(gross - totalDeductions);
      const sheet: SheetFigures = { lopDays, paidDays, gross, loan, advance, lop, other, totalDeductions, net };

      if (lopDays > 31) errors.push("LOP is more than 31 days");
      if (net < 0) errors.push(`Deductions ${totalDeductions} are more than GROSS ${gross}`);
      if (c.net !== null && c.net !== undefined && c.net !== "") {
        const sheetNet = Number(String(c.net).replace(/,/g, ""));
        if (Number.isFinite(sheetNet) && Math.abs(sheetNet - net) > 0.01) {
          warnings.push(`NET PAY in the sheet is ${r2(sheetNet)}, but GROSS − deductions is ${net} — ${net} will be used`);
        }
      }
      if ((seen.get(p.code) ?? 0) > 1) errors.push(`${p.code} appears more than once in the sheet`);

      const emp = byCode.get(p.code);
      if (!emp) errors.push(`No employee with number ${p.code}`);
      const sys = emp ? runByEmp.get(String(emp._id)) : undefined;
      const slip = emp ? slipByEmp.get(String(emp._id)) : undefined;
      // Off the payroll list — marked as left with no last working day, most
      // often. The sheet paying them is the decision; it is imported and said.
      if (emp && !sys) {
        warnings.push(
          hasLeft(emp.status)
            ? `Marked ${emp.status} with no last working day, so not on this month's payroll list — imported because the sheet pays them`
            : "Not on this month's payroll list — imported because the sheet pays them"
        );
      }
      if (slip?.status === "paid") errors.push("Already paid — its payslip can't be replaced");
      if (slip?.status === "issued") warnings.push("Its issued payslip will be replaced by a draft");

      let system: ImportRow["system"] = null;
      if (sys) {
        const sysGross = r2(sys.salary + sys.oneTimePayments + sys.reimbursements + sys.overtime);
        const sysOther = r2(sys.totalDeductions - sys.loanTotal - sys.oneTimeDeductions - sys.lopAmount);
        system = {
          gross: sysGross, lopDays: sys.lopDays, loan: r2(sys.loanTotal), advance: r2(sys.oneTimeDeductions),
          lop: r2(sys.lopAmount), other: sysOther, net: r2(sys.netPay), status: sys.status, imported: !!sys.importedAt,
        };
      } else if (slip) {
        // Off the list but already paid something this month: compare against that payslip.
        const lines = (slip.deductions ?? []) as unknown as Array<{ label: string; amount: number }>;
        const sumOf = (m: (l: string) => boolean) => r2(lines.filter((l) => m(l.label)).reduce((a, l) => a + l.amount, 0));
        const sLoan = sumOf((l) => l.startsWith("Loan repayment"));
        const sLop = sumOf((l) => l.startsWith("Loss of Pay"));
        const sAdv = r2((slip.recoveries ?? []).filter((x) => x.kind === "adjustment").reduce((a, x) => a + x.amount, 0) + sumOf((l) => l === "Salary advance"));
        system = {
          gross: r2(slip.grossPay), lopDays: slip.lopDays ?? 0, loan: sLoan, advance: sAdv, lop: sLop,
          other: r2(slip.totalDeductions - sLoan - sLop - sAdv), net: r2(slip.netPay), status: slip.status, imported: !!slip.imported,
        };
      }

      if (emp) {
        // Money the sheet has no column for is paid inside GROSS; GROSS below
        // it would mean paying those twice or not at all.
        const extras = sys ? r2(sys.oneTimePayments + sys.reimbursements + sys.overtime) : await extrasFor(String(emp._id), month, slip as never);
        extrasByLine.set(p.line, extras);
        if (gross < extras) {
          errors.push(`GROSS ${gross} is less than the reimbursements, overtime and one-time payments due this month (${extras}) — include them in GROSS`);
        }
        if (system && Math.abs(gross - system.gross) > 0.01) warnings.push(`GROSS differs from the system (${system.gross})`);
        if (gross === 0) warnings.push("GROSS is 0 — the payslip will pay nothing");

        const empId = String(emp!._id);
        const recovered = (kind: string) => r2((slip?.recoveries ?? []).filter((x) => x.kind === kind).reduce((a, x) => a + x.amount, 0));
        if (loan > 0) {
          const loans = await Loan.find(scoped({ employee: empId, status: "active" })).select("amount amountRepaid").lean();
          const owed = r2(loans.reduce((a, l) => a + (l.amount - l.amountRepaid), 0) + recovered("loan"));
          if (loan > owed) warnings.push(owed > 0 ? `LOAN ${loan} is more than the ${owed} owed — the rest is deducted as a plain line` : "LOAN given but no loan on record — deducted as a plain line");
        }
        if (advance > 0) {
          const due = await OneTimeAdjustment.find(scoped({ employee: empId, kind: "deduction", applied: false, waived: { $ne: true }, month: { $lte: month } }))
            .select("amount appliedAmount").lean();
          const owed = r2(due.reduce((a, d) => a + (d.amount - (d.appliedAmount ?? 0)), 0) + recovered("adjustment"));
          if (advance > owed) warnings.push(owed > 0 ? `SALARY ADVANCE ${advance} is more than the ${owed} on record — the rest is a plain line` : "No advance on record — deducted as a plain line");
        }
      }

      out.push({
        line: p.line,
        code: p.code,
        name: p.name || emp?.name || "",
        employee: emp ? { _id: String(emp._id), name: String(emp.name) } : null,
        action: errors.length ? "skip" : slip ? "replace" : "create",
        errors,
        warnings,
        sheet,
        system,
      });
    }

    const inSheet = new Set(out.map((r) => r.employee?._id).filter(Boolean));
    const missing = run
      .filter((r) => !inSheet.has(String(r.employee._id)))
      .map((r) => ({ name: r.employee.name, code: r.employee.employeeCode ?? "" }));

    const result = {
      month,
      fileName: file.originalname,
      locked,
      rows: out,
      skipped,
      missing,
      counts: {
        create: out.filter((r) => r.action === "create").length,
        replace: out.filter((r) => r.action === "replace").length,
        errors: out.filter((r) => r.action === "skip").length,
        warnings: out.filter((r) => r.action !== "skip" && r.warnings.length).length,
      },
      applied: null as null | { created: number; replaced: number; failed: Array<{ code: string; name: string; error: string }> },
    };
    if (!apply) return result;

    const applied = { created: 0, replaced: 0, failed: [] as Array<{ code: string; name: string; error: string }> };
    for (const row of out) {
      if (row.action === "skip" || !row.employee) continue;
      const empId = row.employee._id;
      const sys = runByEmp.get(empId);
      try {
        // Hand back whatever the old payslip took before anything is worked
        // out, so the loans and items below are the ones genuinely owed.
        const old = await Payslip.findOne(scoped({ employee: empId, month }));
        if (old) {
          await undoRecoveries(old);
          await Payslip.deleteOne({ _id: old._id });
        }

        const extras = extrasByLine.get(row.line) ?? 0;
        const snap: IPayslipImport = {
          at: new Date(),
          by: actorId as never,
          fileName: file.originalname.slice(0, 200),
          basic: Math.max(0, r2(row.sheet.gross - extras)),
          lopDays: row.sheet.lopDays,
          paidDays: row.sheet.paidDays,
          lop: row.sheet.lop,
          loan: row.sheet.loan,
          advance: row.sheet.advance,
          other: row.sheet.other,
        };
        const built = await buildImportedPayslip(empId, month, snap);
        const emp = await Employee.findById(empId).select("user currency").lean();
        const doc = await Payslip.create({
          organization: getOrgId(),
          employee: empId,
          user: emp?.user ?? null,
          month,
          monthDate: new Date(`${month}-01T00:00:00.000Z`),
          currency: sys?.currency || old?.currency || emp?.currency || "AED",
          earnings: built.earnings,
          deductions: built.deductions,
          workingDays: sys?.workingDays ?? old?.workingDays ?? 0,
          paidDays: row.sheet.paidDays,
          lopDays: row.sheet.lopDays,
          recoveries: built.alloc.recoveries,
          deferred: built.alloc.deferred,
          status: "draft",
          notes: `Imported from salary sheet ${snap.fileName}`.slice(0, 500),
          imported: snap,
        });
        await consumeImported(built, String(doc._id));
        row.warnings.push(...built.warnings.filter((w) => !row.warnings.includes(w)));
        if (old) applied.replaced++; else applied.created++;
      } catch (e) {
        applied.failed.push({ code: row.code, name: row.name, error: (e as Error).message });
      }
    }
    result.applied = applied;
    return result;
  }
}
