/**
 * Tasks handed in with several documents (2026-11-26: "Submit all your credentials…" was approved with nothing to see —
 * one file at most, none attached, and the panel showed nothing at all then). On a scratch database, through the task
 * service: several documents at once, each named; a send-back and a second round add to them, never wipe them; the
 * history says which documents each round had; an empty submission comes back with no documents (the panel says
 * "Nothing attached"); proof required takes any document handed in before; a task from before keeps its one file.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-taskdocs-scratch JWT_SECRET=<32+> JWT_REFRESH_SECRET=<32+> \
 *   SUPER_ADMIN_EMAIL=sa@e2e.test SUPER_ADMIN_PASSWORD=x DOTENV_CONFIG_PATH=/nonexistent \
 *   bun --no-env-file src/scripts/taskDocumentsCheck.ts
 */
import mongoose, { Types } from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) { console.error(`Refusing: needs a local scratch database, got ${uri}`); process.exit(1); }
try { Bun.resolveSync("web-push", import.meta.dir); } catch {
  Bun.plugin({ name: "stub-web-push", setup(build) { build.module("web-push", () => ({ exports: { default: { setVapidDetails() {}, async sendNotification() {} } }, loader: "object" })); } });
}
let failures = 0, checks = 0;
const check = (label: string, ok: boolean, detail = "") => { checks++; if (ok) console.log(`  ✓ ${label}`); else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); } };
const j = (v: unknown) => String(JSON.stringify(v)).slice(0, 500);

await mongoose.connect(uri);
await mongoose.connection.dropDatabase();
const { Task } = await import("../models/Task.js");
const { User } = await import("../models/User.js");
const { TaskService } = await import("../services/taskService.js");
const svc = new TaskService();

const lallu = new Types.ObjectId(), hr = new Types.ObjectId(), emp = new Types.ObjectId();
await User.collection.insertMany([{ _id: lallu, name: "Assignee", email: "a@e2e.test" }, { _id: hr, name: "HR", email: "hr@e2e.test" }]);
const make = async (o: Record<string, unknown> = {}) => (await Task.create({ batch: `b-${Math.random()}`, title: "Submit all your credentials", assignee: emp, assigneeUser: lallu, assignedBy: hr, dueAt: new Date(Date.now() + 86_400_000), needsApproval: true, ...o }))._id.toString();
const view = async (id: string) => (await svc.get(id, { userId: String(hr), canView: true })) as any;

// Round 1: three documents at once.
const id = await make();
await svc.submit(id, { note: "", files: [{ key: "k/email.pdf", name: "email.pdf" }, { key: "k/bank.pdf", name: "bank.pdf" }, { key: "k/broker.jpg", name: "broker.jpg" }] }, String(lallu));
let t = await view(id);
check("three documents handed in at once, each named, with a link", t.status === "submitted" && j(t.submission.files.map((f: any) => f.name)) === j(["email.pdf", "bank.pdf", "broker.jpg"]) && t.submission.files.every((f: any) => typeof f.url === "string" && f.url.includes("k/")), j(t.submission));
check("the older fields still carry the first, for screens from before", t.submission.fileName === "email.pdf");
check("history: the round lists its documents", j(t.history.at(-1)) .includes("bank.pdf"), j(t.history.at(-1)));
// Sent back; round 2 adds one more — nothing wiped.
await svc.review(id, "send_back", "Add the door password sheet", String(hr));
await svc.submit(id, { note: "added the door sheet", files: [{ key: "k/door.pdf", name: "door.pdf" }] }, String(lallu));
t = await view(id);
check("after a send-back, a second round adds to the documents (4), never wipes them", t.submission.files.length === 4 && t.submission.files.at(-1).name === "door.pdf", j(t.submission.files.map((f: any) => f.name)));
check("history: round two lists only its own document", j(t.history.at(-1).files) === j(["door.pdf"]), j(t.history.at(-1)));
// An empty submission: no documents — the panel says "Nothing attached".
const empty = await make();
await svc.submit(empty, { note: "", files: [] }, String(lallu));
t = await view(empty);
check("an empty submission: marked done with no documents", t.status === "submitted" && t.submission.at && t.submission.files.length === 0, j(t.submission));
// Proof required.
const proof = await make({ proofRequired: true });
let refused = "";
try { await svc.submit(proof, { note: "", files: [] }, String(lallu)); } catch (e) { refused = (e as Error).message; }
check("proof required and nothing attached: refused", /proof/i.test(refused), refused);
await svc.submit(proof, { note: "", files: [{ key: "k/p.png", name: "p.png" }] }, String(lallu));
await svc.review(proof, "send_back", "Again please", String(hr));
let second = "";
try { await svc.submit(proof, { note: "", files: [] }, String(lallu)); } catch (e) { second = (e as Error).message; }
check("proof required: a document from the round before counts", !second && (await view(proof)).submission.files.length === 1, second);
// A task from before: one file in fileKey only.
const legacy = await make({ status: "submitted", submission: { note: "", fileKey: "k/old.pdf", fileName: "old.pdf", at: new Date() } });
t = await view(legacy);
check("a task from before keeps its one file in the list", t.submission.files.length === 1 && t.submission.files[0].name === "old.pdf", j(t.submission));

console.log(`\n${checks - failures}/${checks} checks passed`);
await mongoose.disconnect();
process.exit(failures ? 1 : 0);
