/**
 * DGO Points, Phases 1–3 — the shapes hrms-backend answers with (routes under /dgo-points).
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
    // Phase 2 — optional so a server from before Phase 2 still type-checks as "no".
    /** Manage the rewards catalogue (dgoRewards create/edit/delete, or Super Admin). */
    rewardsManage?: boolean;
    /** Approve / reject / mark delivered redemptions (dgoRewards approve, or Super Admin). */
    rewardsFulfil?: boolean;
    /** See the fulfilment queue (dgoRewards view/approve, or Super Admin). */
    rewardsView?: boolean;
    /** Fetch achiever figures from Root and pick between exact ties (dgoSettings edit, or Super Admin). */
    achieversRun?: boolean;
    /** Verify achiever figures (finance: dgoBudgets approve, or Super Admin). */
    achieversVerify?: boolean;
    /** Approve and publish achievers (dgoSettings approve, or Super Admin). */
    achieversApprove?: boolean;
    /** See achiever candidates before they are published. */
    achieversReview?: boolean;
    /** May nominate a colleague now (has an employee record and may use DGO Points). */
    nominate?: boolean;
    // Phase 3 — optional so an older server type-checks as "no".
    /** Reports and reconciliation (dgoBudgets view or dgoAudit view, or Super Admin). */
    reportsView?: boolean;
    /** CSV exports (dgoBudgets export or dgoAudit export). */
    reportsExport?: boolean;
    /** Propose a points adjustment (dgoBudgets edit). */
    adjustmentsPropose?: boolean;
    /** Approve or reject someone else's adjustment (dgoBudgets approve). */
    adjustmentsApprove?: boolean;
  };
  /** Who may see the points leaderboard (Phase 2). */
  leaderboardVisibility?: DgoLeaderboardVisibility;
  /** Nominations each person may send a month (Phase 2). */
  nominationsPerMonth?: number;
  /** Who it's open to once switched on (Phase 4). */
  audience?: DgoAudience;
  /** False only when DGO runs as a pilot and you're not in it (Phase 4). */
  inPilot?: boolean;
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
  /** Change to points held for rewards: reserve +P, release −P, redeem −P (0 or absent otherwise). */
  reservedDelta?: number;
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
  program: {
    openToEmployees: boolean;
    revenueDepartments: string[];
    // Phase 2
    leaderboardVisibility?: DgoLeaderboardVisibility;
    nominationsPerMonth?: number;
    eliteCategories?: DgoEliteCategory[];
    // Phase 4
    audience?: DgoAudience;
    pilotDepartments?: string[];
    pilotEmployees?: DgoPilotPerson[];
    pilotHeadcount?: number;
  };
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
  // Phase 2 — absent on a server from before Phase 2.
  /** recorded = by a head/HR; nomination = sent in by a colleague; elite = a monthly achiever prize. */
  origin?: "recorded" | "nomination" | "elite";
  evidenceUrl?: string | null;   // 1-hour link, null when no file
  evidenceName?: string | null;
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
  // Phase 3 — absent on an older server.
  /** Month close: open → asked to close → closed by a second person. Never reopened. */
  close?: DgoMonthClose;
  /** Allowance overrides for this month, pending first. */
  overrides?: DgoOverride[];
  /** Where the entered collections figure came from. */
  collectionsSource?: "typed" | "finance" | null;
  /** Finance's breakdown, when the figure came from finance. */
  collectionsBreakdown?: DgoCollectionsBreakdown | null;
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
  departments: Array<{
    id: string | null; name: string; group: DgoGroup; headcount: number; allocationAed: number; committedAed: number; leftAed: number;
    /** An approved override in force for this month (Phase 3). */
    overrideAed?: number | null;
  }>;
  history: Array<{ action: string; amountAed: number | null; byName: string | null; at: string; note: string | null }>;
  can: {
    enter: boolean; confirm: boolean; recount: boolean;
    // Phase 3
    fetchCollections?: boolean;
    proposeOverride?: boolean;
  };
}
/** POST /dgo-points/budgets/:month/collections body { amountAed, note? } → DgoBudgetView (dgoBudgets.edit) */
/** POST /dgo-points/budgets/:month/collections/confirm → DgoBudgetView (dgoBudgets.approve, not the person who entered it) */
/** POST /dgo-points/budgets/:month/recount → DgoBudgetView (dgoBudgets.edit) — re-reads headcount per department */

/** GET /dgo-points/audit?page=&limit=&action=&entity=&actor=&from=&to= (dgoAudit.view) → DgoAuditView */

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

export interface DgoProgramInput {
  openToEmployees?: boolean;
  revenueDepartments?: string[];
  leaderboardVisibility?: DgoLeaderboardVisibility;
  nominationsPerMonth?: number;
  eliteCategories?: DgoEliteCategory[];
  // Phase 4
  audience?: DgoAudience;
  pilotDepartments?: string[];
  /** Employee ids. */
  pilotEmployees?: string[];
}

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
  /** Every action and entity in the log, for the filters (Phase 3). */
  actions?: string[];
  entities?: string[];
}

export interface DgoAuditParams {
  page: number;
  limit: number;
  action?: string;
  entity?: string;
  actor?: string;
  from?: string;
  to?: string;
}

// ═══ Phase 2 — nominations, rewards, redemptions, leaderboard, achievers ═══════

/** POST /dgo-points/uploads?kind=evidence|reward (multipart "file"). Keep `key`; `url` is a 1-hour preview. */
export type DgoUploadKind = "evidence" | "reward";
export interface DgoUpload { key: string; url: string; fileName: string; contentType: string }

export interface DgoNominationRule {
  code: string; name: string; description: string; points: number; aed: number;
  needsEvidence: boolean; chain: DgoStage[]; capExempt: boolean;
}

/** POST /dgo-points/nominations */
export interface DgoNominateInput {
  employeeId: string;
  ruleCode: string;
  day: string;
  reason: string;
  evidenceNote?: string | null;
  evidenceKey?: string | null;
  /** The uploaded file's own name, shown to approvers. */
  evidenceName?: string | null;
  requestId: string;
}

export type DgoNominationsTab = "sent" | "received";

/** GET /dgo-points/nominations?tab=sent|received */
export interface DgoNominationsView {
  tab: DgoNominationsTab;
  limit: number;
  usedThisMonth: number;
  left: number;
  rules: DgoNominationRule[];
  counts: { sent: number; received: number };
  items: DgoEvent[];
}

/** GET /dgo-points/colleagues?search= */
export interface DgoColleague { id: string; name: string; department: string | null; designation: string | null; photoUrl: string | null }

export type DgoRewardStatus = "active" | "hidden" | "archived";
export type DgoStockMode = "unlimited" | "limited";

export interface DgoReward {
  id: string;
  name: string;
  description: string;
  category: string;
  photoUrl: string | null;
  photoKey: string | null;
  points: number;
  aed: number;
  costAed: number | null;
  stockMode: DgoStockMode;
  stock: number | null;
  status: DgoRewardStatus;
  affordable: boolean;
  short: number;
  redeemedCount: number;
  createdAt: string;
  updatedAt: string;
  /** HR's approval raises a purchase request to finance for each redemption (Phase 3; managers only). */
  buyPerRedemption?: boolean;
}

/** GET /dgo-points/rewards?manage=1 */
export interface DgoRewardsView {
  rewards: DgoReward[];
  available: number;
  minRedemption: number;
  pointValueAed: number;
  categories: string[];
}

/** POST /dgo-points/rewards, PUT /dgo-points/rewards/:id */
export interface DgoRewardInput {
  name: string;
  description?: string;
  category: string;
  photoKey?: string | null;
  points: number;
  costAed?: number | null;
  stockMode: DgoStockMode;
  stock?: number | null;
  status: "active" | "hidden";
  /** Phase 3: raise a purchase request to finance for each approved redemption. */
  buyPerRedemption?: boolean;
}

export type DgoRedemptionStatus = "reserved" | "approved" | "fulfilled" | "cancelled" | "rejected";

export interface DgoRedemption {
  id: string;
  employee: { id: string; name: string; department: string | null };
  reward: { id: string; name: string; category: string; photoUrl: string | null };
  points: number;
  aed: number;
  costAed: number | null;
  status: DgoRedemptionStatus;
  note: string | null;
  fulfilmentNote: string | null;
  trail: Array<{ action: string; byName: string | null; note: string | null; at: string }>;
  createdAt: string;
  updatedAt: string;
  canCancel: boolean;
  canApprove: boolean;
  canReject: boolean;
  canFulfil: boolean;
  whyNot: string | null;
  /** The purchase finance approves for this redemption (Phase 3). `ref` is finance's EXP number once approved. */
  purchase?: { status: DgoPurchaseStatus; ref: string | null };
}

export type DgoPurchaseStatus = "not_needed" | "waiting_finance" | "approved" | "rejected" | "cancelled";

/** POST /dgo-points/redemptions */
export interface DgoRedeemInput { rewardId: string; note?: string | null; requestId: string }

export type DgoRedemptionsTab = "mine" | "queue" | "done";

/** GET /dgo-points/redemptions?tab=mine|queue|done&status= */
export interface DgoRedemptionsView {
  tab: DgoRedemptionsTab;
  counts: { mine: number; queue: number; done: number };
  items: DgoRedemption[];
}

export type DgoLeaderboardVisibility = "everyone" | "department" | "managers";

/** GET /dgo-points/leaderboard?month=&department= */
export interface DgoLeaderboardView {
  month: string;
  visibility: DgoLeaderboardVisibility;
  scope: "company" | "department" | "own";
  departments: Array<{ id: string; name: string }>;
  department: string | null;
  rows: Array<{ rank: number; employeeId: string; name: string; department: string | null; points: number; photoUrl: string | null; me: boolean }>;
  me: { rank: number | null; points: number; of: number } | null;
  note: string;
}

export type DgoAchieverStatus = "none" | "provisional" | "locked" | "verified" | "published";
export type DgoEliteMetric = "sales" | "team" | "cs" | "cs_department" | "mentor_chief" | "mentor_senior" | "mentor_junior";

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

export interface DgoAchieverCandidate {
  email: string;
  name: string;
  employeeId: string | null;
  employeeName: string | null;
  value: number;
  detail: string | null;
  eligible: boolean;
  why: string | null;
  tied: boolean;
}

export interface DgoAchieverCategoryResult {
  code: string;
  name: string;
  metric: DgoEliteMetric;
  place: number;
  threshold: number;
  prizeAed: number;
  prizePoints: number;
  winner: DgoAchieverCandidate | null;
  tie: boolean;
  pickedByName: string | null;
  candidates: DgoAchieverCandidate[];
  /** Set once published. `takenBack`: finance reversed the prize (reviewers only see those). */
  award: { eventId: string; employeeName: string; points: number; takenBack?: boolean } | null;
}

/** GET /dgo-points/achievers?month= */
export interface DgoAchieversView {
  month: string;
  status: DgoAchieverStatus;
  review: boolean;
  pool: { eliteAed: number; prizesAed: number; fits: boolean; collectionsConfirmedAed: number | null; thresholdAed: number };
  lockedReason: string | null;
  problems: string[];
  fetchedAt: string | null; fetchedByName: string | null;
  verifiedAt: string | null; verifiedByName: string | null;
  publishedAt: string | null; publishedByName: string | null;
  categories: DgoAchieverCategoryResult[];
  trail: Array<{ action: string; byName: string | null; note: string | null; at: string }>;
  months: Array<{ month: string; status: DgoAchieverStatus }>;
  can: { fetch: boolean; pick: boolean; verify: boolean; sendBack: boolean; approve: boolean };
}

// ═══ Phase 3 — month close, reconciliation, adjustments, overrides, reports, audit ═══

/** opening + issued − spent − reversed − expired + adjusted = closing (outstanding = spendable + held). */
export interface DgoPointTotals { opening: number; issued: number; spent: number; reversed: number; expired: number; adjusted: number; closing: number }

export interface DgoMonthSnapshot {
  takenAt: string;
  pointValueAed: number;
  collectionsAed: number | null;
  tierLabel: string;
  everydayAed: number;
  eliteAed: number;
  elitePaidAed: number;
  points: DgoPointTotals;
  liabilityAed: number;
  departments: Array<{ name: string; group: DgoGroup; allocationAed: number; committedAed: number; overrideAed: number | null }>;
  counts: { earningsPosted: number; nominationsPosted: number; redemptionsFulfilled: number; adjustments: number };
}

export interface DgoMonthClose {
  status: "open" | "review" | "closed";
  requestedByName: string | null;
  requestedAt: string | null;
  requestNote: string | null;
  closedByName: string | null;
  closedAt: string | null;
  /** Why it can't be closed yet (empty = ready). */
  blockers: string[];
  snapshot: DgoMonthSnapshot | null;
  can: { request: boolean; approve: boolean; cancel: boolean };
}

export interface DgoCollectionsBreakdown {
  month: string;
  currency: string;
  grossAed: number;
  vatAed: number;
  netAed: number;
  reconciledNetAed: number;
  unreconciledNetAed: number;
  pendingLateEntries: { count: number; netAed: number };
  payments: number;
  byMethod: Array<{ method: string; count: number; netAed: number }>;
  creditNotes: { count: number; totalAed: number };
  computedAt: string;
}

export interface DgoOverride {
  id: string;
  month: string;
  department: { id: string | null; name: string };
  fromAed: number;
  toAed: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  proposedByName: string | null;
  proposedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
  whyNot: string | null;
}

/** POST /dgo-points/budgets/:month/overrides */
export interface DgoOverrideInput { month: string; departmentId: string | null; allocationAed: number; reason: string; requestId: string }

export interface DgoAdjustment {
  id: string;
  employee: { id: string; name: string; department: string | null };
  /** Signed: +50 adds, −50 removes. */
  points: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  proposedByName: string | null;
  proposedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
  whyNot: string | null;
}

export type DgoAdjustmentsTab = "pending" | "done";

/** GET /dgo-points/adjustments?status=pending|done */
export interface DgoAdjustmentsView { items: DgoAdjustment[]; counts: { pending: number; done: number } }

/** POST /dgo-points/adjustments */
export interface DgoAdjustmentInput { employeeId: string; points: number; reason: string; requestId: string }

export interface DgoWaitingCount { count: number; oldestDays: number | null }

/** GET /dgo-points/reports/overview?month= */
export interface DgoReportsOverview {
  month: string;
  pointValueAed: number;
  trend: Array<DgoPointTotals & { month: string; liabilityAed: number; closed: boolean }>;
  byDepartment: Array<{ name: string; group: DgoGroup; allocationAed: number; committedAed: number; usedPct: number; points: number }>;
  byRule: Array<{ code: string; name: string; count: number; points: number }>;
  topEarners: Array<{ employeeId: string; name: string; department: string | null; points: number }>;
  rewards: Array<{ name: string; redeemed: number; points: number }>;
  waiting: { earnings: DgoWaitingCount; redemptions: DgoWaitingCount; adjustments: DgoWaitingCount; overrides: DgoWaitingCount };
}

/** GET /dgo-points/reports/reconciliation?month= */
export interface DgoReconciliation {
  month: string;
  closed: boolean;
  totals: DgoPointTotals;
  liabilityAed: number;
  equationHolds: boolean;
  /** For a closed month: does today's recount still equal the snapshot? null while open. */
  snapshotMatches: boolean | null;
  wallets: {
    ledgerOutstanding: number;
    walletOutstanding: number;
    matches: boolean;
    drifted: Array<{ employeeId: string; name: string; ledger: number; wallet: number }>;
  };
  people: Array<{ employeeId: string; name: string; department: string | null } & DgoPointTotals>;
}

/** GET /dgo-points/reports/export?kind=&month= → text/csv */
export type DgoExportKind = "ledger" | "wallets" | "redemptions" | "reconciliation";

// ─── Phase 4 ──────────────────────────────────────────────────────────────────

/** Open to everybody once switched on, or only to a pilot group. */
export type DgoAudience = "everyone" | "pilot";

export interface DgoPilotPerson { id: string; name: string; department: string | null }

export type DgoSyncSource = "kpi" | "achievers" | "collections";

/** One run of a feed into DGO Points. */
export interface DgoSyncRun {
  id: string;
  source: DgoSyncSource;
  /** The day (kpi), or month (achievers / collections) it was for. */
  key: string;
  trigger: "nightly" | "manual";
  byName: string | null;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  /** kpi: facts, awarded, alreadyThere, belowTarget, notInHrms, notInPilot, monthClosed, capped, budgetBlocked, suggestions. */
  counts: Record<string, number>;
  unmatched: Array<{ email: string; name: string; crm: string | null; achievedPct: number | null; why: string }>;
  errors: string[];
  problems: string[];
}

/** GET /dgo-points/integrations (dgoSettings view or dgoBudgets view) */
export interface DgoIntegrationsView {
  sources: Array<{
    key: DgoSyncSource;
    name: string;
    schedule: string;
    configured: boolean;
    configHint: string | null;
    lastRun: DgoSyncRun | null;
    lastOkAt: string | null;
    failuresLast7Days: number;
    where: string | null;
  }>;
  runs: DgoSyncRun[];
  can: { runKpi: boolean };
}

/** POST /dgo-points/integrations/kpi/run */
export interface DgoKpiRunResult { run: DgoSyncRun }

export type DgoSuggestionStatus = "open" | "recorded" | "dismissed";

/** An award somebody may record in one click — e.g. a verified 5-star student review. */
export interface DgoSuggestion {
  id: string;
  source: "lms_review";
  employee: { id: string; name: string; department: string | null };
  ruleCode: string;
  ruleName: string;
  points: number;
  day: string;
  title: string;
  detail: string;
  status: DgoSuggestionStatus;
  eventId: string | null;
  decidedByName: string | null;
  canRecord: boolean;
}

export type DgoSuggestionsTab = "open" | "done";

/** GET /dgo-points/suggestions?status=open|done */
export interface DgoSuggestionsView { items: DgoSuggestion[]; counts: { open: number; done: number } }

