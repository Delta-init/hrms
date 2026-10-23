/**
 * Checks procurement approval on a scratch database, through ProcurementService.
 *
 * The rule (the user, 2026-10-23, the later word on the day): a record of
 * something already bought needs no approval at all — it stands as entered,
 * ordered or received, and never goes to finance. A new request waits for HR,
 * then goes to finance; nobody approves their own, a Super Admin included.
 *
 *   - a new request waits for HR ("requested"); a bought record is ordered or received at once;
 *   - only requests tell the approvers, never the one who raised it;
 *   - the one who raised a request can't approve or reject it — whoever they are;
 *   - another member approves a request: on to finance (hr_approved, in finance's queue);
 *   - a bought record is in nobody's queue, and can't be "approved";
 *   - a refused request resubmitted waits again; nothing is edited into approval.
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

const org = (await Organization.create({ name: "Delta HQ", code: "HQ" } as never)) as unknown as { _id: mongoose.Types.ObjectId };
const inOrg = <T,>(fn: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => runWithOrg({ orgId: String(org._id), isSuperAdmin: false }, () => { fn().then(resolve, reject); }));
const perms = (approve: boolean) => ({ procurement: { view: true, create: true, edit: true, delete: false, approve, export: false } });
const hrRole = (await Role.create({ roleName: "HR", organization: org._id, permissions: perms(true) } as never)) as unknown as { _id: mongoose.Types.ObjectId };
const staffRole = (await Role.create({ roleName: "Staff", organization: org._id, permissions: perms(false) } as never)) as unknown as { _id: mongoose.Types.ObjectId };
const superRole = (await Role.create({ roleName: "Super Admin", isSystemRole: true, organization: org._id, permissions: perms(true) } as never)) as unknown as { _id: mongoose.Types.ObjectId };
const person = async (name: string, role: unknown) =>
  String(((await User.create({ name, email: `${name.toLowerCase()}@scratch.local`, password: "x".repeat(12), role, organization: org._id, isActive: true } as never)) as unknown as { _id: mongoose.Types.ObjectId })._id);
const hira = await person("Hira", hrRole._id);     // HR, approves
const hamid = await person("Hamid", hrRole._id);   // HR, approves
const sam = await person("Sam", staffRole._id);     // raises only
const boss = await person("Boss", superRole._id);  // Super Admin

const svc = new ProcurementService();
const make = (by: string, over: Record<string, unknown> = {}) => inOrg(() => svc.create({ item: "Laptop", quantity: 1, estimatedCost: 4000, ...over } as never, by)) as Promise<any>;

console.log("\n1. A request waits; a bought record stands as entered");
const req = await make(hira, { kind: "new", item: "Monitor" });
check("a new request waits for HR", req.status === "requested" && req.kind === "new");
const bought = await make(hira, { kind: "existing", item: "Chairs", status: "received" });
check("an already-bought record is received at once — no approval", bought.status === "received", bought.status);
const plain = await make(sam, { kind: "existing", item: "Kettle" });
check("…and one entered without a status is ordered at once", plain.status === "ordered", plain.status);
const told = await Notification.find({}).lean<any[]>();
const to = (n: any) => String(n.recipient ?? n.user ?? "");
check("Hamid is told of Hira's request", told.some((n) => /Monitor/.test(String(n.title)) && to(n) === hamid), JSON.stringify(told.map((n) => [to(n), n.title])));
check("…nobody is asked about the bought records", !told.some((n) => /Chairs|Kettle/.test(String(n.title))), JSON.stringify(told.map((n) => n.title)));
check("…and Hira is never asked about her own", !told.some((n) => to(n) === hira && /Monitor/.test(String(n.title))));

console.log("\n2. Never by the one who raised it");
let why = await refused(inOrg(() => svc.review(req._id, { decision: "approve" } as never, hira)), /another member/);
check("Hira can't approve her own request", !why, why);
const bossOwn = await make(boss, { kind: "new", item: "Desk" });
why = await refused(inOrg(() => svc.review(bossOwn._id, { decision: "approve" } as never, boss)), /another member/);
check("nor a Super Admin theirs", !why, why);
check("…and nothing moved", (await Procurement.countDocuments({ status: "requested" })) === 2);

console.log("\n3. Another member decides; bought records are in no queue");
let done: any = await inOrg(() => svc.review(req._id, { decision: "approve" } as never, hamid));
check("Hamid approves Hira's request: on to finance", done.status === "hr_approved" && String(done.hrReviewedBy?._id ?? done.hrReviewedBy) === hamid);
const queue = await svc.listForFinance(String(org._id));
const ids = (queue as any[]).map((r) => String(r._id));
check("finance's queue has the request, not the bought record", ids.includes(String(req._id)) && !ids.includes(String(bought._id)), JSON.stringify(ids));
why = await refused(inOrg(() => svc.review(bought._id, { decision: "approve" } as never, hamid)), /already been decided/);
check("a bought record has nothing to approve", !why, why);
done = await inOrg(() => svc.review(bossOwn._id, { decision: "reject", note: "Not now" } as never, hira));
check("the Super Admin's own request decided by someone else: rejected", done.status === "rejected" && done.rejectedBy === "hr");
why = await refused(inOrg(() => svc.review(req._id, { decision: "approve" } as never, hira)), /already been decided/);
check("decided once only", !why, why);

console.log("\n4. Rejected, resubmitted, edited");
const again = await make(sam, { kind: "new", item: "Fan" });
await inOrg(() => svc.review(again._id, { decision: "reject" } as never, hamid));
const back: any = await inOrg(() => svc.resubmit(again._id, { item: "Fan (pedestal)" } as never));
check("a refused request resubmitted waits again", back.status === "requested" && back.resubmitCount === 1);
why = await refused(inOrg(() => svc.update(again._id, { status: "cancelled" } as never)), /approving it, not by editing/);
check("a waiting request can't be edited out of approval", !why, why);
const req2 = await make(sam, { kind: "new", item: "Printer" });
why = await refused(inOrg(() => svc.update(req2._id, { status: "approved" } as never)), /approving it/);
check("a request can't be edited into approved", !why, why);
const moved: any = await inOrg(() => svc.update(String(plain._id), { status: "received" } as never));
check("a bought record moves on freely (ordered → received)", moved.status === "received", moved.status);

console.log(`\n${pass} passed, ${fail} failed`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
