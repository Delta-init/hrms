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
