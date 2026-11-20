/**
 * Checks DGO Points Phase 1 on a scratch database, through the services the
 * routes call — every release test the developer handoff lists for Phase 1:
 *
 *   - the same KPI recorded twice is one earning and one credit;
 *   - KPI met then KPI exceeded is 30 points, never 50;
 *   - past 50 points a day an ordinary award is held; innovation is outside the cap, not the budget;
 *   - a department's allowance used up: nothing is paid beyond it, even when approvals race;
 *   - nobody approves points for themselves or a request they recorded (refused and audited);
 *   - nobody reads another employee's points without finance or audit rights;
 *   - moving department leaves earlier awards (and their budget) where they were;
 *   - collections take a second person to confirm; the tier, pools and allowances follow;
 *   - ledger rows can't be changed or deleted; a correction is a reversal;
 *   - every wallet equals its ledger; the month's issued − reversed equals what wallets hold.
 *
 * Refuses anything but a local scratch database. Run it twice: on a replica set
 * (transactions) and on a plain mongod (DGO_NO_TXN=1), since both must hold.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/dgo-scratch bun --no-env-file src/scripts/dgoPointsCheck.ts
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*(\?[\w=&]*)?$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}

// Notifications fire a web push; a checkout without web-push installed would fail on import.
try { Bun.resolveSync("web-push", import.meta.dir); } catch {
  Bun.plugin({
    name: "stub-web-push",
    setup(build) {
      build.module("web-push", () => ({ exports: { default: { setVapidDetails() {}, async sendNotification() {} } }, loader: "object" }));
    },
  });
}

const { runWithOrg } = await import("../utils/orgContext.js");
const { Organization } = await import("../models/Organization.js");
const { Role } = await import("../models/Role.js");
const { User } = await import("../models/User.js");
const { Employee } = await import("../models/Employee.js");
const { Department } = await import("../models/Department.js");
const { Notification } = await import("../models/Notification.js");
const { DgoEarningEvent } = await import("../models/DgoEarningEvent.js");
const { DgoLedgerEntry } = await import("../models/DgoLedgerEntry.js");
const { DgoWallet } = await import("../models/DgoWallet.js");
const { DgoPointLot } = await import("../models/DgoPointLot.js");
const { DgoDepartmentBudget } = await import("../models/DgoDepartmentBudget.js");
const { DgoAuditEntry } = await import("../models/DgoAuditEntry.js");
const { DgoEarningRule } = await import("../models/DgoEarningRule.js");
const access = await import("../services/dgo/dgoAccess.js");
const read = await import("../services/dgo/dgoReadService.js");
const earning = await import("../services/dgo/dgoEarningService.js");
const budget = await import("../services/dgo/dgoBudgetService.js");
const settings = await import("../services/dgo/dgoSettingsService.js");
const ledger = await import("../services/dgo/dgoLedgerService.js");
const txn = await import("../services/dgo/dgoTxn.js");
const { dayIn, previousMonth, addMonthsToDay } = await import("../services/dgo/dgoMath.js");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};
async function refused(p: Promise<unknown>, like: RegExp): Promise<string> {
  try { await p; return "not refused"; } catch (e) { const m = (e as Error).message; return like.test(m) ? "" : m; }
}

await mongoose.connect(uri);
await mongoose.connection.dropDatabase();
await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes()));
if (process.env.DGO_NO_TXN === "1") txn.setTransactionsSupportedForTest(false);
const usingTxn = await txn.transactionsSupported();
console.log(`\nDGO Points checks — ${usingTxn ? "with transactions (replica set)" : "without transactions"}`);

const TZ = "Asia/Dubai";
const today = dayIn(TZ);
const month = today.slice(0, 7);
const dayBefore = (d: string, n = 1) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const yesterday = dayBefore(today);
// Days in this month only, so the month's budget is the one under test.
const earlierDay = (n: number) => { const d = dayBefore(today, n); return d.startsWith(month) ? d : today; };

const org = (await Organization.create({ name: "Delta HQ", code: "HQ", timeZone: TZ } as never)) as unknown as { _id: mongoose.Types.ObjectId };
const orgId = String(org._id);
const P = (o: Record<string, Partial<Record<"view" | "create" | "edit" | "delete" | "approve" | "export", boolean>>>) => o;
const mkRole = async (roleName: string, permissions: Record<string, unknown>, isSystemRole = false) =>
  (await Role.create({ roleName, organization: org._id, permissions, isSystemRole } as never)) as unknown as { _id: mongoose.Types.ObjectId };
const staffRole = await mkRole("Staff", {});
const hrRole = await mkRole("HR", P({ dgoApprovals: { view: true, create: true, approve: true } }));
const finRole = await mkRole("Finance", P({ dgoBudgets: { view: true, edit: true, approve: true }, dgoAudit: { view: true } }));
const adminRole = await mkRole("DGO Admin", P({ dgoSettings: { view: true, edit: true } }));
const superRole = await mkRole("Super Admin", {}, true);

const sales = await Department.create({ organization: org._id, name: "Sales", code: "SAL" } as never) as unknown as { _id: mongoose.Types.ObjectId };
const media = await Department.create({ organization: org._id, name: "Media", code: "MED" } as never) as unknown as { _id: mongoose.Types.ObjectId };

let n = 0;
const person = async (name: string, role: { _id: unknown }, department: { _id: unknown } | null, withEmployee = true) => {
  n++;
  const u = (await User.create({ name, email: `${name.toLowerCase()}@scratch.local`, password: "x".repeat(12), role: role._id, organization: org._id, status: "active" } as never)) as unknown as { _id: mongoose.Types.ObjectId };
  const e = withEmployee
    ? ((await Employee.create({ organization: org._id, name, email: `${name.toLowerCase()}@scratch.local`, employeeCode: `E${n}`, user: u._id, department: department?._id ?? null, status: "active" } as never)) as unknown as { _id: mongoose.Types.ObjectId })
    : null;
  return { user: String(u._id), emp: e ? String(e._id) : "", role };
};
const hana = await person("Hana", staffRole, sales);   // head of Sales
const sam = await person("Sam", staffRole, sales);
const sara = await person("Sara", staffRole, sales);
const omar = await person("Omar", staffRole, media);
const mona = await person("Mona", staffRole, media);
const hira = await person("Hira", hrRole, null);
const fin1 = await person("Fin1", finRole, null);
const fin2 = await person("Fin2", finRole, null);
const admin = await person("Adam", adminRole, null);
const boss = await person("Boss", superRole, null, false);
await Department.updateOne({ _id: sales._id }, { $set: { leader: hana.emp, leaderKind: "Employee" } });

const inOrg = <T,>(fn: () => Promise<T>, superAdmin = false) =>
  new Promise<T>((resolve, reject) => runWithOrg({ orgId, isSuperAdmin: superAdmin }, () => { fn().then(resolve, reject); }));
const as = async (p: { user: string; role: { _id: unknown } }) => {
  const role = await Role.findById(p.role._id);
  return inOrg(() => access.viewerFrom({ userId: p.user, email: "x@scratch.local", roleId: String(p.role._id), role: role! as never }), p === boss);
};
const rid = () => crypto.randomUUID();
const wallet = async (p: { emp: string }) => (await DgoWallet.findOne({ employee: p.emp }).lean<{ available: number }>())?.available ?? 0;
const credits = async (p: { emp: string }) => DgoLedgerEntry.countDocuments({ employee: p.emp, type: "credit" });
const rowOf = async (dept: { _id: unknown } | null) => {
  const r = await DgoDepartmentBudget.findOne({ month, department: dept?._id ?? null }).lean<{ allocationFils: number; committedFils: number; group: string; headcount: number }>();
  return r!;
};

/* ------------------------------------------------------------------ */
console.log("\n1. Opening: settings v1, the seven rules, gated until switched on");
const vBoss = await as(boss);
const vAdmin = await as(admin);
check("seven rules seeded as v1", (await DgoEarningRule.countDocuments({ organization: orgId, version: 1 })) === 7);
const rules = await inOrg(() => settings.rulesView(vAdmin));
check("KPI met 20 (AED 1.00), exceeded 30, innovation 100 outside the cap",
  rules.rules.find((r) => r.code === "KPI_MET")?.aed === 1 && rules.rules.find((r) => r.code === "KPI_EXCEEDED")?.points === 30 && rules.rules.find((r) => r.code === "INNOVATION")?.capExempt === true);
check("settings v1: 1 pt = AED 0.05, cap 50/30, 12 months, 1,000 minimum",
  rules.settings.pointValueAed === 0.05 && rules.settings.dailyCap === 50 && rules.settings.autoKpiCap === 30 && rules.settings.expiryMonths === 12 && rules.settings.minRedemption === 1000);
const vSam0 = await as(sam);
check("an employee is refused before it opens", (await refused(inOrg(() => read.dashboard(vSam0)), /isn't open yet/)) === "");
check("…and /me says so", !(await inOrg(() => read.me(vSam0))).canUse);
const vHana = await as(hana);
const hanaClosed = await inOrg(() => read.me(vHana));
check("a department head sees nothing before it opens either", !hanaClosed.canUse && !hanaClosed.can.recordAwards && !hanaClosed.can.approvals, hanaClosed);
check("…and can't record points yet", (await refused(inOrg(() => earning.recordEarning(vHana, { employeeId: sam.emp, ruleCode: "KPI_MET", day: today, reason: "x", requestId: rid() })), /isn't open yet/)) === "");
const vHiraClosed = await as(hira);
const preOpen = await inOrg(() => earning.recordEarning(vHiraClosed, { employeeId: sara.emp, ruleCode: "TEAM_SUPPORT", day: earlierDay(5), reason: "Pilot set-up help", requestId: rid() }));
check("HR can record before it opens; the head step is skipped so nothing waits on a head", preOpen.event.stage === "hr" && preOpen.event.trail.some((t) => t.stage === "head" && t.action === "skipped"), preOpen.event);
await inOrg(() => settings.saveProgram(vAdmin, { openToEmployees: true, revenueDepartments: [String(sales._id)] }));
await inOrg(() => budget.refreshGrouping(orgId, month));
const vSam = await as(sam);
check("open to employees: Sam can use it", (await inOrg(() => read.me(vSam))).canUse);
const hanaOpen = await inOrg(() => read.me(vHana));
check("…and Hana now has her head's rights", hanaOpen.canUse && hanaOpen.can.recordAwards && hanaOpen.can.approvals);
check("Sam has no staff rights", !(await inOrg(() => read.me(vSam))).can.recordAwards && !(await inOrg(() => read.me(vSam))).can.budgetsView);
check("an employee can't change settings", (await refused(inOrg(() => settings.saveProgram(vSam, { openToEmployees: false })), /can't change/)) === "");

/* ------------------------------------------------------------------ */
console.log("\n2. The month opens on the lowest tier, split 55/45 by headcount");
const vFin1 = await as(fin1);
const vFin2 = await as(fin2);
const b0 = await inOrg(() => budget.budgetView(vFin1, month));
check("no collections confirmed yet: lowest tier, AED 1,500 everyday, elite locked", b0.tierBasis === "lowest" && b0.everydayAed === 1500 && !b0.eliteUnlocked, b0);
check("revenue group (Sales) gets 55% = AED 825", b0.groups.find((g) => g.group === "revenue")?.shareAed === 825, b0.groups);
check("the other 45% = AED 675 is split by headcount", b0.groups.find((g) => g.group === "other")?.shareAed === 675, b0.groups);
const noDept = b0.departments.find((d) => d.id === null);
const mediaRow = b0.departments.find((d) => d.name === "Media");
check("Media (2 people) and no-department (4 people) share 675 by headcount: 225 / 450", mediaRow?.allocationAed === 225 && noDept?.allocationAed === 450, b0.departments);
check("an employee can't see budgets", (await refused(inOrg(() => budget.budgetView(vSam, month)), /can't see/)) === "");

/* ------------------------------------------------------------------ */
console.log("\n3. KPI points: recorded by the head, posted at once, never twice");
const met = await inOrg(() => earning.recordEarning(vHana, { employeeId: sam.emp, ruleCode: "KPI_MET", day: today, reason: "Daily KPI 104%", requestId: rid() }));
check("KPI met posted with no approval", met.event.status === "posted", met.event.status);
check("Sam has 20 points", (await wallet(sam)) === 20);
const lot = await DgoPointLot.findOne({ employee: sam.emp }).lean<{ expiresOn: string }>();
check("its lot expires 12 months later", lot?.expiresOn === addMonthsToDay(today, 12), lot);
const again = await inOrg(() => earning.recordEarning(vHana, { employeeId: sam.emp, ruleCode: "KPI_MET", day: today, reason: "again", requestId: rid() }));
check("the same KPI day again is a duplicate", again.duplicate && String(again.event._id) === String(met.event._id));
check("…still one credit", (await credits(sam)) === 1);
const salesBefore = (await rowOf(sales)).committedFils;
const exceeded = await inOrg(() => earning.recordEarning(vHana, { employeeId: sam.emp, ruleCode: "KPI_EXCEEDED", day: today, reason: "Daily KPI 128%", requestId: rid() }));
check("KPI exceeded posted", exceeded.event.status === "posted", exceeded.message);
check("net 30, never 50", (await wallet(sam)) === 30, await wallet(sam));
const metAfter = await DgoEarningEvent.findById(met.event._id).lean<{ status: string }>();
check("the met is superseded, reversed in the ledger", metAfter?.status === "superseded" && (await DgoLedgerEntry.countDocuments({ employee: sam.emp, type: "reverse" })) === 1);
check("budget took 30 points' worth (AED 1.50) in all, not 2.50", (await rowOf(sales)).committedFils === salesBefore + 50, { before: salesBefore, after: (await rowOf(sales)).committedFils });
const metAgain = await inOrg(() => earning.recordEarning(vHana, { employeeId: sam.emp, ruleCode: "KPI_MET", day: today, reason: "late", kpiKey: "daily", requestId: rid() }));
check("recording the replaced KPI met again returns it, unpaid", metAgain.duplicate && metAgain.event.status === "superseded" && (await wallet(sam)) === 30);
await inOrg(() => earning.recordEarning(vHana, { employeeId: sara.emp, ruleCode: "KPI_EXCEEDED", day: yesterday, reason: "131%", requestId: rid() }));
check("KPI met after KPI exceeded is refused", (await refused(inOrg(() => earning.recordEarning(vHana, { employeeId: sara.emp, ruleCode: "KPI_MET", day: yesterday, reason: "late", requestId: rid() })), /Already recorded as KPI exceeded/)) === "");

/* ------------------------------------------------------------------ */
console.log("\n4. Who can record what");
check("a head can't record for another department", (await refused(inOrg(() => earning.recordEarning(vHana, { employeeId: omar.emp, ruleCode: "KPI_MET", day: today, reason: "x", requestId: rid() })), /department you head/)) === "");
check("nobody records points for themselves", (await refused(inOrg(() => earning.recordEarning(vHana, { employeeId: hana.emp, ruleCode: "KPI_MET", day: today, reason: "x", requestId: rid() })), /yourself/)) === "");
check("an employee can't record points", (await refused(inOrg(() => earning.recordEarning(vSam, { employeeId: sara.emp, ruleCode: "KPI_MET", day: today, reason: "x", requestId: rid() })), /department you head/)) === "");
check("no future days", (await refused(inOrg(() => earning.recordEarning(vHana, { employeeId: sara.emp, ruleCode: "KPI_MET", day: addMonthsToDay(today, 1), reason: "x", requestId: rid() })), /today or an earlier day/)) === "");
check("nothing two months back", (await refused(inOrg(() => earning.recordEarning(vHana, { employeeId: sara.emp, ruleCode: "KPI_MET", day: `${previousMonth(previousMonth(month))}-15`, reason: "x", requestId: rid() })), /this month or last month/)) === "");
check("evidence required where the rule says", (await refused(inOrg(() => earning.recordEarning(vHana, { employeeId: sara.emp, ruleCode: "ISSUE_RESOLVED", day: today, reason: "x", requestId: rid() })), /needs evidence/)) === "");
const lastMonthKpi = await inOrg(() => earning.recordEarning(vHana, { employeeId: sara.emp, ruleCode: "KPI_MET", day: `${previousMonth(month)}-20`, reason: "late entry", requestId: rid() }));
check("last month is still open for a late KPI", lastMonthKpi.event.status === "posted", lastMonthKpi.message);

/* ------------------------------------------------------------------ */
console.log("\n5. Approval chains: head → HR → finance, nobody deciding their own");
const vHira = await as(hira);
const support = await inOrg(() => earning.recordEarning(vHana, { employeeId: sam.emp, ruleCode: "TEAM_SUPPORT", day: today, reason: "Covered evening calls", requestId: rid() }));
check("a head's own recording counts as the head step: waits for HR", support.event.status === "pending" && support.event.stage === "hr", support.event);
check("the head step shows as approved by the head", support.event.trail.some((t) => t.stage === "head" && t.action === "approved"));
const mine = await inOrg(() => read.approvals(vHira, "mine"));
check("it is in HR's queue", mine.items.some((i) => i.id === String(support.event._id)));
check("Sam can't approve his own", (await refused(inOrg(() => earning.decide(vSam, String(support.event._id), true)), /for you/)) === "");
check("…refused and audited", (await DgoAuditEntry.countDocuments({ action: "approval_refused" })) === 1);
check("finance can't act at HR's step", (await refused(inOrg(() => earning.decide(vFin1, String(support.event._id), true)), /Waiting for HR/)) === "");
check("rejecting needs a reason", (await refused(inOrg(() => earning.decide(vHira, String(support.event._id), false)), /Say why/)) === "");
const [d1, d2] = await Promise.all([
  inOrg(() => earning.decide(vHira, String(support.event._id), true)),
  inOrg(() => earning.decide(vHira, String(support.event._id), true)),
]);
check("HR approves (two clicks at once)", [d1, d2].some((d) => d.event.status === "posted"), [d1.message, d2.message]);
check("…one credit: Sam 30 + 15 = 45", (await wallet(sam)) === 45 && (await DgoLedgerEntry.countDocuments({ earningEvent: support.event._id, type: "credit" })) === 1, await wallet(sam));
const again2 = await inOrg(() => earning.decide(vHira, String(support.event._id), true));
check("approving again later says already done", /Already/.test(again2.message));
const forOmar = await inOrg(() => earning.recordEarning(vHira, { employeeId: omar.emp, ruleCode: "TEAM_SUPPORT", day: today, reason: "Helped Sales with a campaign", requestId: rid() }));
check("Media has no head: the head step is skipped, HR decides", forOmar.event.stage === "hr" && forOmar.event.trail.some((t) => t.stage === "head" && t.action === "skipped"));
check("HR can't approve what HR recorded", (await refused(inOrg(() => earning.decide(vHira, String(forOmar.event._id), true)), /You recorded this/)) === "");
const byBoss = await inOrg(() => earning.decide(vBoss, String(forOmar.event._id), true));
check("…another approver (a Super Admin) can", byBoss.event.status === "posted", byBoss.message);
const innovation = await inOrg(() => earning.recordEarning(vHana, { employeeId: sara.emp, ruleCode: "INNOVATION", day: today, reason: "Lead-score sheet", evidenceNote: "Sheet in use by the team since the 3rd", requestId: rid() }));
check("innovation waits for HR", innovation.event.stage === "hr");
const toFin = await inOrg(() => earning.decide(vHira, String(innovation.event._id), true, "Fair"));
check("…then for finance", toFin.event.status === "pending" && toFin.event.stage === "finance", toFin.event);
const hrAgain = await inOrg(() => earning.decide(vHira, String(innovation.event._id), true));
check("HR clicking again after approving is told it's done, nothing moves", hrAgain.message === "Already done" && hrAgain.event.stage === "finance");
check("someone without finance rights can't act at finance's step", (await refused(inOrg(() => earning.decide(vAdmin, String(innovation.event._id), true)), /Waiting for finance/)) === "");
const finOk = await inOrg(() => earning.decide(vFin1, String(innovation.event._id), true));
check("finance approves: 100 points posted", finOk.event.status === "posted" && (await wallet(sara)) === 20 + 30 + 100, await wallet(sara));
const byHr = await inOrg(() => earning.recordEarning(vHira, { employeeId: sara.emp, ruleCode: "PROCESS_IMPROVEMENT", day: today, reason: "Follow-up checklist", requestId: rid() }));
check("recorded by HR for a Sales person: waits for the Sales head first", byHr.event.stage === "head");
check("…which HR can't skip", (await refused(inOrg(() => earning.decide(vHira, String(byHr.event._id), true)), /You recorded this|Waiting for the head/)) === "");
const headOk = await inOrg(() => earning.decide(vHana, String(byHr.event._id), true));
check("the head approves: on to HR", headOk.event.stage === "hr" && headOk.event.status === "pending");
const hrOk = await inOrg(() => earning.decide(vBoss, String(byHr.event._id), true));
check("…and a second HR-level approver posts it", hrOk.event.status === "posted" && (await wallet(sara)) === 120 + 30 + 20, await wallet(sara));
const rej = await inOrg(() => earning.recordEarning(vHana, { employeeId: sara.emp, ruleCode: "PROCESS_IMPROVEMENT", day: today, reason: "New script", requestId: rid() }));
const rejected = await inOrg(() => earning.decide(vHira, String(rej.event._id), false, "Not implemented yet"));
check("a rejection is final, with its reason, and pays nothing", rejected.event.status === "rejected" && (await wallet(sara)) === 170);
check("…and tells whoever recorded it", (await Notification.countDocuments({ user: hana.user, title: /not approved/ })) === 1);

/* ------------------------------------------------------------------ */
console.log("\n6. The daily cap: 50 a day, 30 of it KPI; innovation outside it");
// Sam today: KPI exceeded 30 + team support 15 = 45.
const tooMuch = await inOrg(() => earning.recordEarning(vHana, { employeeId: sam.emp, ruleCode: "ISSUE_RESOLVED", day: today, reason: "Refund dispute", evidenceNote: "Ticket closed", requestId: rid() }));
check("30 more would make 75: held as capped, not paid", tooMuch.event.status === "capped" && (await wallet(sam)) === 45, tooMuch.message);
const kpiOther = await inOrg(() => earning.recordEarning(vHana, { employeeId: sam.emp, ruleCode: "KPI_MET", day: today, kpiKey: "follow-ups", reason: "Second KPI", requestId: rid() }));
check("a second KPI the same day passes the 30 KPI cap: capped", kpiOther.event.status === "capped", kpiOther.message);
const bigIdea = await inOrg(() => earning.recordEarning(vHana, { employeeId: sam.emp, ruleCode: "INNOVATION", day: today, reason: "Auto follow-up template", evidenceNote: "Live since Monday", requestId: rid() }));
check("innovation is not capped", bigIdea.event.status === "pending", bigIdea.event.status);

/* ------------------------------------------------------------------ */
console.log("\n7. A department's allowance can't be passed, even by approvals racing");
const mr = await rowOf(media);
await DgoDepartmentBudget.updateOne({ month, department: media._id }, { $set: { allocationFils: mr.committedFils + 200 } }); // room for 40 points
const days = [earlierDay(1), earlierDay(2), earlierDay(3)].filter((d, i, a) => a.indexOf(d) === i);
const racers = await Promise.all([
  ...days.map((d) => inOrg(() => earning.recordEarning(vHira, { employeeId: omar.emp, ruleCode: "KPI_MET", day: d, reason: "KPI", requestId: rid() }))),
  inOrg(() => earning.recordEarning(vHira, { employeeId: mona.emp, ruleCode: "KPI_MET", day: today, reason: "KPI", requestId: rid() })),
]);
const posted = racers.filter((r) => r.event.status === "posted").length;
const blocked = racers.filter((r) => r.event.status === "budget_blocked").length;
check(`${racers.length} awards of 20 against room for 40: exactly 2 paid`, posted === 2 && blocked === racers.length - 2, racers.map((r) => r.event.status));
const mAfter = await rowOf(media);
check("Media's committed never passes its allowance", mAfter.committedFils <= mAfter.allocationFils, mAfter);
check("finance is told the allowance is used up", (await Notification.countDocuments({ user: fin1.user, title: /allowance is used up/ })) >= 1);

/* ------------------------------------------------------------------ */
console.log("\n8. Moving department leaves earlier awards where they were");
const salesCommitted = (await rowOf(sales)).committedFils;
await Employee.updateOne({ _id: sara.emp }, { $set: { department: media._id } });
await DgoDepartmentBudget.updateOne({ month, department: media._id }, { $inc: { allocationFils: 1000 } });
const vHira2 = await as(hira);
const afterMove = await inOrg(() => earning.recordEarning(vHira2, { employeeId: sara.emp, ruleCode: "KPI_MET", day: earlierDay(4) === today ? yesterday : earlierDay(4), reason: "KPI", requestId: rid() }));
check("Sara's new award is charged to Media", (afterMove.event.department && String(afterMove.event.department)) === String(media._id), afterMove.event.departmentName);
check("Sales keeps what Sara's earlier awards committed", (await rowOf(sales)).committedFils === salesCommitted);
check("her earlier innovation still says Sales", (await DgoEarningEvent.findById(innovation.event._id).lean<{ departmentName: string }>())?.departmentName === "Sales");

/* ------------------------------------------------------------------ */
console.log("\n9. Points are private");
check("Sam can't open Omar's points", (await refused(inOrg(() => read.wallet(vSam, { employeeId: omar.emp })), /only your own/)) === "");
const omarSeen = await inOrg(() => read.wallet(vFin1, { employeeId: omar.emp }));
check("finance can", omarSeen.employee.name === "Omar");
const own = await inOrg(() => read.wallet(vSam, {}));
check("Sam sees his own: 45 available, rows newest first", own.balances.available === 45 && own.rows.length >= 4, own.balances);
const dash = await inOrg(() => read.dashboard(vSam));
check("his overview: today 45 of 50 used, 30 of it KPI", dash.own?.today.used === 45 + 0 && dash.own?.today.autoUsed === 30, dash.own?.today);
check("…innovation pending shows as pending points", dash.own?.balances.pending === 100, dash.own?.balances);
check("an employee gets no company or team figures", dash.company === null && dash.team === null);
const hDash = await inOrg(() => read.dashboard(vHana));
check("the head sees her team", (hDash.team?.members.length ?? 0) >= 2);

/* ------------------------------------------------------------------ */
console.log("\n10. Collections: entered by one, confirmed by another");
await inOrg(() => budget.enterCollections(vFin1, month, 1_245_000, "Reconciled receipts to the 20th"));
const b1 = await inOrg(() => budget.budgetView(vFin1, month));
check("entered, not yet in force", b1.collections.awaitingConfirmation && b1.tierBasis === "lowest" && !b1.can.confirm);
check("the person who entered it can't confirm it", (await refused(inOrg(() => budget.confirmCollections(vFin1, month)), /someone else confirms/)) === "");
check("…refused and audited", (await DgoAuditEntry.countDocuments({ action: "collections_self_confirm_refused" })) === 1);
const salesCommittedBefore = (await rowOf(sales)).committedFils;
const b2 = await inOrg(() => budget.confirmCollections(vFin2, month));
check("confirmed: top tier, AED 4,750 everyday + 13,250 elite", b2.tierBasis === "confirmed" && b2.everydayAed === 4750 && b2.eliteAed === 13250 && b2.eliteUnlocked && b2.ceilingAed === 18000, b2);
check("the revenue group now has AED 2,612.50", b2.groups.find((g) => g.group === "revenue")?.shareAed === 2612.5, b2.groups);
check("what was committed stays committed", (await rowOf(sales)).committedFils === salesCommittedBefore);
check("an employee can't enter collections", (await refused(inOrg(() => budget.enterCollections(vSam, month, 1)), /can't enter/)) === "");

/* ------------------------------------------------------------------ */
console.log("\n11. Corrections are reversals; the ledger is never edited");
const supportEv = await DgoEarningEvent.findById(support.event._id).lean();
check("an employee can't take points back", (await refused(inOrg(() => earning.reverseEarning(vSam, String(support.event._id), "x")), /Only finance/)) === "");
const salesC = (await rowOf(sales)).committedFils;
const rev = await inOrg(() => earning.reverseEarning(vFin1, String(support.event._id), "Duplicate of another award"));
check("finance takes the 15 back: Sam 30", rev.status === "reversed" && (await wallet(sam)) === 30, await wallet(sam));
check("the allowance gets the AED 0.75 back", (await rowOf(sales)).committedFils === salesC - 75);
const rev2 = await inOrg(() => earning.reverseEarning(vFin1, String(support.event._id), "again"));
check("reversing again changes nothing", rev2.status === "reversed" && (await wallet(sam)) === 30 && (await DgoLedgerEntry.countDocuments({ earningEvent: supportEv!._id, type: "reverse" })) === 1);
const anyRow = await DgoLedgerEntry.findOne({}).lean<{ _id: unknown }>();
check("a ledger row can't be updated", (await refused(DgoLedgerEntry.updateOne({ _id: anyRow!._id }, { $set: { delta: 999 } }) as unknown as Promise<unknown>, /never changed/)) === "");
check("…or deleted", (await refused(DgoLedgerEntry.deleteOne({ _id: anyRow!._id }) as unknown as Promise<unknown>, /never changed/)) === "");
check("an audit row can't be deleted", (await refused(DgoAuditEntry.deleteMany({}) as unknown as Promise<unknown>, /never changed/)) === "");

/* ------------------------------------------------------------------ */
console.log("\n12. Versions: changes start today or later; awards keep their version");
const s = rules.settings;
check("settings can't change backwards", (await refused(inOrg(() => settings.saveSettings(vAdmin, { ...s, tiers: s.tiers, effectiveFrom: yesterday })), /never earlier/)) === "");
const v2 = await inOrg(() => settings.saveSettings(vAdmin, { ...s, tiers: s.tiers, dailyCap: 60, effectiveFrom: today, note: "Pilot cap" }));
check("a change is version 2 from today", v2.version === 2 && v2.dailyCap === 60);
const r2 = await inOrg(() => settings.saveRule(vAdmin, "TEAM_SUPPORT", { name: "Team support", description: "Cross-team help", points: 25, needsEvidence: false, chain: ["hr", "head"], capExempt: false, active: true, effectiveFrom: today }));
check("a rule change is a new version, chain kept in order head → HR", r2.version === 2 && r2.points === 25 && r2.chain.join() === "head,hr", r2);
check("Sam's earlier team support keeps version 1 (15 points)", (await DgoEarningEvent.findById(support.event._id).lean<{ ruleVersion: number; points: number }>())?.points === 15);
check("an employee can't change rules", (await refused(inOrg(() => settings.saveRule(vSam, "KPI_MET", { name: "x", description: "", points: 999, needsEvidence: false, chain: [], capExempt: false, active: true, effectiveFrom: today })), /can't change/)) === "");

/* ------------------------------------------------------------------ */
console.log("\n13. Leavers, and every wallet equals its ledger");
await Employee.updateOne({ _id: mona.emp }, { $set: { status: "resigned" } });
check("a leaver can't earn", (await refused(inOrg(() => earning.recordEarning(vHira, { employeeId: mona.emp, ruleCode: "KPI_MET", day: today, reason: "x", requestId: rid() })), /has left/)) === "");
const people = [hana, sam, sara, omar, mona];
let drift = 0;
for (const p of people) if ((await ledger.rebuildWallet(org._id, p.emp)).drifted) drift++;
check("no wallet drifted from the ledger", drift === 0);
const ledgerSum = (await DgoLedgerEntry.aggregate<{ s: number }>([{ $group: { _id: null, s: { $sum: "$delta" } } }]))[0]?.s ?? 0;
const walletSum = (await DgoWallet.aggregate<{ s: number }>([{ $group: { _id: null, s: { $sum: "$available" } } }]))[0]?.s ?? 0;
check(`credits − reversals (${ledgerSum}) = points held (${walletSum})`, ledgerSum === walletSum && ledgerSum > 0);
const audits = await inOrg(() => read.audit(vFin1, {}));
check("the audit log reads back, newest first", audits.rows.length > 5 && audits.rows[0].at >= audits.rows[audits.rows.length - 1].at);
check("an employee can't read it", (await refused(inOrg(() => read.audit(vSam, {})), /can't see/)) === "");

console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass} passed, ${fail} failed\x1b[0m\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
