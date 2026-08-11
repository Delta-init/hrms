import mongoose from "mongoose";
import { Organization } from "../models/Organization.js";
import { runWithOrg } from "../utils/orgContext.js";
import { ADAPTERS, adapterFor, chainOf, type ApprovalRow, type ApprovalModule } from "./approvalRegistry.js";
import type { ReviewerRole } from "./approvalWorkflowService.js";

/**
 * Everything waiting on management, across every organisation.
 *
 * Cross-organisation by default, which is the whole point: somebody running
 * several tenants should not have to remember which one a request came from to
 * discover it is waiting. Every row therefore carries its organisation's name —
 * without it you cannot tell whose leave you are approving.
 *
 * This reads directly rather than through each module's own scoped list, so the
 * queries here are explicitly unscoped and the route above is restricted to a
 * Super Admin. Deciding is not: it re-enters the record's own organisation and
 * calls that module's review method, so every rule, side effect and notification
 * that normally applies still does.
 */

class InboxError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface InboxQuery {
  module?: string;
  organization?: string;
  search?: string;
  /** ISO days, on when the request was raised. */
  from?: string;
  to?: string;
}

export class ApprovalInboxService {
  private async orgNames(): Promise<Map<string, string>> {
    const orgs = await Organization.find({}).select("name").lean<Array<{ _id: unknown; name: string }>>();
    return new Map(orgs.map((o) => [String(o._id), o.name]));
  }

  /** Everything still waiting, newest first, with per-module counts. */
  async list(query: InboxQuery) {
    const names = await this.orgNames();
    const wanted = query.module ? ADAPTERS.filter((a) => a.module === query.module) : ADAPTERS;

    const raised: Record<string, Date> = {};
    if (query.from) raised.$gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) raised.$lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000);

    // Seven small queries in parallel. Cheaper than it looks, and it cannot
    // drift from the records the way a mirrored table would.
    const perModule = await Promise.all(
      wanted.map(async (a) => {
        const filter: Record<string, unknown> = { ...a.pendingFilter };
        if (query.organization) filter.organization = new mongoose.Types.ObjectId(query.organization);
        if (Object.keys(raised).length) filter.createdAt = raised;

        let q = a.model.find(filter as never).sort({ createdAt: -1 }).limit(200);
        for (const p of a.populate) q = q.populate(p as never);
        const docs = await q.lean<Array<Record<string, never>>>();

        return docs.map((d): ApprovalRow => {
          const org = d.organization ? String(d.organization) : null;
          return {
            ...a.toRow(d),
            module: a.module,
            moduleLabel: a.label,
            organization: { id: org, name: org ? names.get(org) ?? null : null },
            chain: chainOf(d),
          };
        });
      })
    );

    let rows = perModule.flat();

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

    // Oldest first: the queue is a to-do list, and the thing that has been
    // waiting longest is the one somebody is waiting on.
    rows.sort((a, b) => (a.raisedAt?.getTime() ?? 0) - (b.raisedAt?.getTime() ?? 0));

    return { rows, counts, total: rows.length };
  }

  /** The whole record behind one row, for the view panel. */
  async detail(module: string, id: string) {
    const a = adapterFor(module);
    if (!a) throw new InboxError(`Unknown approval type: ${module}`, 404);

    let q = a.model.findById(id);
    for (const p of a.populate) q = q.populate(p as never);
    const doc = await q.lean<Record<string, never> | null>();
    if (!doc) throw new InboxError("That request no longer exists", 404);

    const names = await this.orgNames();
    const org = doc.organization ? String(doc.organization) : null;
    return {
      row: {
        ...a.toRow(doc),
        module: a.module,
        moduleLabel: a.label,
        organization: { id: org, name: org ? names.get(org) ?? null : null },
        chain: chainOf(doc),
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
    role: ReviewerRole
  ) {
    const a = adapterFor(module);
    if (!a) throw new InboxError(`Unknown approval type: ${module}`, 404);

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
    role: ReviewerRole
  ) {
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          await this.decide(module, id, approve, note, userId, role);
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

  /** The modules this inbox knows about, for the filter. */
  modules(): Array<{ module: ApprovalModule; label: string }> {
    return ADAPTERS.map((a) => ({ module: a.module, label: a.label }));
  }
}
