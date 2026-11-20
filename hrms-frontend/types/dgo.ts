/**
 * DGO Points, Phase 1 — the shapes hrms-backend answers with (routes under /dgo-points).
 *
 * Every route is under the HRMS API base (`/api/v1`, i.e. the axios `api` instance's
 * baseURL) at `/dgo-points/...`, and answers in HRMS's usual wrapper:
 *   { success: boolean, message: string, data?: T }
 * Errors: { success:false, message } with 400/403/404/409. Show `message` to the user.
 *
 * Units: points are integers. Money is AED as a number with 2 decimals.
 * Days are "YYYY-MM-DD" and months "YYYY-MM", in the organisation's time zone (Dubai).
 */

export type DgoStage = "head" | "hr" | "finance";
export type DgoGroup = "revenue" | "other";
export type DgoEventStatus =
  | "pending" | "posted" | "rejected" | "capped" | "budget_blocked" | "superseded" | "reversed";
export type DgoLedgerType = "credit" | "reverse" | "expire" | "reserve" | "release" | "redeem" | "adjust";

/** GET /dgo-points/me — who you are to DGO Points. Drives the sidebar and page gates. */
export interface DgoMe {
  /** Switched on for every employee (Rules & Settings → General → "Open to employees"). */
  open: boolean;
  /** May use the employee pages now: open, or holds any DGO permission, or heads a department, or Super Admin. */
  canUse: boolean;
  superAdmin: boolean;
  isHead: boolean;
  can: {
    /** Record points for someone (department head for their team, or dgoApprovals.create, or Super Admin). */
    recordAwards: boolean;
    /** Has anything to do on the Approvals page (head, dgoApprovals.view/approve, dgoBudgets.approve, Super Admin). */
    approvals: boolean;
    budgetsView: boolean;
    budgetsEdit: boolean;
    budgetsApprove: boolean;
    settingsView: boolean;
    settingsEdit: boolean;
    auditView: boolean;
    /** May open somebody else's points (finance, audit, Super Admin). */
    walletLookup: boolean;
  };
  /** Your own employee record, or null for a login with none (then there are no own points). */
  employee: { id: string; name: string; department: string | null } | null;
  pointValueAed: number;
  timeZone: string;
  today: string;
}

export interface DgoBalances {
  available: number;
  /** Points in requests still waiting for approval. */
  pending: number;
  reserved: number;
  redeemed: number;
  expired: number;
  reversed: number;
  lifetimeEarned: number;
}

export interface DgoLedgerRow {
  id: string;
  at: string;              // ISO timestamp
  day: string;             // the earning's day for credits, else the day it happened
  type: DgoLedgerType;
  delta: number;           // +30, −20
  description: string;
  ruleCode: string | null;
  eventId: string | null;
  byName: string | null;
  expiresOn: string | null; // for credits: when that lot expires
}

/** GET /dgo-points/dashboard?month=YYYY-MM */
export interface DgoDashboard {
  month: string;
  pointValueAed: number;
  own: null | {
    balances: DgoBalances;
    availableAed: number;
    monthEarned: number;        // points credited in the month (net of reversals)
    today: { day: string; used: number; autoUsed: number; cap: number; autoCap: number };
    nextExpiry: { points: number; on: string } | null;
    rank: { position: number; of: number } | null; // by points earned this month, among people who earned any
    department: { name: string; group: DgoGroup; allocationAed: number; committedAed: number } | null;
    recent: DgoLedgerRow[];     // last 6
    pendingItems: Array<{ id: string; ruleCode: string; ruleName: string; points: number; day: string; stage: DgoStage | null }>;
  };
  /** Department heads: their people this month. */
  team: null | { members: Array<{ employeeId: string; name: string; department: string | null; monthPoints: number; available: number }> };
  /** dgoBudgets.view or Super Admin. */
  company: null | {
    pointsIssued: number; aedIssued: number;
    everydayAed: number; eliteAed: number; eliteUnlocked: boolean; committedAed: number;
    employeesEarning: number; activeEmployees: number; pendingApprovals: number;
    tierLabel: string; tierBasis: "confirmed" | "previous_month" | "lowest";
  };
}

/** GET /dgo-points/wallet?employeeId=&type=&from=&to=&page=&limit= (employeeId only with walletLookup) */
export interface DgoWalletView {
  employee: { id: string; name: string; department: string | null };
  balances: DgoBalances;
  pointValueAed: number;
  rows: DgoLedgerRow[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

/** GET /dgo-points/wallet/lots?employeeId= */
export interface DgoLot {
  id: string;
  issued: number;
  remaining: number;
  reserved: number;
  issuedOn: string;
  expiresOn: string;
  ruleCode: string | null;
  description: string;
}

export interface DgoRule {
  code: string;
  version: number;
  effectiveFrom: string;
  name: string;
  description: string;
  points: number;
  aed: number;
  kind: "performance" | "recognition";
  source: "kpi" | "award";
  kpiLevel: "met" | "exceeded" | null;
  needsEvidence: boolean;
  /** Who approves, in order. Empty = posted as soon as it is recorded (KPI points). */
  chain: DgoStage[];
  /** Outside the daily cap (innovation). Still inside the budget. */
  capExempt: boolean;
  active: boolean;
  createdByName: string | null;
  createdAt: string;
}

export interface DgoTier { minCollections: number; everydayAed: number; eliteAed: number }

export interface DgoSettings {
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
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** GET /dgo-points/rules — what anyone can earn today (active rules only). */
export interface DgoRulesView { settings: DgoSettings; rules: DgoRule[] }

/** GET /dgo-points/settings (dgoSettings.view) */
export interface DgoSettingsView {
  settings: DgoSettings;            // in force today
  upcoming: DgoSettings[];          // effective later
  history: DgoSettings[];           // every version, newest first
  rules: DgoRule[];                 // latest version of every code, active or not
  ruleHistory: DgoRule[];           // every rule version, newest first
  program: { openToEmployees: boolean; revenueDepartments: string[] };
  departments: Array<{ id: string; name: string; headcount: number; group: DgoGroup; head: string | null }>;
}
/** PUT /dgo-points/settings  body: Omit<DgoSettings,"version"|"createdByName"|"createdAt"> (effectiveFrom ≥ today) → DgoSettings */
/** PUT /dgo-points/rules/:code body: { name, description, points, needsEvidence, chain, capExempt, active, effectiveFrom } → DgoRule */
/** PUT /dgo-points/program body: { openToEmployees?: boolean; revenueDepartments?: string[] } → DgoSettingsView["program"] */

export interface DgoTrailEntry { stage: DgoStage | null; action: string; byName: string | null; note: string | null; at: string }

export interface DgoEvent {
  id: string;
  employee: { id: string; name: string; department: string | null };
  ruleCode: string;
  ruleName: string;
  points: number;
  aed: number;
  day: string;
  month: string;
  reason: string;
  evidenceNote: string | null;
  kpiKey: string | null;
  status: DgoEventStatus;
  stage: DgoStage | null;
  chain: DgoStage[];
  trail: DgoTrailEntry[];
  submittedByName: string | null;
  createdAt: string;
  /** The employee's department allowance this month, before and after this award. */
  budget: { departmentName: string; leftAed: number; afterAed: number } | null;
  /** Whether the viewer may approve/reject it now, and if not, why (shown as a hint). */
  canDecide: boolean;
  whyNot: string | null;
  canReverse: boolean;
}

/** GET /dgo-points/approvals?tab=mine|waiting|decided */
export interface DgoApprovalsView {
  tab: "mine" | "waiting" | "decided";
  counts: { mine: number; waiting: number; decided: number };
  items: DgoEvent[];
}
/** POST /dgo-points/approvals/:id/decision  body { approve: boolean; note?: string } → { event: DgoEvent } (note required to reject) */
/** POST /dgo-points/earnings  body { employeeId, ruleCode, day, reason, evidenceNote?, kpiKey?, requestId (uuid per form open) } → { event: DgoEvent; duplicate: boolean } */
/** POST /dgo-points/earnings/:id/reverse  body { reason } → { event: DgoEvent }   (dgoBudgets.edit / Super Admin) */
/** GET /dgo-points/employees?search= → Array<{ id: string; name: string; department: string | null; designation: string | null }>  (people the viewer may record points for, or look up) */

/** GET /dgo-points/budgets?month=YYYY-MM (dgoBudgets.view) */
export interface DgoBudgetView {
  month: string;
  status: "open" | "review" | "finance_approved" | "closed";
  pointValueAed: number;
  revenueSharePct: number;
  tiers: DgoTier[];
  tierIndex: number;
  tierLabel: string;                 // "AED 1.2m and over"
  tierBasis: "confirmed" | "previous_month" | "lowest";
  tierBasisMonth: string | null;     // the month whose confirmed collections set the tier
  everydayAed: number;
  eliteAed: number;
  eliteUnlocked: boolean;
  ceilingAed: number;                // everyday + elite
  committedAed: number;              // everyday pool used
  leftAed: number;
  collections: {
    enteredAed: number | null; enteredByName: string | null; enteredAt: string | null; note: string | null;
    confirmedAed: number | null; confirmedByName: string | null; confirmedAt: string | null;
    awaitingConfirmation: boolean;
  };
  groups: Array<{ group: DgoGroup; sharePct: number; shareAed: number; committedAed: number; headcount: number }>;
  departments: Array<{ id: string | null; name: string; group: DgoGroup; headcount: number; allocationAed: number; committedAed: number; leftAed: number }>;
  history: Array<{ action: string; amountAed: number | null; byName: string | null; at: string; note: string | null }>;
  can: { enter: boolean; confirm: boolean; recount: boolean };
}
/** POST /dgo-points/budgets/:month/collections body { amountAed, note? } → DgoBudgetView (dgoBudgets.edit) */
/** POST /dgo-points/budgets/:month/collections/confirm → DgoBudgetView (dgoBudgets.approve, not the person who entered it) */
/** POST /dgo-points/budgets/:month/recount → DgoBudgetView (dgoBudgets.edit) — re-reads headcount per department */

/** GET /dgo-points/audit?page=&limit=&action= (dgoAudit.view) → { rows: Array<{ id; at; actorName; action; entity; entityId; before; after }>, pagination } */

// ─── Request bodies ───────────────────────────────────────────────────────────

export interface DgoRecordInput {
  employeeId: string;
  ruleCode: string;
  day: string;
  reason: string;
  evidenceNote?: string;
  kpiKey?: string;
  requestId: string;
}

export interface DgoRecordResult { event: DgoEvent; duplicate: boolean }

export type DgoSettingsInput = Omit<DgoSettings, "version" | "createdByName" | "createdAt">;

export interface DgoRuleInput {
  name: string;
  description: string;
  points: number;
  needsEvidence: boolean;
  chain: DgoStage[];
  capExempt: boolean;
  active: boolean;
  effectiveFrom: string;
}

export interface DgoProgramInput { openToEmployees?: boolean; revenueDepartments?: string[] }

export interface DgoPerson { id: string; name: string; department: string | null; designation: string | null }

export interface DgoAuditRow {
  id: string;
  at: string;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export interface DgoAuditView {
  rows: DgoAuditRow[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}
