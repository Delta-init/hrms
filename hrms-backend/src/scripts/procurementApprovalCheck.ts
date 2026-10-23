/**
 * Checks procurement approval (the user, 2026-10-23: "already-entered procurement didn't need approval, and one HR
 * member does it all — another member needs to approve; already bought doesn't go to finance; no self-approval for
 * anyone") on a scratch database, through ProcurementService:
 *
 *   - a new request and an already-bought record both start waiting for HR ("requested");
 *   - the one who raised it can't approve or reject it — whoever they are, a Super Admin too;
 *   - another member approves: a request goes on to finance (hr_approved, in finance's queue); a bought record becomes
 *     what it was entered as (ordered or received) and is never in finance's queue;
 *   - rejected, either kind; resubmitted, it waits again;
 *   - a waiting record can't be edited out of approval; a bought one's "ordered/received" edit is kept for later;
 *   - who is told: the approvers, never the one who raised it.
 * Refuses anything but a local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/procurement-scratch bun --no-env-file src/scripts/procurementApprovalCheck.ts
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
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

const { ProcurementService } = await import("../services/procurementService.js");
const { runWithOrg } = await import("../utils/orgContext.js");
const { Organization } = await import("../models/Organization.js");
const { Role } = await import("../models/Role.js");
const { User } = await import("../models/User.js");
const { Procurement } = await import("../models/Procurement.js");
const { Notification } = await import("../models/Notification.js");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
async function refused(p: Promise<unknown>, like: RegExp): Promise<string> {
  try { await p; return "not refused"; } catch (e) { const m = (e as Error).message; return like.test(m) ? "" : m; }
}

await mongoose.connect(uri);
await mongoose.connection.dropDatabase();

const org = await Organization.create({ name: "Delta HQ", code: "HQ" } as never);
const inOrg = <T,>(fn: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => runWithOrg({ orgId: String(org._id), isSuperAdmin: false }, () => { fn().then(resolve, reject); }));
const perms = (approve: boolean) => ({ procurement: { view: true, create: true, edit: true, delete: false, approve, export: false } });
const hrRole = await Role.create({ roleName: "HR", organization: org._id, permissions: perms(true) } as never);
const staffRole = await Role.create({ roleName: "Staff", organization: org._id, permissions: perms(false) } as never);
const superRole = await Role.create({ roleName: "Super Admin", isSystemRole: true, organization: org._id, permissions: perms(true) } as never);
const person = async (name: string, role: unknown) =>
  String((await User.create({ name, email: `${name.toLowerCase()}@scratch.local`, password: "x".repeat(12), role, organization: org._id, isActive: true } as never))._id);
const hira = await person("Hira", hrRole._id);     // HR, approves
const hamid = await person("Hamid", hrRole._id);   // HR, approves
const sam = await person("Sam", staffRole._id);     // raises only
const boss = await person("Boss", superRole._id);  // Super Admin

const svc = new ProcurementService();
const make = (by: string, over: Record<string, unknown> = {}) => inOrg(() => svc.create({ item: "Laptop", quantity: 1, estimatedCost: 4000, ...over } as never, by)) as Promise<any>;

console.log("\n1. Both kinds wait for HR");
const req = await make(hira, { kind: "new", item: "Monitor" });
check("a new request waits for HR", req.status === "requested" && req.kind === "new");
const bought = await make(hira, { kind: "existing", item: "Chairs", status: "received" });
check("an already-bought record waits too, remembering it was received", bought.status === "requested" && bought.boughtStatus === "received", JSON.stringify([bought.status, bought.boughtStatus]));
const plain = await make(sam, { kind: "existing", item: "Kettle" });
check("…and one entered without a status will be ordered", plain.boughtStatus === "ordered");
const told = await Notification.find({}).lean<any[]>();
const to = (n: any) => String(n.recipient ?? n.user ?? "");
const aboutHers = told.filter((n) => /Monitor|Chairs/.test(String(n.title)));
check("Hamid is told of Hira's two to approve", aboutHers.filter((n) => to(n) === hamid).length === 2, JSON.stringify(told.map((n) => [to(n), n.title])));
check("…and Hira is never asked to approve her own", !aboutHers.some((n) => to(n) === hira), JSON.stringify(aboutHers.map((n) => [to(n), n.title])));

console.log("\n2. Never by the one who raised it");
let why = await refused(inOrg(() => svc.review(req._id, { decision: "approve" } as never, hira)), /another member/);
check("Hira can't approve her own request", !why, why);
why = await refused(inOrg(() => svc.review(bought._id, { decision: "reject" } as never, hira)), /another member/);
check("…nor reject her own bought record", !why, why);
const bossOwn = await make(boss, { kind: "new", item: "Desk" });
why = await refused(inOrg(() => svc.review(bossOwn._id, { decision: "approve" } as never, boss)), /another member/);
check("nor a Super Admin theirs", !why, why);
check("…and nothing moved", (await Procurement.countDocuments({ status: "requested" })) === 4);

console.log("\n3. Another member decides");
let done: any = await inOrg(() => svc.review(req._id, { decision: "approve" } as never, hamid));
check("Hamid approves Hira's request: on to finance", done.status === "hr_approved" && String(done.hrReviewedBy?._id ?? done.hrReviewedBy) === hamid);
done = await inOrg(() => svc.review(bought._id, { decision: "approve" } as never, hamid));
check("Hamid approves Hira's bought record: it stands as received", done.status === "received", done.status);
const queue = await svc.listForFinance(String(org._id));
const ids = (queue as any[]).map((r) => String(r._id));
check("finance's queue has the request, not the bought record", ids.includes(String(req._id)) && !ids.includes(String(bought._id)), JSON.stringify(ids));
done = await inOrg(() => svc.review(plain._id, { decision: "approve" } as never, hira));
check("Hira approves Sam's: ordered", done.status === "ordered", done.status);
done = await inOrg(() => svc.review(bossOwn._id, { decision: "reject", note: "Not now" } as never, hira));
check("the Super Admin's own request decided by someone else: rejected", done.status === "rejected" && done.rejectedBy === "hr");
why = await refused(inOrg(() => svc.review(req._id, { decision: "approve" } as never, hira)), /already been decided/);
check("decided once only", !why, why);

console.log("\n4. Rejected, resubmitted, edited");
const again = await make(sam, { kind: "existing", item: "Fan" });
await inOrg(() => svc.review(again._id, { decision: "reject" } as never, hamid));
const back: any = await inOrg(() => svc.resubmit(again._id, { item: "Fan (pedestal)" } as never));
check("a bought record refused and resubmitted waits again", back.status === "requested" && back.resubmitCount === 1);
why = await refused(inOrg(() => svc.update(again._id, { status: "cancelled" } as never)), /approving it, not by editing/);
check("a waiting record can't be edited out of approval", !why, why);
const edited: any = await inOrg(() => svc.update(again._id, { status: "received" } as never));
check("a bought one's 'received' edit is kept for when it's approved", edited.status === "requested" && edited.boughtStatus === "received", JSON.stringify([edited.status, edited.boughtStatus]));
const req2 = await make(sam, { kind: "new", item: "Printer" });
why = await refused(inOrg(() => svc.update(req2._id, { status: "approved" } as never)), /approving it/);
check("a request can't be edited into approved", !why, why);
const after: any = await inOrg(() => svc.update(String(bought._id), { status: "cancelled" } as never));
check("an approved bought record can still move on (received → cancelled)", after.status === "cancelled", after.status);

console.log(`\n${pass} passed, ${fail} failed`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
