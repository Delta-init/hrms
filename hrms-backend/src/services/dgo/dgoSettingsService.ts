import { DgoProgram } from "../../models/DgoProgram.js";
import { DgoSettingsVersion } from "../../models/DgoSettingsVersion.js";
import { DgoEarningRule } from "../../models/DgoEarningRule.js";
import { Department } from "../../models/Department.js";
import { Employee } from "../../models/Employee.js";
import { DEFAULT_RULES, DEFAULT_SETTINGS, ACTIVE_EMPLOYEE_STATUSES, type DgoStage } from "./dgoDefaults.js";
import { dayIn, previousMonth, pointsToFils, toAed, type DgoTier } from "./dgoMath.js";
import { httpError, isDuplicateKey } from "./dgoErrors.js";
import { dgoAudit } from "./dgoAudit.js";
import type { DgoViewer } from "./dgoAccess.js";
import { can, oid } from "./dgoAccess.js";

/**
 * DGO Points settings and earning rules, both versioned: a change is a new
 * version that takes effect on a day no earlier than today, so nothing already
 * counted moves. The program switch and the revenue-department grouping are
 * operational and change in place (a month copies the grouping when it opens).
 */

export interface SettingsDoc {
  _id: unknown;
  version: number;
  effectiveFrom: string;
  pointValueAed: number;
  dailyCap: number;
  autoKpiCap: number;
  kpiExceededPct: number;
  expiryMonths: number;
  minRedemption: number;
  revenueSharePct: number;
  tiers: DgoTier[];
  note?: string | null;
  createdByName?: string | null;
  createdAt?: Date;
}

export interface RuleDoc {
  _id: unknown;
  code: string;
  version: number;
  effectiveFrom: string;
  name: string;
  description: string;
  points: number;
  kind: "performance" | "recognition";
  source: "kpi" | "award";
  kpiLevel: "met" | "exceeded" | null;
  needsEvidence: boolean;
  chain: DgoStage[];
  capExempt: boolean;
  active: boolean;
  createdByName?: string | null;
  createdAt?: Date;
}

const ready = new Set<string>();

/**
 * Settings v1, the seven rules v1 and the program row for an organisation, the
 * first time anybody there opens DGO Points. Safe to race: every insert is
 * guarded by a unique index and a duplicate means somebody else got there first.
 * Effective from the start of last month, so the two months that can be
 * recorded into both have rules.
 */
export async function ensureDgoSetup(orgId: string, today: string): Promise<void> {
  if (ready.has(orgId)) return;
  const from = `${previousMonth(today.slice(0, 7))}-01`;
  const ignoreDup = (e: unknown) => { if (!isDuplicateKey(e)) throw e; };
  await DgoProgram.updateOne(
    { organization: orgId },
    { $setOnInsert: { organization: orgId, openToEmployees: false, revenueDepartments: [] } },
    { upsert: true }
  ).catch(ignoreDup);
  if (!(await DgoSettingsVersion.exists({ organization: orgId }))) {
    await DgoSettingsVersion.create({ organization: orgId, version: 1, effectiveFrom: from, ...DEFAULT_SETTINGS, note: "Starting values from the developer handoff v1.0" }).catch(ignoreDup);
  }
  if (!(await DgoEarningRule.exists({ organization: orgId }))) {
    await DgoEarningRule.insertMany(
      DEFAULT_RULES.map((r) => ({ organization: orgId, version: 1, effectiveFrom: from, active: true, ...r })),
      { ordered: false }
    ).catch(ignoreDup);
  }
  ready.add(orgId);
}

/** Forget the setup cache — the check script drops its database between runs. */
export const resetDgoSetupCache = () => ready.clear();

/** The settings in force on a day. */
export async function settingsOn(orgId: string, day: string): Promise<SettingsDoc> {
  const s = await DgoSettingsVersion.findOne({ organization: orgId, effectiveFrom: { $lte: day } })
    .sort({ effectiveFrom: -1, version: -1 })
    .lean<SettingsDoc>();
  if (!s) throw httpError(`DGO Points has no settings in force on ${day}`, 400);
  return s;
}

/** The version of every rule in force on a day, switched-off ones included. */
export async function rulesOn(orgId: string, day: string): Promise<RuleDoc[]> {
  const all = await DgoEarningRule.find({ organization: orgId, effectiveFrom: { $lte: day } })
    .sort({ code: 1, effectiveFrom: -1, version: -1 })
    .lean<RuleDoc[]>();
  const seen = new Set<string>();
  return all.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)));
}

/** One rule in force on a day, or null when it does not exist or is switched off then. */
export async function ruleOn(orgId: string, code: string, day: string): Promise<RuleDoc | null> {
  const r = await DgoEarningRule.findOne({ organization: orgId, code: code.toUpperCase(), effectiveFrom: { $lte: day } })
    .sort({ effectiveFrom: -1, version: -1 })
    .lean<RuleDoc>();
  return r && r.active ? r : null;
}

export const settingsDto = (s: SettingsDoc) => ({
  version: s.version,
  effectiveFrom: s.effectiveFrom,
  pointValueAed: s.pointValueAed,
  dailyCap: s.dailyCap,
  autoKpiCap: s.autoKpiCap,
  kpiExceededPct: s.kpiExceededPct,
  expiryMonths: s.expiryMonths,
  minRedemption: s.minRedemption,
  revenueSharePct: s.revenueSharePct,
  tiers: [...s.tiers].sort((a, b) => a.minCollections - b.minCollections).map((t) => ({ minCollections: t.minCollections, everydayAed: t.everydayAed, eliteAed: t.eliteAed })),
  note: s.note ?? null,
  createdByName: s.createdByName ?? null,
  createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : "",
});

export const ruleDto = (r: RuleDoc, pointValueAed: number) => ({
  code: r.code,
  version: r.version,
  effectiveFrom: r.effectiveFrom,
  name: r.name,
  description: r.description,
  points: r.points,
  aed: toAed(pointsToFils(r.points, pointValueAed)),
  kind: r.kind,
  source: r.source,
  kpiLevel: r.kpiLevel ?? null,
  needsEvidence: r.needsEvidence,
  chain: r.chain,
  capExempt: r.capExempt,
  active: r.active,
  createdByName: r.createdByName ?? null,
  createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
});

/** GET /dgo-points/rules — what can be earned today. */
export async function rulesView(v: DgoViewer) {
  const today = dayIn(v.tz);
  const settings = await settingsOn(v.orgId, today);
  const rules = (await rulesOn(v.orgId, today)).filter((r) => r.active);
  return { settings: settingsDto(settings), rules: rules.map((r) => ruleDto(r, settings.pointValueAed)) };
}

/** GET /dgo-points/settings — everything an admin edits. */
export async function settingsView(v: DgoViewer) {
  const today = dayIn(v.tz);
  const [current, versions, ruleVersions, program, departments, counts] = await Promise.all([
    settingsOn(v.orgId, today),
    DgoSettingsVersion.find({ organization: v.orgId }).sort({ version: -1 }).lean<SettingsDoc[]>(),
    DgoEarningRule.find({ organization: v.orgId }).sort({ createdAt: -1, version: -1 }).lean<RuleDoc[]>(),
    DgoProgram.findOne({ organization: v.orgId }).lean<{ openToEmployees: boolean; revenueDepartments: unknown[] }>(),
    Department.find({ organization: v.orgId }).select("name leader leaderKind").sort({ name: 1 }).lean<Array<{ _id: unknown; name: string; leader?: unknown; leaderKind?: string }>>(),
    Employee.aggregate<{ _id: unknown; n: number }>([
      { $match: { organization: oid(v.orgId), status: { $in: ACTIVE_EMPLOYEE_STATUSES } } },
      { $group: { _id: "$department", n: { $sum: 1 } } },
    ]),
  ]);
  const revenue = new Set((program?.revenueDepartments ?? []).map(String));
  const headcount = new Map(counts.map((c) => [String(c._id), c.n]));
  const leaderIds = departments.filter((d) => d.leader).map((d) => d.leader);
  const leaders = leaderIds.length
    ? await Employee.find({ _id: { $in: leaderIds } }).select("name").lean<Array<{ _id: unknown; name: string }>>()
    : [];
  const leaderName = new Map(leaders.map((l) => [String(l._id), l.name]));
  // The latest version of every code, as of any date — a rule switched on from next week is shown as it will be.
  const latest = new Map<string, RuleDoc>();
  for (const r of [...ruleVersions].sort((a, b) => b.version - a.version)) if (!latest.has(r.code)) latest.set(r.code, r);
  return {
    settings: settingsDto(current),
    upcoming: versions.filter((s) => s.effectiveFrom > today).map(settingsDto),
    history: versions.map(settingsDto),
    rules: [...latest.values()].sort((a, b) => DEFAULT_ORDER(a.code) - DEFAULT_ORDER(b.code) || a.code.localeCompare(b.code)).map((r) => ruleDto(r, current.pointValueAed)),
    ruleHistory: ruleVersions.map((r) => ruleDto(r, current.pointValueAed)),
    program: { openToEmployees: Boolean(program?.openToEmployees), revenueDepartments: [...revenue] },
    departments: departments.map((d) => ({
      id: String(d._id),
      name: d.name,
      headcount: headcount.get(String(d._id)) ?? 0,
      group: revenue.has(String(d._id)) ? ("revenue" as const) : ("other" as const),
      head: d.leader ? leaderName.get(String(d.leader)) ?? "Set" : null,
    })),
  };
}

const DEFAULT_ORDER = (code: string) => {
  const i = DEFAULT_RULES.findIndex((r) => r.code === code);
  return i < 0 ? 99 : i;
};

export interface SettingsInput {
  pointValueAed: number;
  dailyCap: number;
  autoKpiCap: number;
  kpiExceededPct: number;
  expiryMonths: number;
  minRedemption: number;
  revenueSharePct: number;
  tiers: DgoTier[];
  effectiveFrom: string;
  note?: string | null;
}

/** A new settings version from a day no earlier than today. */
export async function saveSettings(v: DgoViewer, input: SettingsInput) {
  if (!can(v, "dgoSettings", "edit")) throw httpError("You can't change DGO Points settings", 403);
  const today = dayIn(v.tz);
  if (input.effectiveFrom < today) throw httpError("A change can start today or later, never earlier", 400);
  const tiers = [...input.tiers].sort((a, b) => a.minCollections - b.minCollections);
  if (!tiers.length || tiers[0].minCollections !== 0) throw httpError("The first revenue tier must start at AED 0", 400);
  if (new Set(tiers.map((t) => t.minCollections)).size !== tiers.length) throw httpError("Two tiers start at the same amount", 400);
  if (input.autoKpiCap > input.dailyCap) throw httpError("The KPI cap can't be above the daily cap", 400);
  const before = await settingsOn(v.orgId, today);
  const last = await DgoSettingsVersion.findOne({ organization: v.orgId }).sort({ version: -1 }).select("version").lean<{ version: number }>();
  const created = await DgoSettingsVersion.create({
    organization: v.orgId,
    version: (last?.version ?? 0) + 1,
    effectiveFrom: input.effectiveFrom,
    pointValueAed: input.pointValueAed,
    dailyCap: input.dailyCap,
    autoKpiCap: input.autoKpiCap,
    kpiExceededPct: input.kpiExceededPct,
    expiryMonths: input.expiryMonths,
    minRedemption: input.minRedemption,
    revenueSharePct: input.revenueSharePct,
    tiers,
    note: input.note?.trim() || null,
    createdBy: v.userId,
    createdByName: v.name,
  });
  const after = created.toObject() as unknown as SettingsDoc;
  await dgoAudit(v, "settings_version_created", "settings", created._id, settingsDto(before), settingsDto(after));
  return settingsDto(after);
}

export interface RuleInput {
  name: string;
  description: string;
  points: number;
  needsEvidence: boolean;
  chain: DgoStage[];
  capExempt: boolean;
  active: boolean;
  effectiveFrom: string;
}

const STAGE_ORDER: DgoStage[] = ["head", "hr", "finance"];

/** A new version of a rule — or a new rule, for a code not seen before — from a day no earlier than today. */
export async function saveRule(v: DgoViewer, code: string, input: RuleInput) {
  if (!can(v, "dgoSettings", "edit")) throw httpError("You can't change earning rules", 403);
  const today = dayIn(v.tz);
  if (input.effectiveFrom < today) throw httpError("A change can start today or later, never earlier", 400);
  const upper = code.toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(upper)) throw httpError("A rule code is capitals, digits and _ (e.g. CLIENT_REFERRAL)", 400);
  // Approvers always run head → HR → finance; the order is not the editor's to scramble.
  const chain = STAGE_ORDER.filter((s) => input.chain.includes(s));
  const previous = await DgoEarningRule.findOne({ organization: v.orgId, code: upper }).sort({ version: -1 }).lean<RuleDoc>();
  const settings = await settingsOn(v.orgId, today);
  const created = await DgoEarningRule.create({
    organization: v.orgId,
    code: upper,
    version: (previous?.version ?? 0) + 1,
    effectiveFrom: input.effectiveFrom,
    name: input.name.trim(),
    description: input.description.trim(),
    points: input.points,
    // What kind of rule it is never changes between versions: a KPI rule stays one.
    kind: previous?.kind ?? "recognition",
    source: previous?.source ?? "award",
    kpiLevel: previous?.kpiLevel ?? null,
    needsEvidence: input.needsEvidence,
    chain,
    capExempt: input.capExempt,
    active: input.active,
    createdBy: v.userId,
    createdByName: v.name,
  });
  const after = created.toObject() as unknown as RuleDoc;
  await dgoAudit(v, previous ? "rule_version_created" : "rule_created", "earning_rule", upper,
    previous ? ruleDto(previous, settings.pointValueAed) : null, ruleDto(after, settings.pointValueAed));
  return ruleDto(after, settings.pointValueAed);
}

/** Open or close DGO Points to every employee, and say which departments are revenue departments. */
export async function saveProgram(v: DgoViewer, input: { openToEmployees?: boolean; revenueDepartments?: string[] }) {
  if (!can(v, "dgoSettings", "edit")) throw httpError("You can't change DGO Points settings", 403);
  const before = await DgoProgram.findOne({ organization: v.orgId }).lean();
  const set: Record<string, unknown> = { updatedBy: v.userId };
  if (typeof input.openToEmployees === "boolean") set.openToEmployees = input.openToEmployees;
  if (input.revenueDepartments) {
    const found = await Department.find({ organization: v.orgId, _id: { $in: input.revenueDepartments } }).select("_id").lean();
    if (found.length !== new Set(input.revenueDepartments).size) throw httpError("One of those departments isn't in this organisation", 400);
    set.revenueDepartments = found.map((d) => d._id);
  }
  const after = await DgoProgram.findOneAndUpdate({ organization: v.orgId }, { $set: set }, { new: true, upsert: true }).lean<{ openToEmployees: boolean; revenueDepartments: unknown[] }>();
  await dgoAudit(v, "program_changed", "program", v.orgId, before, after);
  return { openToEmployees: Boolean(after?.openToEmployees), revenueDepartments: (after?.revenueDepartments ?? []).map(String) };
}
