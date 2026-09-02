import mongoose from "mongoose";
import { Organization } from "../models/Organization.js";
import { runWithOrg } from "../utils/orgContext.js";
import { ADAPTERS, adapterFor, chainOf, isDecided, type ApprovalRow, type ApprovalModule, type DepartmentSubjects } from "./approvalRegistry.js";
import { Employee } from "../models/Employee.js";
import { teamMemberUserIds } from "./departmentHeadService.js";
import { hasPermission } from "../middleware/permissions.js";
import type { AuthenticatedRequest } from "../types/index.js";
import type { ReviewerRole } from "./approvalWorkflowService.js";

/**
 * Everything waiting on management, across every organisation.
 *
 * Cross-organisation by default, which is the whole point: somebody running
 * several tenants should not have to remember which one a request came from to
 * discover it is waiting. Every row therefore carries its organisation's name —
 * without it you cannot tell whose leave you are approving.
 *
 * Cross-organisation for a Super Admin, and for nobody else. Everyone else is
 * narrowed by the scope resolved below before a single query is built — because
 * these queries are hand-written rather than run through each module's own
 * `scoped()` list, forgetting to narrow them would not fail loudly, it would
 * quietly hand one tenant another tenant's leave requests.
 *
 * Deciding always re-enters the record's own organisation and calls that
 * module's review method, so every rule, side effect and notification that
 * normally applies still does.
 */

/**
 * Which queues somebody may see, and whose requests within them.
 *
 * Three answers, narrowing: a Super Admin sees everything; somebody holding a
 * module's `approve` permission sees that queue across their own organisation;
 * a department head sees leave and corrections from their own department and
 * nothing else at all.
 *
 * The three are additive rather than exclusive, which is the point — HR that
 * also heads a department loses nothing by heading it.
 */
export interface InboxScope {
  /** Super Admin. Every organisation, every module, no filter. */
  everything: boolean;
  /** The one organisation everybody else is confined to. */
  orgId: string | null;
  /** Modules whose `approve` permission this person holds. */
  approve: Set<ApprovalModule>;
  /** Their department's people — empty for almost everybody. */
  teamUserIds: string[];
}

/**
 * What a head may decide, and deliberately only this.
 *
 * A head runs a team's time; they do not sign off its reimbursements, its
 * confirmations or its resignations, all of which carry money or employment
 * consequences that belong with HR. Widening this list is a policy decision,
 * so it is a list rather than a rule somebody could satisfy accidentally.
 */
const HEAD_MODULES: ApprovalModule[] = ["leave", "regularization"];

/** Nothing to show, and nothing to decide — used to refuse the page outright. */
export const scopeIsEmpty = (scope: InboxScope) =>
  !scope.everything && !scope.approve.size && !scope.teamUserIds.length;

/**
 * The unrestricted scope, for callers that are not a person.
 *
 * A scheduled digest has no session and no role to resolve, and it reads the
 * same cross-organisation view a Super Admin does. Named rather than passed as
 * a bare object literal so that anywhere the scoping is bypassed is greppable.
 */
export const SYSTEM_SCOPE: InboxScope = {
  everything: true,
  orgId: null,
  approve: new Set(ADAPTERS.map((a) => a.module)),
  teamUserIds: [],
};

export async function resolveInboxScope(
  user: NonNullable<AuthenticatedRequest["user"]>,
  orgId: string | null
): Promise<InboxScope> {
  const role = user.role;
  if (role?.isSystemRole && role.roleName === "Super Admin") {
    return { everything: true, orgId, approve: new Set(ADAPTERS.map((a) => a.module)), teamUserIds: [] };
  }
  const approve = new Set(
    ADAPTERS.filter((a) => hasPermission(role, a.permissionModule, "approve")).map((a) => a.module)
  );
  // Only looked up when it could matter. Almost nobody heads a department, and
  // this runs on every load of the page and of the sidebar badge.
  const teamUserIds = await teamMemberUserIds(user.userId);
  return { everything: false, orgId, approve, teamUserIds };
}

/**
 * The filter narrowing one queue to what this person may see — or null when the
 * queue is not theirs at all, which is the commonest answer.
 *
 * Returning null rather than an impossible filter matters: a caller that skips
 * the module entirely cannot later merge something into a filter that was meant
 * to match nothing.
 */
/**
 * Everyone in one department, in the shapes the adapters key on.
 *
 * Resolved once per request rather than per module: eight adapters asking the
 * same question of the same department is eight identical queries for a filter
 * that changes nothing between them.
 *
 * Read across organisations deliberately — a department id belongs to exactly
 * one organisation, so scoping this would only make a Super Admin's filter
 * return nothing while adding no safety the per-module scope does not already
 * provide.
 */
export async function departmentSubjects(departmentId: string): Promise<DepartmentSubjects> {
  const members = await Employee.find({ department: departmentId })
    .select("_id user")
    .lean<Array<{ _id: unknown; user?: unknown }>>();
  return {
    departmentId: new mongoose.Types.ObjectId(departmentId),
    userIds: members.filter((m) => m.user).map((m) => new mongoose.Types.ObjectId(String(m.user))),
    employeeIds: members.map((m) => new mongoose.Types.ObjectId(String(m._id))),
  };
}

/**
 * Merge a department filter into a scope filter without either silently winning.
 *
 * Both may constrain the same field — a head's scope restricts `user` to their
 * own team, and a department filter restricts it to that department's people.
 * Assigning one over the other would answer the wrong question: a head who
 * picks a department they do not head would otherwise see their own team's rows
 * under that department's name, which is worse than seeing none.
 *
 * So overlapping `$in` lists are intersected, which gives the only honest
 * answer — everyone who is in both — and an empty list where there is no
 * overlap, which matches nothing.
 */
function mergeFilters(scope: Record<string, unknown>, department: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...department };
  for (const [key, value] of Object.entries(scope)) {
    const existing = out[key];
    const a = (existing as { $in?: unknown[] } | undefined)?.$in;
    const b = (value as { $in?: unknown[] } | undefined)?.$in;
    if (a && b) {
      const keep = new Set(b.map(String));
      out[key] = { $in: a.filter((id) => keep.has(String(id))) };
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function scopeFilterFor(scope: InboxScope, module: ApprovalModule): Record<string, unknown> | null {
  if (scope.everything) return {};
  // No organisation resolved means no safe way to narrow, so nothing is shown.
  if (!scope.orgId) return null;
  const org = { organization: new mongoose.Types.ObjectId(scope.orgId) };
  if (scope.approve.has(module)) return org;
  if (scope.teamUserIds.length && HEAD_MODULES.includes(module)) {
    return { ...org, user: { $in: scope.teamUserIds.map((id) => new mongoose.Types.ObjectId(id)) } };
  }
  return null;
}

class InboxError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface InboxQuery {
  /** "pending" (default) is the queue; "decided" is the history. */
  view?: string;
  module?: string;
  organization?: string;
  search?: string;
  /** One department, by id — everything raised by or about its people. */
  department?: string;
  /** ISO days — on when it was raised, or when it was decided. */
  from?: string;
  to?: string;
}

/**
 * Per module, so one busy queue cannot crowd out the other six.
 *
 * Reported back rather than applied quietly: a list that silently stops at 200
 * reads as "that is everything", which is the one thing it is not.
 */
const PER_MODULE_LIMIT = 200;

/**
 * Past this, a request is not in progress — it is stuck.
 *
 * A week is roughly when the person who raised it has chased once and given up.
 * The console draws these differently and the digest leads with them.
 */
export const STALE_AFTER_DAYS = 7;

export class ApprovalInboxService {
  private async orgNames(): Promise<Map<string, string>> {
    const orgs = await Organization.find({}).select("name").lean<Array<{ _id: unknown; name: string }>>();
    return new Map(orgs.map((o) => [String(o._id), o.name]));
  }

  /**
   * One view over the seven, with per-module counts.
   *
   * The two views are ordered oppositely on purpose. Pending is a to-do list, so
   * the thing that has waited longest comes first. Decided is a history, so the
   * most recent decision comes first. That ordering is applied in the database
   * as well as in memory — otherwise the per-module cap would keep the wrong
   * end of each queue and quietly hide exactly the rows the sort says matter.
   */
  async list(query: InboxQuery, scope: InboxScope) {
    const decidedView = query.view === "decided";
    const names = await this.orgNames();
    // Narrowed before the module filter, so asking for a queue that is not
    // yours returns an empty list rather than somebody else's.
    const wanted = (query.module ? ADAPTERS.filter((a) => a.module === query.module) : ADAPTERS)
      .map((a) => ({ adapter: a, scopeFilter: scopeFilterFor(scope, a.module) }))
      .filter((x): x is { adapter: typeof x.adapter; scopeFilter: Record<string, unknown> } => x.scopeFilter !== null)
      // Asking for one department drops the queues that cannot answer for one.
      // A list captioned with a department name must not carry rows that are
      // not that department's, and showing them unfiltered would do exactly
      // that under a heading that says otherwise.
      .filter((x) => !query.department || x.adapter.departmentFilter !== null);

    const subjects = query.department ? await departmentSubjects(query.department) : null;

    const window: Record<string, Date> = {};
    if (query.from) window.$gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) window.$lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000);

    // Seven small queries in parallel. Cheaper than it looks, and it cannot
    // drift from the records the way a mirrored table would.
    const perModule = await Promise.all(
      wanted.map(async ({ adapter: a, scopeFilter }) => {
        // The scope goes on last, so an `organization` asked for in the query
        // can narrow the scope but never widen past it.
        const filter: Record<string, unknown> = { ...(decidedView ? a.decided.filter : a.pendingFilter) };
        if (query.organization) filter.organization = new mongoose.Types.ObjectId(query.organization);
        Object.assign(filter, subjects ? mergeFilters(scopeFilter, a.departmentFilter!(subjects)) : scopeFilter);

        // On the history the dates people mean are when it was decided, not
        // when it was raised — and each module dates both differently.
        const dateField = decidedView ? a.decided.dateField : a.raisedField;
        if (Object.keys(window).length) filter[dateField] = window;

        let q = a.model
          .find(filter as never)
          .sort({ [dateField]: decidedView ? -1 : 1 })
          .limit(PER_MODULE_LIMIT);
        for (const p of [...a.populate, ...(decidedView ? a.decided.populate : [])]) {
          q = q.populate(p as never);
        }
        const docs = await q.lean<Array<Record<string, never>>>();

        const rows = docs.map((d): ApprovalRow => {
          const org = d.organization ? String(d.organization) : null;
          return {
            ...a.toRow(d),
            module: a.module,
            moduleLabel: a.label,
            organization: { id: org, name: org ? names.get(org) ?? null : null },
            chain: chainOf(d),
            decided: decidedView ? a.decided.outcome(d) : null,
          };
        });
        return { module: a.module, rows, capped: docs.length === PER_MODULE_LIMIT };
      })
    );

    let rows = perModule.flatMap((m) => m.rows);
    const capped = perModule.filter((m) => m.capped).map((m) => m.module);

    // Counts are taken before the search so the chips keep reporting the size of
    // each queue rather than the size of the current view.
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.module] = (acc[r.module] ?? 0) + 1;
      return acc;
    }, {});

    if (query.search) {
      const term = query.search.trim().toLowerCase();
      rows = rows.filter((r) =>
        `${r.title} ${r.raisedBy?.name ?? ""} ${r.organization.name ?? ""} ${r.summary.map((s) => s.value).join(" ")}`
          .toLowerCase()
          .includes(term)
      );
    }

    const at = (r: ApprovalRow) => (decidedView ? r.decided?.at : r.raisedAt)?.getTime() ?? 0;
    rows.sort((x, y) => (decidedView ? at(y) - at(x) : at(x) - at(y)));

    // Sent with the rows so the console and the dashboard agree on what counts
    // as stuck, rather than each keeping its own copy of the number.
    return { rows, counts, total: rows.length, capped, limit: PER_MODULE_LIMIT, staleAfterDays: STALE_AFTER_DAYS };
  }

  /**
   * Just the numbers, for the dashboard.
   *
   * One aggregation per module rather than `list()`'s documents: a card that
   * says "14 waiting" should not cost seven populated queries of up to 200 rows
   * each, on a page that loads on every visit.
   */
  async summary(scope: InboxScope) {
    const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);

    const perModule = await Promise.all(
      ADAPTERS.map(async (a) => {
        const scopeFilter = scopeFilterFor(scope, a.module);
        // Not theirs: reported as zero rather than omitted, so the shape of the
        // response does not change with who is asking.
        if (!scopeFilter) {
          return { module: a.module, label: a.label, count: 0, oldest: null, stale: 0, organizations: [] as unknown[] };
        }
        const [row] = await a.model.aggregate([
          // An aggregation gets no schema casting, so the ids in the scope
          // filter are already real ObjectIds — a string here matches nothing
          // and would report every queue as empty.
          { $match: { ...a.pendingFilter, ...scopeFilter } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              oldest: { $min: `$${a.raisedField}` },
              // Counted here rather than derived from a page of rows, so the
              // number is the whole queue and not just the part that fitted.
              stale: { $sum: { $cond: [{ $lt: [`$${a.raisedField}`, cutoff] }, 1, 0] } },
              organizations: { $addToSet: "$organization" },
            },
          },
        ]);
        return {
          module: a.module,
          label: a.label,
          count: (row?.count as number) ?? 0,
          oldest: (row?.oldest as Date) ?? null,
          stale: (row?.stale as number) ?? 0,
          organizations: (row?.organizations as unknown[]) ?? [],
        };
      })
    );

    const waiting = perModule.filter((m) => m.count > 0);
    const oldest = waiting.map((m) => m.oldest).filter(Boolean).sort((x, y) => x!.getTime() - y!.getTime())[0] ?? null;

    return {
      total: perModule.reduce((n, m) => n + m.count, 0),
      stale: perModule.reduce((n, m) => n + m.stale, 0),
      staleAfterDays: STALE_AFTER_DAYS,
      /** Longest anything has been waiting — the number that says "act now". */
      oldestRaisedAt: oldest,
      /** How many organisations have something waiting, not how many exist. */
      organizations: new Set(waiting.flatMap((m) => m.organizations.map(String))).size,
      byModule: perModule.map(({ organizations, ...m }) => m),
    };
  }

  /** The whole record behind one row, for the view panel. */
  async detail(module: string, id: string, scope: InboxScope) {
    const a = adapterFor(module);
    if (!a) throw new InboxError(`Unknown approval type: ${module}`, 404);
    await this.assertInScope(a.module, id, scope);

    let q = a.model.findById(id);
    for (const p of [...a.populate, ...a.decided.populate]) q = q.populate(p as never);
    const doc = await q.lean<Record<string, never> | null>();
    if (!doc) throw new InboxError("That request no longer exists", 404);

    const names = await this.orgNames();
    const org = doc.organization ? String(doc.organization) : null;
    // Opened from either view, and from a stale list — so the panel reports what
    // the record says now rather than what the row said when it was drawn.
    const settled = isDecided(a.module, doc);
    return {
      row: {
        ...a.toRow(doc),
        module: a.module,
        moduleLabel: a.label,
        organization: { id: org, name: org ? names.get(org) ?? null : null },
        chain: chainOf(doc),
        decided: settled ? a.decided.outcome(doc) : null,
      },
      // Everything the record holds, for the detail panel to lay out.
      record: doc,
    };
  }

  /**
   * Approve or reject one request.
   *
   * Run inside the record's own organisation: every module resolves records
   * through `scoped()`, so deciding another tenant's request from a global list
   * would otherwise read as "not found" — or, worse if the scoping were ever
   * relaxed, act on the wrong record.
   */
  async decide(
    module: string,
    id: string,
    approve: boolean,
    note: string | undefined,
    userId: string,
    role: ReviewerRole,
    scope: InboxScope
  ) {
    const a = adapterFor(module);
    if (!a) throw new InboxError(`Unknown approval type: ${module}`, 404);
    await this.assertInScope(a.module, id, scope);

    const doc = await a.model.findById(id).select("organization").lean<{ organization?: unknown } | null>();
    if (!doc) throw new InboxError("That request no longer exists", 404);
    const orgId = doc.organization ? String(doc.organization) : null;

    return new Promise((resolve, reject) => {
      runWithOrg({ orgId, isSuperAdmin: true }, () => {
        a.decide(id, approve, note, userId, role).then(resolve, reject);
      });
    });
  }

  /**
   * Decide several at once.
   *
   * One module at a time, and every failure is reported rather than rolled up:
   * a bulk action that says "12 approved" while three silently failed is worse
   * than no bulk action at all.
   */
  async decideMany(
    module: string,
    ids: string[],
    approve: boolean,
    note: string | undefined,
    userId: string,
    role: ReviewerRole,
    scope: InboxScope
  ) {
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          await this.decide(module, id, approve, note, userId, role, scope);
          return { id, ok: true as const };
        } catch (error) {
          return { id, ok: false as const, error: error instanceof Error ? error.message : "Failed" };
        }
      })
    );
    const failed = results.filter((r) => !r.ok);
    return {
      requested: ids.length,
      succeeded: results.length - failed.length,
      failed,
    };
  }

  /** The modules this person can act on, for the filter. */
  modules(scope: InboxScope): Array<{ module: ApprovalModule; label: string }> {
    return ADAPTERS.filter((a) => scopeFilterFor(scope, a.module) !== null)
      .map((a) => ({ module: a.module, label: a.label }));
  }

  /**
   * Refuse a record the caller is not entitled to, by id.
   *
   * Re-queried rather than trusted from the list, because the list and the
   * action are separate requests and an id can be typed into either. Answering
   * 404 rather than 403 on a record outside the scope is deliberate: "not
   * yours" and "does not exist" should be indistinguishable from outside, or
   * the error itself confirms that another tenant's request exists.
   */
  private async assertInScope(module: ApprovalModule, id: string, scope: InboxScope): Promise<void> {
    const a = adapterFor(module)!;
    const scopeFilter = scopeFilterFor(scope, module);
    if (!scopeFilter) throw new InboxError("That request no longer exists", 404);
    if (!Object.keys(scopeFilter).length) return;
    const ok = await a.model.exists({ _id: id, ...scopeFilter } as never);
    if (!ok) throw new InboxError("That request no longer exists", 404);
  }
}
