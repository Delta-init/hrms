import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const stage = z.enum(["head", "hr", "finance"]);

export const recordEarningSchema = z.object({
  employeeId: objectId,
  ruleCode: z.string().trim().min(2).max(40),
  day,
  reason: z.string().trim().min(1, "Say what it was for").max(1000),
  evidenceNote: z.string().trim().max(2000).nullish(),
  kpiKey: z.string().trim().max(40).regex(/^[\w -]*$/, "Letters, digits, spaces and - only").nullish(),
  // One per form opened, so a double submit or a retry records once.
  requestId: z.string().trim().min(8).max(80),
});

export const decisionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(1000).nullish(),
});

export const reverseSchema = z.object({
  reason: z.string().trim().min(1, "Say why the points are taken back").max(500),
});

export const collectionsSchema = z.object({
  amountAed: z.number().finite().min(0).max(1_000_000_000),
  note: z.string().trim().max(300).nullish(),
});

const tier = z.object({
  minCollections: z.number().finite().min(0),
  everydayAed: z.number().finite().min(0).max(10_000_000),
  eliteAed: z.number().finite().min(0).max(10_000_000),
});

export const settingsSchema = z.object({
  pointValueAed: z.number().finite().min(0.0001).max(100),
  dailyCap: z.number().int().min(0).max(100_000),
  autoKpiCap: z.number().int().min(0).max(100_000),
  kpiExceededPct: z.number().int().min(100).max(1000),
  expiryMonths: z.number().int().min(1).max(120),
  minRedemption: z.number().int().min(0).max(10_000_000),
  revenueSharePct: z.number().min(0).max(100),
  tiers: z.array(tier).min(1).max(12),
  effectiveFrom: day,
  note: z.string().trim().max(300).nullish(),
});

export const ruleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(""),
  points: z.number().int().min(1).max(100_000),
  needsEvidence: z.boolean(),
  chain: z.array(stage).max(3),
  capExempt: z.boolean(),
  active: z.boolean(),
  effectiveFrom: day,
});

export const programSchema = z.object({
  openToEmployees: z.boolean().optional(),
  revenueDepartments: z.array(objectId).max(200).optional(),
});

/* ───────────── Phase 2 ───────────── */

const requestId = z.string().trim().min(8).max(80);

export const nominateSchema = z.object({
  employeeId: objectId,
  ruleCode: z.string().trim().min(2).max(40),
  day,
  reason: z.string().trim().min(1, "Say what it was for").max(1000),
  evidenceNote: z.string().trim().max(2000).nullish(),
  evidenceKey: z.string().trim().max(300).nullish(),
  evidenceName: z.string().trim().max(200).nullish(),
  requestId,
});

export const rewardSchema = z.object({
  name: z.string().trim().min(2, "Give it a name").max(80),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().min(2, "Give it a category").max(40),
  photoKey: z.string().trim().max(300).nullish(),
  points: z.number().int().min(1).max(10_000_000),
  costAed: z.number().finite().min(0).max(10_000_000).nullish(),
  stockMode: z.enum(["unlimited", "limited"]),
  stock: z.number().int().min(0).max(1_000_000).nullish(),
  status: z.enum(["active", "hidden"]),
});

export const redeemSchema = z.object({
  rewardId: objectId,
  note: z.string().trim().max(500).nullish(),
  requestId,
});

export const noteSchema = z.object({ note: z.string().trim().max(500).nullish() });
export const reasonSchema = z.object({ reason: z.string().trim().min(1, "Say why").max(500) });

export const pickSchema = z.object({ code: z.string().trim().min(2).max(40), email: z.string().trim().min(3).max(200) });

const eliteCategory = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(80).optional(),
  threshold: z.number().finite().min(0).max(1_000_000_000),
  prizeAed: z.number().finite().min(0).max(10_000_000),
  active: z.boolean(),
});

export const programSchemaP2 = programSchema.extend({
  leaderboardVisibility: z.enum(["everyone", "department", "managers"]).optional(),
  nominationsPerMonth: z.number().int().min(0).max(100).optional(),
  eliteCategories: z.array(eliteCategory).max(20).optional(),
});
