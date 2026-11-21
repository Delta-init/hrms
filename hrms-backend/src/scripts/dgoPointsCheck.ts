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
 * And Phase 2 (sections 14–20): nominations (limit, never yourself, evidence,
 * the head → HR chain); the rewards store (minimum price, hidden rewards, stock);
 * redemptions (two at once can't overspend, the earliest-expiring points go
 * first, points come back exactly once, nobody handles their own); the
 * leaderboard's three visibilities; monthly achievers (locked under the elite
 * threshold, gift takers passed over, ties picked, verify and approve by two
 * people, prizes paid once from the elite pool); outstanding = issued −
 * redeemed − reversed.
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
const rewardsSvc = await import("../services/dgo/dgoRewardService.js");
const achieversSvc = await import("../services/dgo/dgoAchieverService.js");
const { leaderboard } = await import("../services/dgo/dgoLeaderboardService.js");
const { DgoReward } = await import("../models/DgoReward.js");
const { DgoRedemption } = await import("../models/DgoRedemption.js");
const { DgoBudgetPeriod } = await import("../models/DgoBudgetPeriod.js");
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

/* ================================ Phase 2 ================================ */
const rewardsRole = await mkRole("Rewards", P({ dgoRewards: { view: true, create: true, edit: true, delete: true, approve: true } }));
const directorRole = await mkRole("Director", P({ dgoSettings: { view: true, approve: true } }));
const rhea = await person("Rhea", rewardsRole, null);
const dina = await person("Dina", directorRole, null);
const vRhea = await as(rhea);
const vDina = await as(dina);
const vOmar = await as(omar);
const vSara = await as(sara);
const vHana2 = await as(hana);
const held = async (p: { emp: string }) => (await DgoWallet.findOne({ employee: p.emp }).lean<{ reserved: number }>())?.reserved ?? 0;
const notes = (p: { user: string }, title: RegExp) => Notification.countDocuments({ user: p.user, title });

/* ------------------------------------------------------------------ */
console.log("\n14. Phase 2 settings: leaderboard, nomination limit, achiever categories");
const prog0 = await settings.programSettings(orgId);
check("defaults: leaderboard for everyone, 4 nominations a month", prog0.leaderboardVisibility === "everyone" && prog0.nominationsPerMonth === 4);
check("nine achiever categories worth AED 13,250, mentors off", prog0.eliteCategories.length === 9 && prog0.eliteCategories.reduce((s, c) => s + c.prizeAed, 0) === 13250 && prog0.eliteCategories.filter((c) => !c.active).every((c) => c.code.startsWith("MENTOR_")));
await inOrg(() => settings.saveProgram(vAdmin, { nominationsPerMonth: 2 }));
check("the limit can be changed (2 for this run)", (await settings.programSettings(orgId)).nominationsPerMonth === 2);
check("a mentor threshold is a score out of 100", (await refused(inOrg(() => settings.saveProgram(vAdmin, { eliteCategories: [{ code: "MENTOR_CHIEF", threshold: 150, prizeAed: 1500, active: true }] })), /out of 100/)) === "");
check("unknown categories are refused", (await refused(inOrg(() => settings.saveProgram(vAdmin, { eliteCategories: [{ code: "BEST_DRIVER", threshold: 1, prizeAed: 1, active: true }] })), /Unknown category/)) === "");
check("rule codes starting ELITE_ are kept for prizes", (await refused(inOrg(() => settings.saveRule(vAdmin, "ELITE_SALES_1", { name: "x", description: "", points: 1, needsEvidence: false, chain: [], capExempt: false, active: true, effectiveFrom: today })), /kept for monthly achiever/)) === "");
check("an employee can't change these", (await refused(inOrg(() => settings.saveProgram(vSam, { nominationsPerMonth: 50 })), /can't change/)) === "");
const meSam = await inOrg(() => read.me(vSam));
check("/me: Sam may nominate, no store or achiever staff rights", meSam.can.nominate && !meSam.can.rewardsManage && !meSam.can.rewardsFulfil && !meSam.can.achieversRun, meSam.can);
const meRhea = await inOrg(() => read.me(vRhea));
check("/me: the rewards role manages and fulfils", meRhea.can.rewardsManage && meRhea.can.rewardsFulfil && meRhea.can.rewardsView);

/* ------------------------------------------------------------------ */
console.log("\n15. Nominations");
// Section 8 moved Sara to Media; she moves back to Sales (headed by Hana) for these.
await Employee.updateOne({ _id: sara.emp }, { $set: { department: sales._id } });
const nomOmar = await inOrg(() => earning.nominate(vSam, { employeeId: omar.emp, ruleCode: "TEAM_SUPPORT", day: today, reason: "Fixed our campaign sheet at 9pm", requestId: rid() }));
check("Sam nominates Omar: pending, Media has no head so HR decides", nomOmar.event.status === "pending" && nomOmar.event.stage === "hr" && nomOmar.event.origin === "nomination", nomOmar.event);
check("never yourself", (await refused(inOrg(() => earning.nominate(vSam, { employeeId: sam.emp, ruleCode: "TEAM_SUPPORT", day: today, reason: "me", requestId: rid() })), /nominate yourself/)) === "");
check("…refused and audited", (await DgoAuditEntry.countDocuments({ action: "nomination_refused" })) === 1);
check("the same person, award and day twice is refused", (await refused(inOrg(() => earning.nominate(vSam, { employeeId: omar.emp, ruleCode: "TEAM_SUPPORT", day: today, reason: "again", requestId: rid() })), /already nominated/)) === "");
const sameReq = await inOrg(() => earning.nominate(vSam, { employeeId: omar.emp, ruleCode: "TEAM_SUPPORT", day: today, reason: "dup", requestId: nomOmar.event.idempotencyKey.split(":").slice(2).join(":") }));
check("the same request twice is one nomination", sameReq.duplicate && String(sameReq.event._id) === String(nomOmar.event._id));
check("KPI points can't be nominated", (await refused(inOrg(() => earning.nominate(vSam, { employeeId: sara.emp, ruleCode: "KPI_MET", day: today, reason: "x", requestId: rid() })), /daily KPI/)) === "");
check("evidence needed where the rule says (note or file)", (await refused(inOrg(() => earning.nominate(vSam, { employeeId: sara.emp, ruleCode: "ISSUE_RESOLVED", day: today, reason: "Solved the refund mess", requestId: rid() })), /needs evidence/)) === "");
check("a file that isn't the nominator's own upload is refused", (await refused(inOrg(() => earning.nominate(vSam, { employeeId: sara.emp, ruleCode: "ISSUE_RESOLVED", day: today, reason: "x", evidenceKey: `${orgId}/dgo-evidence/${omar.user}/1.pdf`, requestId: rid() })), /Upload the file again/)) === "");
const nomSara = await inOrg(() => earning.nominate(vSam, { employeeId: sara.emp, ruleCode: "ISSUE_RESOLVED", day: today, reason: "Solved the refund mess", evidenceKey: `${orgId}/dgo-evidence/${sam.user}/1700000000000.pdf`, evidenceName: "thread.pdf", requestId: rid() }));
check("with a file: waits for Sales' head (Hana)", nomSara.event.stage === "head" && nomSara.event.evidenceName === "thread.pdf", nomSara.event);
check("the third nomination this month is over the limit", (await refused(inOrg(() => earning.nominate(vSam, { employeeId: hana.emp, ruleCode: "TEAM_SUPPORT", day: today, reason: "x", requestId: rid() })), /all 2 of your nominations/)) === "");
check("the nominator can't approve it", (await refused(inOrg(() => earning.decide(vSam, String(nomSara.event._id), true)), /Waiting for the head|You recorded/)) === "");
await inOrg(() => earning.decide(vHana2, String(nomSara.event._id), true, "Saw it happen"));
const saraBefore = await wallet(sara);
const nomPosted = await inOrg(() => earning.decide(vHira, String(nomSara.event._id), true));
check("head then HR approve: Sara +30", nomPosted.event.status === "posted" && (await wallet(sara)) === saraBefore + 30, nomPosted.message);
check("Sam is told his nomination was approved", (await notes(sam, /nomination of Sara was approved/)) === 1);
await inOrg(() => earning.decide(vHira, String(nomOmar.event._id), false, "Already rewarded through his own team"));
check("a rejected nomination tells the nominator", (await notes(sam, /nomination of Omar wasn't approved/)) === 1);
const nv = await inOrg(() => read.nominationsView(vSam, "sent"));
check("Sam's page: 2 sent, none left, award rules only", nv.counts.sent === 2 && nv.left === 0 && nv.rules.length > 0 && nv.rules.every((r) => !r.code.startsWith("KPI")), { counts: nv.counts, left: nv.left });
const nvSara = await inOrg(() => read.nominationsView(vSara, "received"));
check("Sara sees the nomination she received", nvSara.items.length === 1 && nvSara.items[0].origin === "nomination" && nvSara.items[0].evidenceName === "thread.pdf");
const col = await inOrg(() => read.colleagues(vSam));
check("the colleague picker leaves Sam out", col.length > 3 && !col.some((c) => c.id === sam.emp));

/* ------------------------------------------------------------------ */
console.log("\n16. The rewards catalogue");
const base = { description: "", category: "Voucher", photoKey: null, costAed: 40, stockMode: "unlimited" as const, stock: null, status: "active" as const };
check("an employee can't add rewards", (await refused(inOrg(() => rewardsSvc.createReward(vSam, { ...base, name: "Free lunch", points: 1000 })), /can't add/)) === "");
check("nothing below the 1,000-point minimum", (await refused(inOrg(() => rewardsSvc.createReward(vRhea, { ...base, name: "Pen", points: 500 })), /at least 1,000/)) === "");
check("a photo must be a rewards upload", (await refused(inOrg(() => rewardsSvc.createReward(vRhea, { ...base, name: "Mug", points: 1000, photoKey: `${orgId}/receipts/x.jpg` })), /photo again/)) === "");
const mug = await inOrg(() => rewardsSvc.createReward(vRhea, { ...base, name: "Mug", points: 1000, photoKey: `${orgId}/dgo-rewards/${rhea.user}/1.jpg` }));
const voucher = await inOrg(() => rewardsSvc.createReward(vRhea, { ...base, name: "Cinema voucher", points: 1000, stockMode: "limited", stock: 1 }));
const secret = await inOrg(() => rewardsSvc.createReward(vRhea, { ...base, name: "Secret", points: 2000, status: "hidden" }));
const big = await inOrg(() => rewardsSvc.createReward(vRhea, { ...base, name: "Headphones", points: 50_000, category: "Gadget" }));
const storeSam = await inOrg(() => rewardsSvc.rewardsView(vSam, false));
check("the store shows active rewards only, no costs", storeSam.rewards.length === 3 && !storeSam.rewards.some((r) => r.name === "Secret") && storeSam.rewards.every((r) => r.costAed === null), storeSam.rewards.map((r) => r.name));
check("the catalogue shows hidden ones too, with costs", (await inOrg(() => rewardsSvc.rewardsView(vRhea, true))).rewards.length === 4);
check("an employee can't open the catalogue", (await refused(inOrg(() => rewardsSvc.rewardsView(vSam, true)), /can't manage/)) === "");
check("prices show what they're worth: 1,000 points = AED 50", storeSam.rewards.find((r) => r.name === "Mug")?.aed === 50);
await inOrg(() => rewardsSvc.updateReward(vRhea, big.id, { ...base, name: "Headphones", points: 1500, category: "Gadget" }));
check("a price change is audited", (await DgoAuditEntry.countDocuments({ action: "reward_changed" })) === 1);

/* ------------------------------------------------------------------ */
console.log("\n17. Redemptions: held at once, never overspent, given back once");
await inOrg(() => settings.saveRule(vAdmin, "BONUS_TEST", { name: "Test bonus", description: "", points: 1200, needsEvidence: false, chain: [], capExempt: true, active: true, effectiveFrom: today }));
for (const p of [sam, sara, hana, rhea]) await inOrg(() => earning.recordEarning(vHira, { employeeId: p.emp, ruleCode: "BONUS_TEST", day: today, reason: "Test balance", requestId: rid() }));
const samHas = await wallet(sam);
check("Sam has over 1,000 and under 2,000 to spend", samHas >= 1000 && samHas < 2000, samHas);
const noChainNom = await inOrg(() => earning.nominate(vHira, { employeeId: omar.emp, ruleCode: "BONUS_TEST", day: today, reason: "A rule with no approvers", requestId: rid() }));
check("a nomination under a rule with no approvers still waits for HR (Media has no head)", noChainNom.event.status === "pending" && noChainNom.event.stage === "hr" && noChainNom.event.chain.join() === "hr", noChainNom.event);
await inOrg(() => earning.decide(vBoss, String(noChainNom.event._id), false, "Test only"));
const rq1 = rid(), rq2 = rid();
const both = await Promise.allSettled([
  inOrg(() => rewardsSvc.redeem(vSam, { rewardId: mug.id, requestId: rq1 })),
  inOrg(() => rewardsSvc.redeem(vSam, { rewardId: mug.id, requestId: rq2 })),
]);
const okOnes = both.filter((b) => b.status === "fulfilled");
const noOnes = both.filter((b) => b.status === "rejected") as PromiseRejectedResult[];
check("two redemptions at the same moment: exactly one holds the points", okOnes.length === 1 && noOnes.length === 1 && /Not enough points/.test(String(noOnes[0]?.reason?.message)), both.map((b) => b.status === "fulfilled" ? "ok" : (b as PromiseRejectedResult).reason?.message));
check("…wallet: 1,000 fewer to spend, 1,000 held, never below zero", (await wallet(sam)) === samHas - 1000 && (await held(sam)) === 1000);
check("…one reserve row, no half-made request left", (await DgoLedgerEntry.countDocuments({ employee: sam.emp, type: "reserve" })) === 1 && (await DgoRedemption.countDocuments({ employee: sam.emp })) === 1);
const lotsHeld = await DgoPointLot.find({ employee: sam.emp, reserved: { $gt: 0 } }).lean<Array<{ reserved: number }>>();
check("…the batches hold exactly 1,000", lotsHeld.reduce((s, l) => s + l.reserved, 0) === 1000);
const okId = (okOnes[0] as PromiseFulfilledResult<{ redemption: { id: string } }>).value.redemption.id;
const okReq = (await DgoRedemption.findById(okId).lean<{ idempotencyKey: string }>())!.idempotencyKey.split(":").slice(2).join(":");
const dupR = await inOrg(() => rewardsSvc.redeem(vSam, { rewardId: mug.id, requestId: okReq }));
check("the same request again is the same redemption", dupR.duplicate && dupR.redemption.id === okId);
check("a hidden reward can't be redeemed", (await refused(inOrg(() => rewardsSvc.redeem(vSara, { rewardId: secret.id, requestId: rid() })), /isn't available/)) === "");
// Stock of one, two people at once.
const stockRace = await Promise.allSettled([
  inOrg(() => rewardsSvc.redeem(vSara, { rewardId: voucher.id, requestId: rid() })),
  inOrg(() => rewardsSvc.redeem(vHana2, { rewardId: voucher.id, requestId: rid() })),
]);
const stockOk = stockRace.filter((b) => b.status === "fulfilled");
check("one voucher in stock, two asking at once: one gets it, one is told it's out", stockOk.length === 1 && stockRace.some((b) => b.status === "rejected" && /out of stock/.test(String((b as PromiseRejectedResult).reason?.message))), stockRace.map((b) => b.status === "fulfilled" ? "ok" : (b as PromiseRejectedResult).reason?.message));
check("…stock is 0, never below", (await DgoReward.findById(voucher.id).lean<{ stock: number }>())?.stock === 0);
const voucherR = (stockOk[0] as PromiseFulfilledResult<{ redemption: { id: string; employee: { id: string } } }>).value.redemption;
const loser = voucherR.employee.id === sara.emp ? hana : sara;
check("…the one turned away keeps every point", (await held(loser)) === 0);
// Sara's earliest batch goes first.
const saraLots = await DgoPointLot.find({ employee: sara.emp }).sort({ expiresOn: 1, _id: 1 }).lean<Array<{ expiresOn: string; remaining: number; reserved: number }>>();
if (voucherR.employee.id === sara.emp) {
  const firstPartly = saraLots.findIndex((l) => l.reserved < l.remaining);
  check("Sara's points were held from the batches that expire first", saraLots.slice(0, Math.max(0, firstPartly)).every((l) => l.reserved === l.remaining) && saraLots.slice(firstPartly + 1).every((l) => l.reserved === 0), saraLots);
} else {
  const hanaLots = await DgoPointLot.find({ employee: hana.emp }).sort({ expiresOn: 1, _id: 1 }).lean<Array<{ expiresOn: string; remaining: number; reserved: number }>>();
  const firstPartly = hanaLots.findIndex((l) => l.reserved < l.remaining);
  check("Hana's points were held from the batches that expire first", hanaLots.slice(0, Math.max(0, firstPartly)).every((l) => l.reserved === l.remaining) && hanaLots.slice(firstPartly + 1).every((l) => l.reserved === 0), hanaLots);
}
// Cancel, then again.
check("someone else can't cancel Sam's", (await refused(inOrg(() => rewardsSvc.cancelRedemption(vOmar, okId)), /Only the person/)) === "");
const c1 = await inOrg(() => rewardsSvc.cancelRedemption(vSam, okId));
check("Sam cancels: every point back to spend", c1.redemption.status === "cancelled" && (await wallet(sam)) === samHas && (await held(sam)) === 0);
const c2 = await inOrg(() => rewardsSvc.cancelRedemption(vSam, okId));
check("cancelling again changes nothing (one release row)", c2.message === "Already done" && (await DgoLedgerEntry.countDocuments({ employee: sam.emp, type: "release" })) === 1 && (await wallet(sam)) === samHas);
check("…and no batch still holds anything", (await DgoPointLot.countDocuments({ employee: sam.emp, reserved: { $gt: 0 } })) === 0);
// Approve and deliver.
const again3 = await inOrg(() => rewardsSvc.redeem(vSam, { rewardId: mug.id, note: "Blue please", requestId: rid() }));
check("an employee can't approve", (await refused(inOrg(() => rewardsSvc.approveRedemption(vSam, again3.redemption.id)), /Only HR/)) === "");
check("delivering before approving is refused", (await refused(inOrg(() => rewardsSvc.fulfilRedemption(vRhea, again3.redemption.id)), /Approve it first/)) === "");
const ap = await inOrg(() => rewardsSvc.approveRedemption(vRhea, again3.redemption.id));
check("HR approves; points still held", ap.redemption.status === "approved" && (await held(sam)) === 1000);
check("once approved, the employee can't cancel", (await refused(inOrg(() => rewardsSvc.cancelRedemption(vSam, again3.redemption.id)), /ask HR/)) === "");
const fulfilOnce = () => inOrg(() => rewardsSvc.fulfilRedemption(vRhea, again3.redemption.id, "Handed over at reception"))
  .catch((e: Error) => ({ message: e.message, redemption: null as null | { status: string } }));
const [f1, f2] = await Promise.all([fulfilOnce(), fulfilOnce()]);
check("delivered (two clicks at once): the 1,000 are spent once",
  [f1, f2].some((f) => f.redemption?.status === "fulfilled") && (await DgoRedemption.findById(again3.redemption.id).lean<{ status: string }>())?.status === "fulfilled" && (await DgoLedgerEntry.countDocuments({ employee: sam.emp, type: "redeem" })) === 1,
  [f1.message, f2.message]);
const wSam = await DgoWallet.findOne({ employee: sam.emp }).lean<{ available: number; reserved: number; redeemed: number }>();
check("…Sam: 1,000 fewer, nothing held, 1,000 redeemed", wSam?.available === samHas - 1000 && wSam?.reserved === 0 && wSam?.redeemed === 1000, wSam);
check("…the batches lost 1,000 in all", (await DgoPointLot.aggregate<{ s: number }>([{ $match: { employee: new mongoose.Types.ObjectId(sam.emp) } }, { $group: { _id: null, s: { $sum: "$remaining" } } }]))[0]?.s === samHas - 1000);
check("Sam was told it's ready", (await notes(sam, /^Ready: Mug/)) === 1);
// Reject gives back once, and the stock.
const rj = await inOrg(() => rewardsSvc.rejectRedemption(vRhea, voucherR.id, "Supplier ran out"));
const winner = voucherR.employee.id === sara.emp ? sara : hana;
check("HR rejects the voucher: points back, stock back to 1", rj.redemption.status === "rejected" && (await held(winner)) === 0 && (await DgoReward.findById(voucher.id).lean<{ stock: number }>())?.stock === 1);
const rj2 = await inOrg(() => rewardsSvc.rejectRedemption(vRhea, voucherR.id, "again"));
check("rejecting again changes nothing", rj2.message === "Already done" && (await DgoLedgerEntry.countDocuments({ redemption: new mongoose.Types.ObjectId(voucherR.id), type: "release" })) === 1 && (await DgoReward.findById(voucher.id).lean<{ stock: number }>())?.stock === 1);
// Nobody handles their own.
const ownR = await inOrg(() => rewardsSvc.redeem(vRhea, { rewardId: mug.id, requestId: rid() }));
check("HR can't approve their own redemption", (await refused(inOrg(() => rewardsSvc.approveRedemption(vRhea, ownR.redemption.id)), /your own redemption/)) === "");
check("…refused and audited", (await DgoAuditEntry.countDocuments({ action: "redemption_refused" })) === 1);
check("…another approver (a Super Admin) can", (await inOrg(() => rewardsSvc.approveRedemption(vBoss, ownR.redemption.id))).redemption.status === "approved");
const queue = await inOrg(() => rewardsSvc.redemptionsView(vRhea, "queue"));
check("HR's queue lists what waits; an employee can't see it", queue.items.some((i) => i.id === ownR.redemption.id) && (await refused(inOrg(() => rewardsSvc.redemptionsView(vSam, "queue")), /other people's/)) === "");
const tooDear = await refused(inOrg(() => rewardsSvc.redeem(vOmar, { rewardId: big.id, requestId: rid() })), /Not enough points/);
check("not enough points says so, nothing changes", tooDear === "" && (await held(omar)) === 0);

/* ------------------------------------------------------------------ */
console.log("\n18. Leaderboard: three visibilities");
const lbAll = await inOrg(() => leaderboard(vSam, {}));
check("everyone: Sam sees the whole organisation, ties share a rank", lbAll.scope === "company" && lbAll.rows.some((r) => r.name === "Omar") && lbAll.rows.every((r, i, a) => i === 0 || a[i - 1].points > r.points ? true : a[i - 1].rank === r.rank), lbAll.rows.map((r) => [r.rank, r.name, r.points]));
check("…and his own line", lbAll.me?.rank != null && lbAll.rows.some((r) => r.me));
await inOrg(() => settings.saveProgram(vAdmin, { leaderboardVisibility: "department" }));
const lbDept = await inOrg(() => leaderboard(vSam, {}));
check("department: Sam sees Sales only", lbDept.scope === "department" && lbDept.rows.length > 0 && lbDept.rows.every((r) => r.department === "Sales"), lbDept.rows.map((r) => r.department));
check("…can't ask for Media", (await refused(inOrg(() => leaderboard(vSam, { department: String(media._id) })), /can't see/)) === "");
check("…HR still sees everybody", (await inOrg(() => leaderboard(vHira, {}))).scope === "company");
await inOrg(() => settings.saveProgram(vAdmin, { leaderboardVisibility: "managers" }));
const lbOwn = await inOrg(() => leaderboard(vSam, {}));
check("managers only: Sam sees just his own rank", lbOwn.scope === "own" && lbOwn.rows.length === 0 && (lbOwn.me?.rank ?? 0) >= 1, lbOwn.me);
check("…Hana, a head, sees her department", (await inOrg(() => leaderboard(vHana2, {}))).scope === "department");
await inOrg(() => settings.saveProgram(vAdmin, { leaderboardVisibility: "everyone" }));

/* ------------------------------------------------------------------ */
console.log("\n19. Monthly achievers");
const m1 = previousMonth(month);              // the month decided here (settings v1 start at its first day)
const fake = (m: string): import("../services/dgo/dgoAchieverService.js").RootMetrics => ({
  month: m,
  sales: [
    { email: "sam@scratch.local", name: "Sam", crm: "delta", team: "Alpha", salesAed: 60_000, giftClaimed: false },
    { email: "sam@scratch.local", name: "Sam", crm: "draw", team: "Alpha", salesAed: 5_000, giftClaimed: false },
    { email: "sara@scratch.local", name: "Sara", crm: "delta", team: "Alpha", salesAed: 70_000, giftClaimed: true },
    { email: "omar@scratch.local", name: "Omar", crm: "remote", team: "Beta", salesAed: 52_000, giftClaimed: false },
    { email: "rhea@scratch.local", name: "Rhea", crm: "delta", team: "Alpha", salesAed: 52_000, giftClaimed: false },
    { email: "stranger@elsewhere.test", name: "Stranger", crm: "draw", team: "Beta", salesAed: 90_000, giftClaimed: false },
    { email: "fin1@scratch.local", name: "Fin1", crm: "delta", team: "Alpha", salesAed: 20_000, giftClaimed: false },
  ],
  teams: [{ crm: "delta", team: "Alpha", leaderEmail: "hana@scratch.local", leaderName: "Hana", salesAed: 120_000, leaderGiftClaimed: false }],
  cs: [
    { email: "omar@scratch.local", name: "Omar", role: "cs", collectedAed: 110_000 },
    { email: "mona@scratch.local", name: "Mona", role: "cs", collectedAed: 150_000 },
    { email: "hira@scratch.local", name: "Hira", role: "cs_manager", collectedAed: 0 },
  ],
  csDepartment: { collectedAed: 400_000 },
  mentors: [{ email: "adam@scratch.local", name: "Adam", role: "chief_mentor", score: 95, coverage: 31 }],
  problems: ["Draw CRM was slow (test)"],
});
achieversSvc.setRootFetcherForTest(async (m) => fake(m));
check("an employee can't fetch figures", (await refused(inOrg(() => achieversSvc.fetchAchievers(vSam, m1)), /can't fetch/)) === "");
check("the month in progress can't be decided", (await refused(inOrg(() => achieversSvc.fetchAchievers(vAdmin, month)), /once the month is over/)) === "");
const prov = await inOrg(() => achieversSvc.fetchAchievers(vAdmin, m1));
const cat = (code: string) => prov.categories.find((c) => c.code === code)!;
check("fetched before collections are confirmed: provisional, Root's problems shown", prov.status === "provisional" && prov.problems.length === 1);
check("Sales first: Sam (AED 65,000 over Delta + Draw) — the stranger not in HRMS is passed over", cat("SALES_1").winner?.name === "Sam" && cat("SALES_1").candidates.some((c) => c.name === "Stranger" && c.why === "Not found in HRMS"), cat("SALES_1"));
check("…Sara took a gift this month, so she's passed over", cat("SALES_1").candidates.some((c) => c.name === "Sara" && c.why === "Took a gift this month"));
check("Sales second: Omar and Rhea tie at AED 52,000 — a person picks", cat("SALES_2").tie && !cat("SALES_2").winner && cat("SALES_2").candidates.filter((c) => c.tied).length === 2, cat("SALES_2"));
check("Best team leader: Hana (team AED 120,000)", cat("TEAM_LEADER").winner?.name === "Hana");
check("CS first: Omar; Mona has left so isn't matched", cat("CSE_1").winner?.name === "Omar" && cat("CSE_1").candidates.some((c) => c.name === "Mona" && c.why === "Not found in HRMS"));
check("CS second: nobody else qualifies", !cat("CSE_2").winner && !cat("CSE_2").tie);
check("CS manager: Hira (department AED 400,000)", cat("CSE_MANAGER").winner?.name === "Hira");
check("mentor categories are off: not ranked", !prov.categories.some((c) => c.code.startsWith("MENTOR_")));
check("prize points: AED 2,000 = 40,000 points", cat("SALES_1").prizePoints === 40_000);
check("finance can't verify until the month's collections are confirmed", (await refused(inOrg(() => achieversSvc.verifyAchievers(vFin2, m1)), /hasn't confirmed/)) === "");
await inOrg(() => budget.enterCollections(vFin1, m1, 900_000));
await inOrg(() => budget.confirmCollections(vFin2, m1));
const locked = await inOrg(() => achieversSvc.fetchAchievers(vAdmin, m1));
check("AED 900,000 confirmed: locked, nothing to award", locked.status === "locked" && /need AED 1,200,000/.test(locked.lockedReason ?? ""), locked.lockedReason);
check("…and can't be verified", (await refused(inOrg(() => achieversSvc.verifyAchievers(vFin2, m1)), /AED 1,200,000|Locked/)) === "");
await inOrg(() => budget.enterCollections(vFin1, m1, 1_300_000, "Late receipts reconciled"));
await inOrg(() => budget.confirmCollections(vFin2, m1));
const reopened = await inOrg(() => achieversSvc.fetchAchievers(vAdmin, m1));
check("corrected to AED 1.3m and fetched again: provisional", reopened.status === "provisional" && reopened.pool.eliteAed === 13250, reopened.pool);
check("…nor while a tie is open", (await refused(inOrg(() => achieversSvc.verifyAchievers(vFin2, m1)), /tie/)) === "");
check("an employee can't pick", (await refused(inOrg(() => achieversSvc.pickWinner(vSam, m1, "SALES_2", "rhea@scratch.local")), /can't pick/)) === "");
check("only a tied candidate can be picked", (await refused(inOrg(() => achieversSvc.pickWinner(vAdmin, m1, "SALES_2", "fin1@scratch.local")), /tied candidates/)) === "");
const picked = await inOrg(() => achieversSvc.pickWinner(vAdmin, m1, "SALES_2", "rhea@scratch.local"));
check("the admin picks Rhea for Sales second", picked.categories.find((c) => c.code === "SALES_2")?.winner?.name === "Rhea");
check("the admin (not finance) can't verify", (await refused(inOrg(() => achieversSvc.verifyAchievers(vAdmin, m1)), /Only finance/)) === "");
const ver1 = await inOrg(() => achieversSvc.verifyAchievers(vBoss, m1));
check("verified (by a Super Admin this time)", ver1.status === "verified" && ver1.pool.eliteAed === 13250 && ver1.pool.prizesAed === 9500 && ver1.pool.fits, ver1.pool);
check("whoever verified can't also approve", (await refused(inOrg(() => achieversSvc.approveAchievers(vBoss, m1)), /someone else approves/)) === "");
check("…refused and audited", (await DgoAuditEntry.countDocuments({ action: "achievers_refused" })) === 1);
check("figures can't be fetched again once verified", (await refused(inOrg(() => achieversSvc.fetchAchievers(vAdmin, m1)), /send it back/)) === "");
const back = await inOrg(() => achieversSvc.sendBackAchievers(vDina, m1, "Recheck Omar's CS total"));
check("the director sends it back: provisional again", back.status === "provisional");
const ver2 = await inOrg(() => achieversSvc.verifyAchievers(vFin2, m1, "Matches finance"));
check("finance verifies", ver2.status === "verified" && ver2.can.approve === false);
const before = { sam: await wallet(sam), hana: await wallet(hana), omar: await wallet(omar), hira: await wallet(hira), rhea: await wallet(rhea) };
const approveOnce = () => inOrg(() => achieversSvc.approveAchievers(vDina, m1, "Congratulations"))
  .catch((e: Error) => ({ status: "error", message: e.message }));
const [pub1, pub2] = await Promise.all([approveOnce(), approveOnce()]);
const afterPub = await inOrg(() => achieversSvc.achieversView(vDina, m1));
check("the director approves (two clicks at once): published", afterPub.status === "published", [pub1.message, pub2.message]);
const eliteCredits = await DgoLedgerEntry.countDocuments({ ruleCode: /^ELITE_/, type: "credit" });
check("five prizes, each paid once", eliteCredits === 5, eliteCredits);
check("Sam +40,000, Hana +60,000 (team), Omar +40,000 (CS), Hira +30,000, Rhea +20,000",
  (await wallet(sam)) === before.sam + 40_000 && (await wallet(hana)) === before.hana + 60_000 && (await wallet(omar)) === before.omar + 40_000 && (await wallet(hira)) === before.hira + 30_000 && (await wallet(rhea)) === before.rhea + 20_000,
  { sam: (await wallet(sam)) - before.sam, hana: (await wallet(hana)) - before.hana, omar: (await wallet(omar)) - before.omar, hira: (await wallet(hira)) - before.hira, rhea: (await wallet(rhea)) - before.rhea });
const p1 = await DgoBudgetPeriod.findOne({ organization: orgId, month: m1 }).lean<{ eliteCommittedFils: number; eliteFils: number }>();
check("the elite pool took AED 9,500 of its 13,250", p1?.eliteCommittedFils === 950_000 && p1.eliteFils === 1_325_000, p1);
const pubAgain = await inOrg(() => achieversSvc.approveAchievers(vDina, m1));
check("approving again pays nothing more", /Already published/.test(pubAgain.message) && (await DgoLedgerEntry.countDocuments({ ruleCode: /^ELITE_/, type: "credit" })) === 5);
check("Sam was told he's an achiever", (await notes(sam, /monthly achiever: Sales/)) === 1);
const pubView = await inOrg(() => achieversSvc.achieversView(vSam, m1));
check("employees see the published winners only — no candidates, no emails, no figures", !pubView.review && pubView.categories.length === 5 && pubView.categories.every((c) => c.candidates.length === 0 && c.winner?.email === "" && c.award), pubView.categories.map((c) => c.code));
const lbM1 = await inOrg(() => leaderboard(vSam, { month: m1 }));
check("prizes stay off the points leaderboard", !lbM1.rows.some((r) => r.points >= 20_000), lbM1.rows.map((r) => [r.name, r.points]));
check("prizes never show in the department approvals queue", !(await inOrg(() => read.approvals(vHira, "waiting"))).items.some((i) => i.origin === "elite"));
const samPrize = await DgoEarningEvent.findOne({ idempotencyKey: `ELITE:${orgId}:${m1}:SALES_1` }).lean<{ _id: unknown }>();
await inOrg(() => earning.reverseEarning(vFin1, String(samPrize!._id), "Sale refunded after the month"));
check("a prize taken back goes back to the elite pool, not a department's", (await DgoBudgetPeriod.findOne({ organization: orgId, month: m1 }).lean<{ eliteCommittedFils: number }>())?.eliteCommittedFils === 750_000 && (await wallet(sam)) === before.sam);
const afterTakeBack = await inOrg(() => achieversSvc.achieversView(vSam, m1));
check("…and is no longer announced to employees (reviewers still see it, marked)", afterTakeBack.categories.length === 4 && !afterTakeBack.categories.some((c) => c.code === "SALES_1")
  && (await inOrg(() => achieversSvc.achieversView(vDina, m1))).categories.find((c) => c.code === "SALES_1")?.award?.takenBack === true);
achieversSvc.setRootFetcherForTest(null);

/* ------------------------------------------------------------------ */
console.log("\n20. Every point accounted for");
let drift2 = 0;
for (const p of [hana, sam, sara, omar, mona, hira, rhea]) if ((await ledger.rebuildWallet(org._id, p.emp)).drifted) drift2++;
check("no wallet drifted from the ledger (held and spent included)", drift2 === 0);
const byType = Object.fromEntries((await DgoLedgerEntry.aggregate<{ _id: string; d: number; h: number }>([{ $group: { _id: "$type", d: { $sum: "$delta" }, h: { $sum: "$reservedDelta" } } }])).map((r) => [r._id, r]));
const issued = byType.credit?.d ?? 0, reversed = -(byType.reverse?.d ?? 0), redeemed = -(byType.redeem?.h ?? 0);
const outstanding = (await DgoWallet.aggregate<{ s: number }>([{ $group: { _id: null, s: { $sum: { $add: ["$available", "$reserved"] } } } }]))[0]?.s ?? 0;
check(`issued ${issued} − redeemed ${redeemed} − reversed ${reversed} = outstanding ${outstanding} (spendable + held)`, issued - redeemed - reversed === outstanding && redeemed === 1000, { issued, redeemed, reversed, outstanding });
const heldNow = (await DgoWallet.aggregate<{ s: number }>([{ $group: { _id: null, s: { $sum: "$reserved" } } }]))[0]?.s ?? 0;
const heldLots = (await DgoPointLot.aggregate<{ s: number }>([{ $group: { _id: null, s: { $sum: "$reserved" } } }]))[0]?.s ?? 0;
check(`points held in wallets (${heldNow}) = points held in batches (${heldLots}) = open redemptions`, heldNow === heldLots && heldNow === 1000, { heldNow, heldLots });

console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass} passed, ${fail} failed\x1b[0m\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
