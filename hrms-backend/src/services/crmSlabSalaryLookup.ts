import { CrmSlabSalary } from "../models/CrmSlabSalary.js";
import { scoped } from "../utils/orgContext.js";
import { dayValue } from "../utils/payMonth.js";

/*
 * Reading the CRM slab salary kept for an employee and month (2026-11-01). Models only — `salaryStructureService`
 * and `payslipService` both use it, and the refresh (`crmSlabSalaryService`) imports `payslipService`, so this file
 * imports no services.
 */

export interface SlabSalary { salary: number; crm: string; crmName: string; level: string; role: string }

/** The slab salary for an employee in a month, or null when none was refreshed in for them. */
export async function slabSalaryFor(employeeId: string, month: string): Promise<SlabSalary | null> {
  const row = await CrmSlabSalary.findOne(scoped({ month, employee: employeeId })).select("salary crm crmName level role").lean();
  return row ? { salary: row.salary, crm: row.crm, crmName: row.crmName, level: row.level, role: row.role } : null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A salary-sheet row's figures on the slab salary instead. The sheet's Basic is the contract salary, cut for a
 * joiner or a leaver; the slab salary is cut the same way (the sheet's share of the contract), and loss of pay is
 * priced off the slab salary — a thirtieth a day, as HRMS prices it — never more than the Basic it comes off.
 */
export function sheetOnSlab(input: { slab: number; contract: number; sheetBasic: number; lopDays: number; sheetLop: number }): { basic: number; lop: number } {
  const share = input.contract > 0 ? Math.min(1, input.sheetBasic / input.contract) : 1;
  const basic = r2(input.slab * share);
  // Days on the sheet are priced off the slab; a sheet that gave only an amount has it scaled to the slab salary.
  const lop = input.lopDays > 0
    ? r2(Math.min(basic, dayValue(input.slab) * input.lopDays))
    : input.sheetLop > 0 ? r2(Math.min(basic, input.sheetLop * (input.contract > 0 ? input.slab / input.contract : 1))) : 0;
  return { basic, lop };
}
