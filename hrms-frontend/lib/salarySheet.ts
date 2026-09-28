import type { PayrollRunRow } from "@/types";

/**
 * The monthly salary statement, laid out the way accounts have always
 * received it: one row per person, AED first on a yellow band, then everyone
 * paid in another currency, each block with its own red total row.
 *
 * Figures come from the payroll run as they stand — the payslips once they
 * are generated, the preview before then — so the sheet and the Payroll page
 * can never disagree. Loss of pay is written as the figure the server priced,
 * not a `G/30 × D` formula: a day is priced on the full monthly salary, and
 * for a mid-month joiner that is not the GROSS beside it.
 *
 * exceljs rather than the xlsx already in the bundle, because the free xlsx
 * build writes no fills or fonts. Imported on click, so it costs nothing until
 * somebody downloads.
 */

const HEADERS = [
  "Employee No", "Name", "Join Date", "LOP", "EMP EFFECTIVE WORKDAYS", "BASIC", "GROSS",
  "LOAN", "SALARY ADVANCE", "LOSS OF PAY DEDUCTION", "OTHER DEDUCTION", "TOTAL DEDUCTIONS", "NET PAY",
];
const WIDTHS = [13, 34, 12, 8, 24, 10, 10, 10, 16, 23, 17, 18, 12];

const YELLOW = "FFFFFF00";
const RED = "FFFF0000";
const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

const shortDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";

const monthTitle = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
};

/** One row's thirteen columns. LOAN… OTHER are what the three totals are built from. */
function columns(r: PayrollRunRow) {
  const gross = r2(r.salary + r.oneTimePayments + r.reimbursements + r.overtime);
  const loan = r2(r.loanTotal);
  // No separate advance record exists: an advance is entered as a one-time
  // deduction, so that is what this column carries.
  const advance = r2(r.oneTimeDeductions);
  const lop = r2(r.lopAmount);
  // Whatever else the payslip takes — late and early-out penalties, recurring
  // structure deductions — so the row still adds up to the real net pay.
  const other = r2(r.totalDeductions - loan - advance - lop);
  return {
    code: r.employee.employeeCode ?? "",
    name: r.employee.name.trim(),
    joined: shortDate(r.employee.joiningDate),
    lopDays: r.lopDays || 0,
    workdays: Math.max(0, r2(30 - (r.lopDays || 0))),
    basic: r2(r.monthlySalary ?? r.salary),
    gross, loan, advance, lop, other,
  };
}

export async function downloadSalarySheet(month: string, rows: PayrollRunRow[], preview: boolean) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  // The total rows carry formulas with no cached result; this makes Excel
  // work them out on open instead of showing blanks.
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet("Salary statement");
  ws.columns = WIDTHS.map((width) => ({ width }));

  const font = { name: "Arial", size: 11 };
  const now = new Date();
  // Date and time formatted apart: toLocaleString's joiner between the two
  // differs by browser ("," in one, " at " in another).
  const stamp = `${now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} ` +
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  ws.mergeCells("A1:M1");
  ws.getCell("A1").value = `Created On:${stamp}` +
    (preview ? `  ·  Preview — payroll for this month is not generated yet; attendance counted to ${now.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : "");
  ws.getCell("A1").font = { name: "Arial", size: 10 };
  ws.getCell("A1").alignment = { horizontal: "right" };

  ws.mergeCells("A2:M2");
  ws.getCell("A2").value = `Salary Statement For The Month Of ${monthTitle(month)}`;
  ws.getCell("A2").font = { name: "Arial", size: 16, bold: true };
  ws.getCell("A2").alignment = { horizontal: "center" };

  const header = ws.getRow(3);
  header.values = HEADERS;
  header.font = { name: "Arial", size: 10, bold: true };

  const money = (cell: { numFmt: string }) => { cell.numFmt = "#,##0.##"; };

  /** Writes one currency's rows and their total; returns the next free row. */
  const block = (group: PayrollRunRow[], start: number, fill?: string) => {
    let n = start;
    const sorted = [...group].sort((a, b) => (a.employee.employeeCode ?? "").localeCompare(b.employee.employeeCode ?? ""));
    for (const r of sorted) {
      const c = columns(r);
      const row = ws.getRow(n);
      row.values = [
        c.code, c.name, c.joined, c.lopDays, c.workdays, c.basic, c.gross, c.loan, c.advance, c.lop, c.other,
        { formula: `H${n}+I${n}+J${n}+K${n}`, result: r2(c.loan + c.advance + c.lop + c.other) },
        { formula: `G${n}-L${n}`, result: r2(c.gross - c.loan - c.advance - c.lop - c.other) },
      ];
      row.font = font;
      for (let col = 1; col <= 13; col++) {
        const cell = row.getCell(col);
        if (col >= 6) money(cell);
        if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      }
      n++;
    }
    const total = ws.getRow(n);
    for (let col = 1; col <= 13; col++) {
      const cell = total.getCell(col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
      cell.font = { ...font, bold: true };
    }
    for (const col of ["G", "L", "M"]) {
      const cell = ws.getCell(`${col}${n}`);
      cell.value = { formula: `SUM(${col}${start}:${col}${n - 1})` };
      money(cell);
    }
    return n + 1;
  };

  const aed = rows.filter((r) => (r.currency || "AED").toUpperCase() === "AED");
  const others = rows.filter((r) => (r.currency || "AED").toUpperCase() !== "AED");
  let next = 4;
  if (aed.length) next = block(aed, next, YELLOW) + 2;
  // Every other currency in its own block, so no total ever adds AED to INR.
  const currencies = others.map((r) => r.currency.toUpperCase()).filter((c, i, all) => all.indexOf(c) === i).sort();
  for (const cur of currencies) {
    next = block(others.filter((r) => r.currency.toUpperCase() === cur), next) + 2;
  }

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `Salary sheet ${monthTitle(month)}${preview ? " (preview)" : ""}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
