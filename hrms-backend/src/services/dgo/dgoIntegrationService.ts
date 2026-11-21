import type { Types } from "mongoose";
import { DgoSyncRun } from "../../models/DgoSyncRun.js";
import { DgoSuggestion } from "../../models/DgoSuggestion.js";
import { DgoEarningEvent } from "../../models/DgoEarningEvent.js";
import { Employee } from "../../models/Employee.js";
import { env } from "../../config/env.js";
import { httpError } from "./dgoErrors.js";
import { dgoAudit } from "./dgoAudit.js";
import { ruleOn } from "./dgoSettingsService.js";
import { recordEarning } from "./dgoEarningService.js";
import { rootConfigHint, rootConfigured } from "./dgoRootClient.js";
import { can, canRecordAwards, isObjectId, isOpen, oid, type DgoViewer } from "./dgoAccess.js";

/**
 * The Integrations page (every DGO feed: when it last ran, what it brought in,
 * who couldn't be paid, what failed) and the suggestions the feeds leave for a
 * head or HR to record.
 */

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

interface RunDoc {
  _id: Types.ObjectId; source: "kpi" | "achievers" | "collections"; key: string; trigger: "nightly" | "manual"; byName: string | null;
  startedAt: Date; finishedAt: Date | null; ok: boolean; counts: Record<string, number>;
  unmatched: Array<{ email: string; name: string; crm: string | null; achievedPct: number | null; why: string }>; errors: string[]; problems: string[];
}

const runDto = (r: RunDoc) => ({
  id: String(r._id), source: r.source, key: r.key, trigger: r.trigger, byName: r.byName ?? null,
  startedAt: iso(r.startedAt)!, finishedAt: iso(r.finishedAt), ok: r.ok, counts: r.counts ?? {},
  unmatched: r.unmatched ?? [], errors: r.errors ?? [], problems: r.problems ?? [],
});

/** Record a run of a feed that is started from its own page (achievers, collections). Best-effort. */
export async function logRun(v: DgoViewer, source: "achievers" | "collections", key: string, outcome: { ok: boolean; counts?: Record<string, number>; errors?: string[]; problems?: string[] }) {
  await DgoSyncRun.create({
    organization: v.orgId, source, key, trigger: "manual", by: v.userId, byName: v.name, startedAt: new Date(), finishedAt: new Date(),
    ok: outcome.ok, counts: outcome.counts ?? {}, errors: outcome.errors ?? [], problems: outcome.problems ?? [],
  }).catch(() => undefined);
}

const financeConfigured = () => Boolean(env.FINANCE_API_URL && env.FINANCE_CLIENT_ID && env.FINANCE_INTEGRATION_SECRET);

/** GET /dgo-points/integrations */
export async function integrationsView(v: DgoViewer) {
  if (!can(v, "dgoSettings", "view") && !can(v, "dgoBudgets", "view")) throw httpError("You can't see DGO integrations", 403);
  const week = new Date(Date.now() - 7 * 86_400_000);
  const sources = [
    { key: "kpi" as const, name: "Sales KPI points (Root daily tracker)", schedule: "Every night at 23:45 Dubai, for today and yesterday", configured: rootConfigured(), configHint: rootConfigHint(), where: null },
    { key: "achievers" as const, name: "Monthly achievers (Root)", schedule: "When someone fetches a month's figures", configured: rootConfigured(), configHint: rootConfigHint(), where: "/dgo-points/achievers" },
    {
      key: "collections" as const, name: "Collections (finance)", schedule: "When finance clicks Get from finance", configured: financeConfigured(),
      configHint: financeConfigured() ? null : "Set FINANCE_API_URL, FINANCE_CLIENT_ID and FINANCE_INTEGRATION_SECRET in the HRMS backend .env", where: "/dgo-points/budgets",
    },
  ];
  const out = [];
  for (const s of sources) {
    const [last, lastOk, failures] = await Promise.all([
      DgoSyncRun.findOne({ organization: v.orgId, source: s.key }).sort({ startedAt: -1 }).lean<RunDoc>(),
      DgoSyncRun.findOne({ organization: v.orgId, source: s.key, ok: true }).sort({ startedAt: -1 }).select("startedAt").lean<{ startedAt: Date }>(),
      DgoSyncRun.countDocuments({ organization: v.orgId, source: s.key, ok: false, startedAt: { $gte: week } }),
    ]);
    out.push({ ...s, lastRun: last ? runDto(last) : null, lastOkAt: iso(lastOk?.startedAt), failuresLast7Days: failures });
  }
  const runs = await DgoSyncRun.find({ organization: v.orgId }).sort({ startedAt: -1 }).limit(30).lean<RunDoc[]>();
  return { sources: out, runs: runs.map(runDto), can: { runKpi: can(v, "dgoSettings", "edit") } };
}

/* ───────────── Suggestions ───────────── */

interface SuggestionDoc {
  _id: Types.ObjectId; organization: unknown; source: "lms_review"; sourceId: string; employee: Types.ObjectId; employeeName: string;
  department: unknown; departmentName: string | null; ruleCode: string; day: string; title: string; detail: string;
  status: "open" | "recorded" | "dismissed"; event: unknown; decidedByName: string | null;
}

async function mayRecordFor(v: DgoViewer, s: { department: unknown }, open: boolean) {
  if (can(v, "dgoApprovals", "create")) return true;
  return open && s.department != null && v.headOf.includes(String(s.department));
}

async function suggestionDto(v: DgoViewer, s: SuggestionDoc, open: boolean) {
  const rule = await ruleOn(String(s.organization), s.ruleCode, s.day);
  const self = v.employee && v.employee._id === String(s.employee);
  return {
    id: String(s._id), source: s.source,
    employee: { id: String(s.employee), name: s.employeeName, department: s.departmentName ?? null },
    ruleCode: s.ruleCode, ruleName: rule?.name ?? s.ruleCode, points: rule?.points ?? 0, day: s.day,
    title: s.title, detail: s.detail, status: s.status, eventId: s.event ? String(s.event) : null, decidedByName: s.decidedByName ?? null,
    canRecord: s.status === "open" && !self && (await mayRecordFor(v, s, open)),
  };
}

/** GET /dgo-points/suggestions?status=open|done — what the viewer may record: HR everything, a head their departments. */
export async function suggestionsView(v: DgoViewer, statusIn?: string) {
  const open = await isOpen(v.orgId);
  if (!canRecordAwards(v, open)) throw httpError("You can't record awards", 403);
  const scope: Record<string, unknown> = { organization: v.orgId };
  if (!can(v, "dgoApprovals", "create")) scope.department = { $in: v.headOf.map(oid) };
  if (v.employee) scope.employee = { $ne: oid(v.employee._id) };
  const done = statusIn === "done";
  const [rows, openCount, doneCount] = await Promise.all([
    DgoSuggestion.find({ ...scope, status: done ? { $in: ["recorded", "dismissed"] } : "open" }).sort({ day: done ? -1 : 1, createdAt: 1 }).limit(200).lean<SuggestionDoc[]>(),
    DgoSuggestion.countDocuments({ ...scope, status: "open" }),
    DgoSuggestion.countDocuments({ ...scope, status: { $in: ["recorded", "dismissed"] } }),
  ]);
  return { items: await Promise.all(rows.map((s) => suggestionDto(v, s, open))), counts: { open: openCount, done: doneCount } };
}

async function loadSuggestion(v: DgoViewer, id: string) {
  if (!isObjectId(id)) throw httpError("Unknown suggestion", 400);
  const s = await DgoSuggestion.findOne({ _id: id, organization: v.orgId }).lean<SuggestionDoc>();
  if (!s) throw httpError("That suggestion no longer exists", 404);
  return s;
}

/** POST /dgo-points/suggestions/:id/record — records the award through the usual chain; once. */
export async function recordSuggestion(v: DgoViewer, id: string) {
  const s = await loadSuggestion(v, id);
  const open = await isOpen(v.orgId);
  if (s.status === "recorded") {
    const ev = s.event ? await DgoEarningEvent.findById(s.event).lean() : null;
    return { suggestion: await suggestionDto(v, s, open), event: ev, message: "Already recorded" };
  }
  if (s.status === "dismissed") throw httpError("It was dismissed", 409);
  if (!(await mayRecordFor(v, s, open))) throw httpError("Only HR or the head of their department can record this", 403);
  const emp = await Employee.findById(s.employee).select("_id").lean();
  if (!emp) throw httpError("That person isn't in HRMS any more", 404);
  // The suggestion's id is the request id: a second click finds the first recording.
  const out = await recordEarning(v, {
    employeeId: String(s.employee), ruleCode: s.ruleCode, day: s.day,
    reason: s.title, evidenceNote: `Verified LMS review: "${s.detail}"`.slice(0, 2000), requestId: `suggestion-${s._id}`,
  });
  await DgoSuggestion.updateOne(
    { _id: s._id, status: "open" },
    { $set: { status: "recorded", event: out.event._id, decidedBy: v.userId, decidedByName: v.name, decidedAt: new Date() } }
  );
  await dgoAudit(v, "suggestion_recorded", "suggestion", s._id, { status: "open" }, { status: "recorded", event: String(out.event._id) });
  const after = (await DgoSuggestion.findById(s._id).lean<SuggestionDoc>())!;
  return { suggestion: await suggestionDto(v, after, open), event: out.event, message: out.message };
}

/** POST /dgo-points/suggestions/:id/dismiss */
export async function dismissSuggestion(v: DgoViewer, id: string, reason?: string | null) {
  const s = await loadSuggestion(v, id);
  const open = await isOpen(v.orgId);
  if (s.status === "dismissed") return { suggestion: await suggestionDto(v, s, open), message: "Already done" };
  if (s.status === "recorded") throw httpError("It has already been recorded", 409);
  if (!(await mayRecordFor(v, s, open))) throw httpError("Only HR or the head of their department can dismiss this", 403);
  await DgoSuggestion.updateOne({ _id: s._id, status: "open" }, { $set: { status: "dismissed", decidedBy: v.userId, decidedByName: v.name, decidedAt: new Date(), note: reason?.trim() || null } });
  await dgoAudit(v, "suggestion_dismissed", "suggestion", s._id, { status: "open" }, { status: "dismissed", reason: reason?.trim() || null });
  return { suggestion: await suggestionDto(v, (await DgoSuggestion.findById(s._id).lean<SuggestionDoc>())!, open), message: "Dismissed" };
}
