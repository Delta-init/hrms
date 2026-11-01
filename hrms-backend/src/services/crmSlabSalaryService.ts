import { CrmSlabSalary } from "../models/CrmSlabSalary.js";
import { Employee } from "../models/Employee.js";
import { Payslip } from "../models/Payslip.js";
import { env } from "../config/env.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { assertMonthEditable } from "./payrollBatchService.js";
import { PayslipService } from "./payslipService.js";

/*
 * The CRM salary slabs, brought into payroll (the user, 2026-11-01: "the sales portal's salary on the slab is what HRMS
 * pays; loss of pay calculated on it; once the slab changes, the salary changes"). Root works out each salesperson's
 * month from the sales CRMs — Sales, Draw, Remote — and HR refreshes it into the month here: each one matched to an
 * employee by email, kept (CrmSlabSalary), and every payslip of the month for those employees rebuilt on it. Only
 * while the month may still be edited — a month with accounts is sent back first.
 */

export interface SlabRow {
  email: string; crm: string; crmName: string; name: string; role: string; level: string; salary: number; payable: number;
  employee: { id: string; name: string } | null;
}
type RootPerson = { crm: string; crmName: string; name: string; email: string; role: string; level: string; salary: number; payable: number };

const err = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

async function askRoot(month: string): Promise<{ people: RootPerson[]; failures: Array<{ crm: string; error: string }> }> {
  const base = env.ROOT_ERP_API_URL.replace(/\/+$/, "");
  if (!base || !env.ROOT_ERP_SECRET) throw err("Root isn't set up on this server — set ROOT_ERP_API_URL and ROOT_ERP_SECRET", 503);
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/service/hrms/slab-pay?month=${encodeURIComponent(month)}`, {
      headers: { "x-portal-secret": env.ROOT_ERP_SECRET }, signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw err("Root can't be reached — try again", 502);
  }
  const body = (await res.json().catch(() => ({}))) as { data?: { people?: RootPerson[]; failures?: Array<{ crm: string; error: string }> }; message?: string };
  if (!res.ok || !body.data) throw err(`Root couldn't give the slab salaries${body.message ? `: ${body.message}` : ` (${res.status})`}`, 502);
  return { people: body.data.people ?? [], failures: body.data.failures ?? [] };
}

/** A month's slab salaries as kept here, each with the employee it was matched to. */
export async function listSlabSalaries(month: string): Promise<{ month: string; fetchedAt: string | null; rows: SlabRow[] }> {
  const rows = await CrmSlabSalary.find(scoped({ month })).sort({ crm: 1, name: 1 }).lean();
  const emps = await Employee.find(scoped({ _id: { $in: rows.map((r) => r.employee).filter(Boolean) } })).select("name").lean();
  const nameOf = new Map(emps.map((e) => [String(e._id), String(e.name ?? "")]));
  return {
    month,
    fetchedAt: rows.length ? new Date(Math.max(...rows.map((r) => new Date(r.fetchedAt).getTime()))).toISOString() : null,
    rows: rows.map((r) => ({
      email: r.email, crm: r.crm, crmName: r.crmName, name: r.name, role: r.role, level: r.level, salary: r.salary, payable: r.payable,
      employee: r.employee ? { id: String(r.employee), name: nameOf.get(String(r.employee)) ?? "" } : null,
    })),
  };
}

/**
 * Root's slab salaries for a month, kept and applied: each salesperson matched to an employee by email; a CRM Root
 * couldn't read keeps what it had; the month's payslips for everyone whose slab salary changed (or went) rebuilt.
 */
export async function refreshSlabSalaries(month: string, actorId: string) {
  await assertMonthEditable(month, "the salary slabs");
  const { people, failures } = await askRoot(month);
  const answered = new Set(people.map((p) => p.crm));
  const failedCrms = new Set(failures.map((f) => f.crm));
  const emails = [...new Set(people.map((p) => p.email.trim().toLowerCase()).filter(Boolean))];
  const emps = await Employee.find(scoped({ email: { $in: emails } })).select("email name").lean();
  const empOf = new Map(emps.map((e) => [String(e.email).toLowerCase(), e]));
  const before = new Map((await CrmSlabSalary.find(scoped({ month })).lean()).map((r) => [r.email, r]));
  const now = new Date();
  const touched = new Set<string>();
  const unmatched: RootPerson[] = [];
  for (const p of people) {
    const email = p.email.trim().toLowerCase();
    const emp = email ? empOf.get(email) : undefined;
    if (!emp) { unmatched.push(p); continue; }
    const was = before.get(email);
    if (!was || was.salary !== p.salary || String(was.employee) !== String(emp._id)) touched.add(String(emp._id));
    await CrmSlabSalary.updateOne(
      scoped({ month, email }),
      { $set: { organization: getOrgId(), employee: emp._id, crm: p.crm, crmName: p.crmName, name: p.name, role: p.role, level: p.level,
        salary: p.salary, payable: p.payable, fetchedAt: now, fetchedBy: actorId } },
      { upsert: true },
    );
  }
  // Gone from a CRM that answered (left the slabs, or their email changed): their salary is the contract's again.
  const keep = new Set(people.map((p) => p.email.trim().toLowerCase()).filter((e) => empOf.has(e)));
  const gone = [...before.values()].filter((r) => !keep.has(r.email) && answered.has(r.crm) && !failedCrms.has(r.crm));
  for (const r of gone) if (r.employee) touched.add(String(r.employee));
  if (gone.length) await CrmSlabSalary.deleteMany(scoped({ month, email: { $in: gone.map((r) => r.email) } }));

  // Every payslip of the month for those people, rebuilt on what is kept now.
  const service = new PayslipService();
  const slips = touched.size ? await Payslip.find(scoped({ month, employee: { $in: [...touched] } })).select("_id").lean() : [];
  const rebuilt: string[] = [];
  const failed: Array<{ payslip: string; error: string }> = [];
  for (const s of slips) {
    try {
      await service.recompute(String(s._id));
      rebuilt.push(String(s._id));
    } catch (e) {
      failed.push({ payslip: String(s._id), error: e instanceof Error ? e.message : "Could not be rebuilt" });
    }
  }
  return {
    month,
    matched: people.length - unmatched.length,
    unmatched: unmatched.map((p) => ({ crm: p.crm, name: p.name, email: p.email, salary: p.salary })),
    removed: gone.map((r) => ({ crm: r.crm, name: r.name, email: r.email })),
    crmFailures: failures,
    payslipsRebuilt: rebuilt.length,
    payslipsFailed: failed,
  };
}
