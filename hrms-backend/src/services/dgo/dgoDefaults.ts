import type { DgoTier } from "./dgoMath.js";

/**
 * The starting values from the DGO Points developer handoff (v1.0). They seed an
 * organisation's settings v1 and rules v1 the first time DGO Points is opened
 * there, and are edited on Rules & Settings from then on — nothing reads these
 * after the seed.
 */
export const DEFAULT_SETTINGS = {
  pointValueAed: 0.05,
  dailyCap: 50,
  autoKpiCap: 30,
  kpiExceededPct: 120,
  expiryMonths: 12,
  minRedemption: 1000,
  revenueSharePct: 55,
  tiers: [
    { minCollections: 0, everydayAed: 1500, eliteAed: 0 },
    { minCollections: 800_000, everydayAed: 2500, eliteAed: 0 },
    { minCollections: 1_000_000, everydayAed: 4000, eliteAed: 0 },
    { minCollections: 1_200_000, everydayAed: 4750, eliteAed: 13250 },
  ] as DgoTier[],
};

export type DgoStage = "head" | "hr" | "finance";

export interface DefaultRule {
  code: string;
  name: string;
  description: string;
  points: number;
  kind: "performance" | "recognition";
  source: "kpi" | "award";
  kpiLevel: "met" | "exceeded" | null;
  needsEvidence: boolean;
  chain: DgoStage[];
  capExempt: boolean;
}

export const DEFAULT_RULES: DefaultRule[] = [
  { code: "KPI_MET", name: "KPI met", description: "Reach your approved daily KPI.", points: 20, kind: "performance", source: "kpi", kpiLevel: "met", needsEvidence: false, chain: [], capExempt: false },
  { code: "KPI_EXCEEDED", name: "KPI exceeded", description: "At least 120% of your approved daily KPI. Replaces the 20, never adds to it.", points: 30, kind: "performance", source: "kpi", kpiLevel: "exceeded", needsEvidence: false, chain: [], capExempt: false },
  { code: "STUDENT_FEEDBACK", name: "Student feedback", description: "Verified exceptional feedback from a student.", points: 20, kind: "recognition", source: "award", kpiLevel: null, needsEvidence: true, chain: ["head", "hr"], capExempt: false },
  { code: "TEAM_SUPPORT", name: "Team support", description: "Approved help given to another team.", points: 15, kind: "recognition", source: "award", kpiLevel: null, needsEvidence: false, chain: ["head", "hr"], capExempt: false },
  { code: "ISSUE_RESOLVED", name: "Issue resolved", description: "A significant, documented resolution.", points: 30, kind: "recognition", source: "award", kpiLevel: null, needsEvidence: true, chain: ["head", "hr"], capExempt: false },
  { code: "PROCESS_IMPROVEMENT", name: "Process improvement", description: "An improvement your manager approves.", points: 20, kind: "recognition", source: "award", kpiLevel: null, needsEvidence: false, chain: ["head", "hr"], capExempt: false },
  { code: "INNOVATION", name: "Innovation", description: "An implemented innovation. Outside the daily cap, inside the budget.", points: 100, kind: "recognition", source: "award", kpiLevel: null, needsEvidence: true, chain: ["head", "hr", "finance"], capExempt: true },
];

/** Employee statuses that still count: on the payroll, in a department's headcount, able to earn. */
export const ACTIVE_EMPLOYEE_STATUSES = ["active", "probation", "on_leave", "notice_period"];

/* ───────────── Phase 2 ───────────── */

export type DgoLeaderboardVisibility = "everyone" | "department" | "managers";
export const LEADERBOARD_VISIBILITIES: DgoLeaderboardVisibility[] = ["everyone", "department", "managers"];
export const DEFAULT_NOMINATIONS_PER_MONTH = 4;

export type DgoEliteMetric = "sales" | "team" | "cs" | "cs_department" | "mentor_chief" | "mentor_senior" | "mentor_junior";
export const MENTOR_METRICS: DgoEliteMetric[] = ["mentor_chief", "mentor_senior", "mentor_junior"];

export interface DgoEliteCategory {
  code: string;
  name: string;
  metric: DgoEliteMetric;
  place: number;
  /** AED for money metrics; a score out of 100 for mentor metrics. */
  threshold: number;
  prizeAed: number;
  active: boolean;
}

/**
 * The handoff's elite categories (AED 13,250 in all). Mentor categories start
 * switched off: their criteria are still for management to set, and Root's
 * mentor KPIs score only part of the plan today.
 */
export const DEFAULT_ELITE_CATEGORIES: DgoEliteCategory[] = [
  { code: "SALES_1", name: "Sales — first", metric: "sales", place: 1, threshold: 50_000, prizeAed: 2000, active: true },
  { code: "SALES_2", name: "Sales — second", metric: "sales", place: 2, threshold: 50_000, prizeAed: 1000, active: true },
  { code: "TEAM_LEADER", name: "Best sales team leader", metric: "team", place: 1, threshold: 100_000, prizeAed: 3000, active: true },
  { code: "CSE_1", name: "Customer success — first", metric: "cs", place: 1, threshold: 100_000, prizeAed: 2000, active: true },
  { code: "CSE_2", name: "Customer success — second", metric: "cs", place: 2, threshold: 100_000, prizeAed: 1000, active: true },
  { code: "CSE_MANAGER", name: "Customer success manager", metric: "cs_department", place: 1, threshold: 350_000, prizeAed: 1500, active: true },
  { code: "MENTOR_CHIEF", name: "Chief mentor", metric: "mentor_chief", place: 1, threshold: 80, prizeAed: 1500, active: false },
  { code: "MENTOR_SENIOR", name: "Senior mentor", metric: "mentor_senior", place: 1, threshold: 80, prizeAed: 750, active: false },
  { code: "MENTOR_JUNIOR", name: "Junior mentor", metric: "mentor_junior", place: 1, threshold: 80, prizeAed: 500, active: false },
];
export const ELITE_CODES = DEFAULT_ELITE_CATEGORIES.map((c) => c.code);
/** Ledger and earning rule codes of achiever prizes start with this; earning rules may not. */
export const ELITE_RULE_PREFIX = "ELITE_";

/** Award rules a colleague may nominate for: every active award rule (KPI points are never nominated). */
export const NOMINATION_SOURCE = "award" as const;
