import { Employee } from "../models/Employee.js";
import { Payslip } from "../models/Payslip.js";
import { PayrollMute } from "../models/PayrollMute.js";
import { PayrollBatch } from "../models/PayrollBatch.js";
import { Attendance } from "../models/Attendance.js";
import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
import { PayslipService, LOP_PREFIX, PENALTY_PREFIX, EARLY_OUT_PENALTY_PREFIX, type SummaryTrace } from "./payslipService.js";
import { buildWalletDays, monthDays, type WalletDay, type WalletReconcile, type WalletDeductionKind } from "./walletDays.js";
import { LOAN_DEDUCTION_PREFIX, SALARY_ADVANCE_LABEL } from "./loanService.js";
import { REIMBURSE_PREFIX } from "./reimbursementService.js";
import { financePost } from "./financeClient.js";
import { dayValue } from "../utils/payMonth.js";
import { scoped, runWithOrg } from "../utils/orgContext.js";
import { User } from "../models/User.js";
import { hasLeft } from "../utils/employeeStatus.js";

/*
 * The wallet (the user, 2026-11-04): one person's month as money in and money out — a day of salary credited for
 * every day, what came off and why, their commission, everything else on the payslip, and what finance has actually
 * paid them, part payments included, so the balance still owed is finance's and not a guess. HRMS works out the days
 * and the payslip; finance is asked for what only it knows (POST /integrations/hrms/wallet). Reads only.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));
const err = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

const payslips = new PayslipService();

/** What finance answers — see finance's hrms-wallet.service.ts. */
interface FinanceWallet {
  payroll: Array<{
    runNumber: string; runStatus: string; currency: string; lineStatus: string; holdReason: string;
    payable: number; paid: number; balance: number;
    adjustments: Array<{ externalId: string; kind: "addition" | "deduction"; source: string; label: string; amount: number }>;
    payments: Array<{ paymentId: string; paidOn: string | null; method: string; account: string; reference: string; amount: number; reversed: boolean; reversalReason: string; finished: boolean }>;
  }>;
  crm: Array<{
    crm: string; crmName: string; currency: string; earned: number; payable: number | null; percent: number | null; level: string | null;
    sales: number; waiting: number; state: "earned" | "approved" | "paid"; approved: number | null;
    payrollRunNumber: string; paidOn: string | null; paymentMethod: string; reference: string;
  }>;
  crmError: string | null;
  cs: Array<{ kind: string; period: string; currency: string; amount: number; state: "approved" | "paid"; payrollRunNumber: string; paidOn: string | null; paymentMethod: string; reference: string }>;
}

export type WalletItemGroup =
  | "commission" | "slab" | "finance" | "reimbursement" | "overtime" | "one_time" | "paid_separately" | "loan" | "advance" | "structure";

export interface WalletItem {
  label: string;
  amount: number;
  direction: "credit" | "debit";
  group: WalletItemGroup;
  note: string | null;
  /** In the totals. False for something refused, or in another currency. */
  counted: boolean;
}

export interface WalletPayment {
  date: string | null;
  source: "payroll" | "separately" | "commission";
  label: string;
  method: string;
  account: string;
  reference: string;
  amount: number;
  reversed: boolean;
  note: string | null;
}

export interface WalletCommission {
  source: "crm" | "cs";
  name: string;
  detail: string | null;
  currency: string;
  /** What it comes to: finance's approved figure, else the CRM's at their slab, else what was earned. */
  amount: number;
  state: "earned" | "approved" | "on_payroll" | "paid";
  /** Earned on sales whose clients are still paying. */
  waiting: number;
  note: string | null;
  /** Counted in this month's balance here — not when it rides on a payslip, which already carries it. */
  inBalance: boolean;
}

/** What the kiosk shows after a face check-in: this month's deductions, and nothing else. */
export interface KioskMonth {
  month: string;
  currency: string;
  /** Each time something came off: the day, why, the days of pay and the amount. */
  deductions: Array<{ date: string; reason: string; days: number; amount: number }>;
  /** Month-level lines — HR's own loss-of-pay figure, say. Positive takes more off. */
  adjustments: Array<{ reason: string; amount: number }>;
  totalDays: number;
  totalAmount: number;
  unpaidLeaveDays: number;
}

export type WalletStatus = "in_progress" | "awaiting_payroll" | "payslip" | "part_paid" | "paid" | "paused";

const METHOD: Record<string, string> = { bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", online: "Online" };
const methodLabel = (m: string) => METHOD[m] ?? (m ? m.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");
const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const isAttendanceLine = (label: string) =>
  label.startsWith(LOP_PREFIX) || label.startsWith(PENALTY_PREFIX) || label.startsWith(EARLY_OUT_PENALTY_PREFIX);

export class WalletService {
  /** The caller's own wallet. */
  async forUser(userId: string, month: string) {
    const emp = await Employee.findOne(scoped({ user: userId })).select("_id").lean();
    if (!emp) throw err("No employee record is linked to your login, so there is no wallet to show.", 404);
    return this.forEmployee(String(emp._id), month);
  }

  /**
   * Somebody's wallet asked for by another portal (2026-11-04: "the wallet on every portal"), which knows the person
   * only by the email they sign in with. Found across organizations — a portal serves people from several — and then
   * read inside that person's own, as every org-scoped query here expects. Their work email first, else their login's;
   * someone still employed before a leaver who once had the same address.
   */
  async forEmail(email: string, month: string, organizationId?: string) {
    const address = email.trim().toLowerCase();
    const inOrg = organizationId ? { organization: organizationId } : {};
    const byLogin = await User.find({ email: address, ...inOrg }).select("_id").lean();
    const candidates = await Employee.find({
      $or: [{ email: address }, ...(byLogin.length ? [{ user: { $in: byLogin.map((u) => u._id) } }] : [])],
      ...inOrg,
    }).select("_id organization status").lean<Array<{ _id: unknown; organization?: unknown; status?: string }>>();
    const pick = candidates.find((c) => !hasLeft(c.status)) ?? candidates[0];
    if (!pick) throw err("No HRMS employee has this email.", 404);
    return new Promise<Awaited<ReturnType<WalletService["forEmployee"]>>>((resolve, reject) => {
      runWithOrg({ orgId: pick.organization ? String(pick.organization) : null, isSuperAdmin: false }, () => {
        this.forEmployee(String(pick._id), month).then(resolve, reject);
      });
    });
  }

  /**
   * This month's deductions, for the kiosk screen after a face check-in (2026-11-04: "show the deductions only, why,
   * how much, and the unpaid leave days"). Only what HRMS knows — finance is not asked from a kiosk, and a slow answer
   * must never hold the door. Null when there is no employee record, or anything goes wrong.
   */
  async kioskMonth(userId: string): Promise<KioskMonth | null> {
    try {
      const emp = await Employee.findOne(scoped({ user: userId })).select("_id").lean();
      if (!emp) return null;
      const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()).slice(0, 7);
      const w = await this.forEmployee(String(emp._id), month, { finance: false });
      const counted = w.days.filter((d) => d.counted);
      const deductions = counted.flatMap((d) => d.deductions.map((x) => ({ date: d.date, reason: x.reason, days: x.days, amount: x.amount })));
      const adjustments = w.reconcile.map((r) => ({ reason: r.reason, amount: r.amount }));
      return {
        month,
        currency: w.currency,
        deductions,
        adjustments,
        totalDays: Math.round(deductions.reduce((s, x) => s + x.days, 0) * 100) / 100,
        totalAmount: sum([...deductions.map((x) => x.amount), ...adjustments.map((a) => a.amount)]),
        unpaidLeaveDays: counted.filter((d) => d.kind === "unpaid_leave" && d.deductions.length).length,
      };
    } catch {
      return null;
    }
  }

  async forEmployee(employeeId: string, month: string, opts: { finance?: boolean } = {}) {
    const emp = await Employee.findOne(scoped({ _id: employeeId }))
      .select("name employeeCode designation email user currency")
      .populate({ path: "user", select: "email" })
      .lean<{ _id: unknown; name?: string; employeeCode?: string; designation?: string; email?: string; user?: { _id: unknown; email?: string } | null }>();
    if (!emp) throw err("Employee not found", 404);

    const trace: Partial<SummaryTrace> = {};
    const s = await payslips.summary(String(emp._id), month, undefined, trace);
    const [slip, mute, attendance, separately] = await Promise.all([
      Payslip.findOne(scoped({ employee: emp._id, month })).lean(),
      PayrollMute.findOne(scoped({ employee: emp._id, month })).select("reason").lean(),
      emp.user && trace.start
        ? Attendance.find({ user: emp.user._id, date: { $gte: trace.start, $lt: trace.end } })
          .select("status date timeZone checkIn checkOut lateMinutes workedMinutes").lean()
        : Promise.resolve([]),
      OneTimeAdjustment.find(scoped({ employee: emp._id, month, kind: "payment", payVia: "finance", financeStatus: { $in: ["with_finance", "paid", "rejected"] } }))
        .select("label amount financeStatus paidOn paymentMethod paymentRef financeNote").lean(),
    ]);
    // An issued or paid payslip is the month's word; a draft is HR still working, so the preview stands until then.
    const final = slip && ["issued", "paid"].includes(slip.status) ? slip : null;
    const currency = final?.currency || s.currency || "AED";

    // Without a login there is no attendance: every day reads as a paid rest day, which is what the payslip pays too.
    const t: SummaryTrace = trace.tz ? (trace as SummaryTrace) : {
      tz: "Asia/Dubai", start: new Date(0), end: new Date(0),
      today: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()),
      working: new Set(), holidays: new Set(), paidLeave: new Map(), unpaidLeave: new Map(), absent: new Set(), half: new Set(),
      halfLeaveNoAttendance: new Set(), unrecorded: [], exempt: false,
      policy: { enabled: false, graceLates: 3, lateBlockSize: 3, unrecordedDaysUnpaid: false, defaultRegularizationStatus: "present", monthlyRegularizationLimit: 3 },
    };

    // ── Salary, a day at a time ──
    const salaryLabels = new Set([...s.earnings.map((l) => l.label), "Basic"]);
    const salaryTotal = final
      ? sum(final.earnings.filter((l) => salaryLabels.has(l.label)).map((l) => l.amount))
      : s.proratedGross;
    const attendanceLines = final ? final.deductions : s.autoDeductions;
    const actualOf = (prefix: string) => sum(attendanceLines.filter((l) => l.label.startsWith(prefix)).map((l) => l.amount));
    const actual: Record<WalletDeductionKind, number> = {
      lop: actualOf(LOP_PREFIX), late: actualOf(PENALTY_PREFIX), early_out: actualOf(EARLY_OUT_PENALTY_PREFIX),
    };
    const { days, reconcile, complete } = buildWalletDays({
      month, trace: t, employment: s.employment, employedShare: s.employedShare, salary: s.salary, salaryTotal,
      attendance, wholeMonth: !!final, muted: !!mute && !final, actual, lopOverride: s.lopOverride, imported: !!final?.imported,
    });

    // ── What finance knows ──
    const emails = [...new Set([emp.email, emp.user?.email].map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean))];
    let fin: FinanceWallet | null = null;
    let financeError: string | null = null;
    if (opts.finance !== false) {
      try {
        fin = await financePost<FinanceWallet>("/hrms/wallet", { employeeId: String(emp._id), emails, month });
      } catch (e) {
        financeError = (e as Error).message;
      }
    }
    const financeSource = new Map<string, string>();
    for (const p of fin?.payroll ?? []) for (const a of p.adjustments) financeSource.set(a.label, a.source);

    // ── Everything else on the payslip (or what it is going to carry) ──
    const structureLabels = new Set(s.structureDeductions.map((l) => l.label));
    const groupOf = (label: string, direction: "credit" | "debit"): WalletItemGroup => {
      const source = financeSource.get(label);
      if (source === "crm_commission" || source === "cs_commission" || source === "commission") return "commission";
      if (source === "crm_slab") return "slab";
      if (source) return "finance";
      if (label.startsWith(REIMBURSE_PREFIX)) return "reimbursement";
      if (label.startsWith("Overtime (")) return "overtime";
      if (direction === "debit" && label.startsWith(LOAN_DEDUCTION_PREFIX)) return "loan";
      if (direction === "debit" && label.startsWith(SALARY_ADVANCE_LABEL)) return "advance";
      if (direction === "debit" && structureLabels.has(label)) return "structure";
      return "one_time";
    };
    const items: WalletItem[] = [];
    const add = (label: string, amount: number, direction: "credit" | "debit", note: string | null = null, group?: WalletItemGroup, counted = true) => {
      if (!(amount > 0)) return;
      items.push({ label, amount: r2(amount), direction, group: group ?? groupOf(label, direction), note, counted });
    };
    if (final) {
      for (const l of final.earnings) if (!salaryLabels.has(l.label)) add(l.label, l.amount, "credit");
      for (const l of final.deductions) if (!isAttendanceLine(l.label)) add(l.label, l.amount, "debit");
    } else if (!mute) {
      const pending = complete ? "On this month's payslip" : "Comes with this month's payslip";
      for (const l of s.autoEarnings) add(l.label, l.amount, "credit", pending);
      for (const l of s.autoDeductions) if (!isAttendanceLine(l.label)) add(l.label, l.amount, "debit", pending);
      for (const l of s.structureDeductions) add(l.label, l.amount, "debit", null, "structure");
    }

    const payments: WalletPayment[] = [];
    for (const o of separately) {
      const status = o.financeStatus;
      add(o.label, o.amount, "credit",
        status === "paid" ? "Paid separately by finance" : status === "rejected" ? `Not paid${o.financeNote ? `: ${o.financeNote}` : ""}` : "Waiting on finance",
        "paid_separately", status !== "rejected");
      if (status === "paid") {
        payments.push({
          date: o.paidOn ? new Date(o.paidOn).toISOString().slice(0, 10) : null, source: "separately", label: o.label,
          method: methodLabel(o.paymentMethod ?? ""), account: "", reference: o.paymentRef ?? "", amount: r2(o.amount), reversed: false, note: null,
        });
      }
    }

    // ── Commission ──
    const commission: WalletCommission[] = [];
    const money = (n: number, c: string) => `${c} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const commissionRow = (row: {
      source: "crm" | "cs"; name: string; detail: string | null; currency: string; amount: number; earnedState: "earned" | "approved" | "paid";
      payrollRunNumber: string; paidOn: string | null; method: string; reference: string; waiting: number;
    }) => {
      const sameCurrency = row.currency === currency;
      const onPayroll = !!row.payrollRunNumber;
      const state: WalletCommission["state"] = row.earnedState === "paid" ? "paid" : onPayroll ? "on_payroll" : row.earnedState;
      // Money here only when nothing else carries it: on a payroll run it is a line of that month's payslip.
      const inBalance = sameCurrency && !onPayroll && row.earnedState !== "earned";
      const note =
        !sameCurrency ? `In ${row.currency} — not added to this ${currency} wallet`
        : onPayroll ? `With payroll ${row.payrollRunNumber}${state === "paid" ? " — paid" : ""}`
        : row.earnedState === "paid" ? `Paid by receipt${row.paidOn ? ` on ${row.paidOn}` : ""}`
        : row.earnedState === "approved" ? "Approved by finance — waiting to be paid"
        : "Waiting for finance to approve";
      commission.push({ source: row.source, name: row.name, detail: row.detail, currency: row.currency, amount: r2(row.amount), state, waiting: r2(row.waiting), note, inBalance });
      if (!inBalance) return;
      add(row.name, row.amount, "credit", note, "commission");
      if (row.earnedState === "paid") {
        payments.push({
          date: row.paidOn, source: "commission", label: row.name, method: methodLabel(row.method), account: "",
          reference: row.reference, amount: r2(row.amount), reversed: false, note: "Commission paid by receipt",
        });
      }
    };
    for (const c of fin?.crm ?? []) {
      const amount = c.approved ?? c.payable ?? c.earned;
      const parts = [
        `${c.sales} sale${c.sales === 1 ? "" : "s"}`,
        c.percent !== null && c.payable !== null && c.percent !== 100
          ? `earned ${money(c.earned, c.currency)} × ${c.percent}%${c.level ? ` (${c.level} slab)` : ""}` : null,
        c.waiting > 0 ? `${money(c.waiting, c.currency)} more once clients pay in full` : null,
      ].filter(Boolean);
      commissionRow({
        source: "crm", name: `${c.crmName || c.crm} commission · ${monthLabel(month)}`, detail: parts.join(" · ") || null,
        currency: c.currency, amount, earnedState: c.state, payrollRunNumber: c.payrollRunNumber, paidOn: c.paidOn,
        method: c.paymentMethod, reference: c.reference, waiting: c.waiting,
      });
    }
    for (const c of fin?.cs ?? []) {
      commissionRow({
        source: "cs", name: `CS ${c.kind} commission · ${c.period}`, detail: null, currency: c.currency, amount: c.amount,
        earnedState: c.state, payrollRunNumber: c.payrollRunNumber, paidOn: c.paidOn, method: c.paymentMethod, reference: c.reference, waiting: 0,
      });
    }

    // ── Payroll payments ──
    for (const p of fin?.payroll ?? []) {
      for (const x of p.payments) {
        payments.push({
          date: x.paidOn, source: "payroll", label: `Salary · ${monthLabel(month)}`, method: methodLabel(x.method), account: x.account,
          reference: x.reference, amount: x.amount, reversed: x.reversed,
          note: x.reversed ? `Reversed${x.reversalReason ? `: ${x.reversalReason}` : ""}` : x.finished ? null : "Part payment",
        });
      }
    }
    let payrollPaid = sum((fin?.payroll ?? []).map((p) => p.paid));
    if (!fin && final?.status === "paid") {
      // Finance can't be asked: HRMS knows the payslip was paid, and by which payment, but not how it was split.
      const batch = await PayrollBatch.findOne(scoped({ month })).select("payments").lean();
      const paidDay = final.paidAt ? new Date(final.paidAt).toISOString().slice(0, 10) : null;
      const match = (batch?.payments ?? []).find((p) => {
        // Named since 2026-11-03; older payments are found by their day, as the reversal finds them.
        const named = (p as { payslipIds?: unknown[] }).payslipIds;
        return named?.length ? named.some((id) => String(id) === String(final._id)) : new Date(p.paidOn).toISOString().slice(0, 10) === paidDay;
      });
      payments.push({
        date: paidDay, source: "payroll", label: `Salary · ${monthLabel(month)}`, method: methodLabel(match?.method ?? ""), account: "",
        reference: match?.reference ?? "", amount: r2(final.netPay), reversed: false, note: "As HRMS recorded it — finance couldn't be asked",
      });
      payrollPaid = r2(final.netPay);
    }
    payments.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // ── Totals ──
    const countedDays = days.filter((d) => d.counted);
    const totalsOf = () => {
      const credited = r2(sum(countedDays.map((d) => d.credit)) + sum(items.filter((i) => i.counted && i.direction === "credit").map((i) => i.amount)));
      const deducted = r2(
        sum(countedDays.flatMap((d) => d.deductions.map((x) => x.amount))) + sum(reconcile.map((r) => r.amount))
        + sum(items.filter((i) => i.counted && i.direction === "debit").map((i) => i.amount))
      );
      return { credited, deducted, net: r2(credited - deducted) };
    };
    // Finance's figure for the payroll part is the one that gets paid. Where it differs from the payslip — an addition
    // not yet on it, say — the difference is shown as its own line, so the balance is finance's and still adds up.
    const financePayable = fin?.payroll.length ? sum(fin.payroll.map((p) => p.payable)) : null;
    if (financePayable !== null && (final || complete)) {
      const outside = sum(items.filter((i) => i.counted && i.direction === "credit" && (i.group === "paid_separately" || (i.group === "commission" && commission.some((c) => c.inBalance && c.name === i.label)))).map((i) => i.amount));
      const diff = r2(financePayable - (totalsOf().net - outside));
      if (Math.abs(diff) >= 0.01) {
        add("Finance's figure differs from your payslip", Math.abs(diff), diff > 0 ? "credit" : "debit",
          `Finance has ${money(financePayable, currency)} to pay you for this month`, "finance");
      }
    }
    const { credited, deducted, net } = totalsOf();
    const paid = r2(payrollPaid + sum(payments.filter((p) => p.source !== "payroll" && !p.reversed).map((p) => p.amount)));
    const balance = r2(net - paid);

    const status: WalletStatus =
      mute && !final ? "paused"
      : paid > 0 && balance <= 0 ? "paid"
      : paid > 0 ? "part_paid"
      : final ? "payslip"
      : complete ? "awaiting_payroll"
      : "in_progress";

    return {
      employee: { _id: String(emp._id), name: emp.name ?? "", employeeCode: emp.employeeCode ?? "", designation: emp.designation ?? "" },
      month,
      currency,
      status,
      today: t.today,
      firstMonth: s.employment.from ? s.employment.from.slice(0, 7) : null,
      complete,
      salary: {
        monthly: s.salary,
        perDay: r2(dayValue(s.salary)),
        monthTotal: salaryTotal,
        structureName: s.structureName,
        employedShare: s.employedShare,
        daysInMonth: monthDays(month).length,
      },
      muted: mute && !final ? { reason: (mute as { reason?: string }).reason ?? "" } : null,
      payslip: slip ? { status: slip.status, netPay: slip.netPay, issuedAt: slip.issuedAt, paidAt: slip.paidAt } : null,
      days: days satisfies WalletDay[],
      reconcile: reconcile satisfies WalletReconcile[],
      items,
      commission,
      payments,
      totals: { credited, deducted, net, paid, balance, financePayable },
      finance: {
        connected: !!fin,
        error: financeError,
        crmError: fin?.crmError ?? null,
        runNumbers: (fin?.payroll ?? []).map((p) => p.runNumber),
        onHold: ((held) => (held ? held.holdReason || "On hold" : null))((fin?.payroll ?? []).find((p) => p.lineStatus === "on_hold")),
      },
    };
  }
}
