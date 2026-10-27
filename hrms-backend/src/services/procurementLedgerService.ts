import { Procurement } from "../models/Procurement.js";
import { ProcurementIssue } from "../models/ProcurementIssue.js";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import type { GiveOutInput } from "../validations/procurementValidation.js";
import { Types } from "mongoose";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

/**
 * What procurement has brought in, what has been handed out, and what is left.
 *
 * An item is its name — lower-cased, spaces collapsed — so the third purchase
 * of toilet cleaners adds to the same shelf as the first two. Only `received`
 * counts as stock; `ordered` is shown as on its way and counts for nothing until
 * it arrives. A `new` request finance approved is not stock either, until it
 * too is marked received.
 */
export const itemKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const STOCK_STATES = ["ordered", "received"];

/** The org scope for an aggregate, which — unlike find — does not cast a string id. */
const orgMatch = () => {
  const org = getOrgId();
  return org ? { organization: new Types.ObjectId(org) } : {};
};

type Bought = {
  _id: unknown; item: string; category?: string; quantity: number; status: string; kind: string;
  vendor?: string; createdAt: Date; updatedAt: Date; department?: { name?: string } | null;
};

/** When it came in: a bought record is entered as it arrives; a request is marked received later. */
const arrivedAt = (p: Bought) => (p.kind === "new" ? p.updatedAt : p.createdAt);

export class ProcurementLedgerService {
  private async bought(key?: string) {
    const rows = await Procurement.find({ ...orgFilter(), status: { $in: STOCK_STATES } })
      .select("item category quantity status kind vendor createdAt updatedAt department")
      .populate({ path: "department", select: "name" })
      .sort({ createdAt: 1 })
      .lean<Bought[]>();
    return key ? rows.filter((r) => itemKey(r.item) === key) : rows;
  }

  /** One row per item: received, on order, given out, available. */
  async summary(search?: string) {
    const items = new Map<string, { key: string; item: string; category: string; received: number; onOrder: number; givenOut: number; available: number; lastIn: Date | null; lastOut: Date | null }>();
    for (const p of await this.bought()) {
      const key = itemKey(p.item);
      const row = items.get(key) ?? { key, item: p.item.trim(), category: "", received: 0, onOrder: 0, givenOut: 0, available: 0, lastIn: null, lastOut: null };
      // Latest spelling wins, so a corrected name shows as corrected.
      row.item = p.item.trim();
      if (p.category) row.category = p.category;
      if (p.status === "received") {
        row.received += p.quantity;
        const at = arrivedAt(p);
        if (!row.lastIn || at > row.lastIn) row.lastIn = at;
      } else {
        row.onOrder += p.quantity;
      }
      items.set(key, row);
    }

    const out = await ProcurementIssue.aggregate<{ _id: string; total: number; last: Date }>([
      { $match: orgMatch() },
      { $group: { _id: "$itemKey", total: { $sum: "$quantity" }, last: { $max: "$date" } } },
    ]);
    for (const o of out) {
      const row = items.get(o._id);
      if (!row) continue;
      row.givenOut = o.total;
      row.lastOut = o.last;
    }

    const needle = search?.trim().toLowerCase();
    return [...items.values()]
      .map((r) => ({ ...r, available: Math.max(0, r.received - r.givenOut) }))
      .filter((r) => !needle || r.key.includes(needle) || r.category.toLowerCase().includes(needle))
      .sort((a, b) => a.item.localeCompare(b.item));
  }

  /** Every movement of one item, oldest first, with what was left after each. */
  async movements(key: string) {
    const [bought, issues] = await Promise.all([
      this.bought(key),
      ProcurementIssue.find({ ...orgFilter(), itemKey: key })
        .populate([{ path: "employee", select: "name employeeId" }, { path: "department", select: "name" }, { path: "by", select: "name" }])
        .lean(),
    ]);
    if (!bought.length && !issues.length) throw Object.assign(new Error("No such item in procurement"), { statusCode: 404 });

    type Entry = {
      kind: "received" | "on_order" | "given_out"; date: Date; quantity: number; balance: number | null;
      id: string; who?: string; department?: string; note?: string; by?: string; vendor?: string;
    };
    const entries: Entry[] = [
      ...bought.map((p): Entry => ({
        kind: p.status === "received" ? "received" : "on_order",
        date: arrivedAt(p), quantity: p.quantity, balance: null, id: String(p._id),
        vendor: p.vendor || undefined, department: p.department?.name,
      })),
      ...issues.map((i): Entry => {
        const emp = i.employee as { name?: string; employeeId?: string } | null;
        return {
          kind: "given_out", date: i.date, quantity: i.quantity, balance: null, id: String(i._id),
          who: emp?.name, department: (i.department as { name?: string } | null)?.name,
          note: i.note || undefined, by: (i.by as { name?: string } | null)?.name,
        };
      }),
    ].sort((a, b) => +new Date(a.date) - +new Date(b.date) || (a.kind === "given_out" ? 1 : -1));

    let balance = 0;
    for (const e of entries) {
      if (e.kind === "received") balance += e.quantity;
      else if (e.kind === "given_out") balance -= e.quantity;
      // On order moves nothing — the balance column is left blank for it.
      if (e.kind !== "on_order") e.balance = balance;
    }
    const row = (await this.summary()).find((r) => r.key === key);
    return { item: row?.item ?? bought.at(-1)?.item ?? issues.at(-1)?.item ?? key, key, totals: row ?? null, entries };
  }

  /** Hand some out — never more than is on the shelf. */
  async giveOut(input: GiveOutInput, by: string) {
    const key = itemKey(input.item);
    const row = (await this.summary()).find((r) => r.key === key);
    if (!row) throw Object.assign(new Error("Nothing by that name has been received"), { statusCode: 404 });
    if (input.quantity > row.available) {
      throw Object.assign(new Error(`Only ${row.available} ${row.item} left to give out`), { statusCode: 409 });
    }
    if (input.employee && !(await Employee.exists(scoped({ _id: input.employee })))) {
      throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    }
    if (input.department && !(await Department.exists(scoped({ _id: input.department })))) {
      throw Object.assign(new Error("Department not found"), { statusCode: 404 });
    }
    const today = new Date().toISOString().slice(0, 10);
    const date = input.date && input.date <= today ? input.date : today;
    const issue = await ProcurementIssue.create({
      organization: getOrgId(),
      item: row.item,
      itemKey: key,
      quantity: input.quantity,
      employee: input.employee || null,
      department: input.department || null,
      date: new Date(`${date}T12:00:00.000Z`),
      note: (input.note ?? "").trim(),
      by,
    });
    return { id: String(issue._id), item: row.item, given: input.quantity, available: row.available - input.quantity };
  }

  /** Take back an entry made in error — the stock goes back on the shelf. */
  async removeGiveOut(id: string) {
    const issue = await ProcurementIssue.findOne(scoped({ _id: id }));
    if (!issue) throw Object.assign(new Error("Entry not found"), { statusCode: 404 });
    await ProcurementIssue.deleteOne({ _id: issue._id });
    return { message: "Entry removed" };
  }
}

export const procurementLedgerService = new ProcurementLedgerService();
