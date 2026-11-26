import { Types } from "mongoose";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { LeaveAdjustment } from "../models/LeaveAdjustment.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { LeaveBalanceService } from "./leaveBalanceService.js";
import { notify } from "./notificationService.js";

/*
 * HR and the Super Admin edit someone's leave balance (2026-11-26).
 *
 * Balances are worked out, not stored (granted + carried + adjustments − used), so an edit is saved as the
 * difference: one manual adjustment row per person, leave type and year — per month for a monthly type — whose days
 * move by however much the balance has to move. The policy rules keep applying on top. Every edit is kept on that
 * row with who, when, the balance before and after, and why.
 */

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const balances = new LeaveBalanceService();
const round = (n: number) => Math.round(n * 100) / 100;

async function personFor(employeeId: string) {
  const e = await Employee.findOne(scoped({ _id: employeeId })).select("name employeeCode user").lean<{ _id: Types.ObjectId; name: string; employeeCode?: string; user?: Types.ObjectId | null } | null>();
  if (!e) throw fail("Employee not found", 404);
  if (!e.user) throw fail(`${e.name} has no HRMS login, so has no leave balance yet`, 400);
  return e as typeof e & { user: Types.ObjectId };
}

/** Balances that can be edited: this year, and last year for corrections. */
function checkYear(year: number) {
  const now = new Date().getUTCFullYear();
  if (year !== now && year !== now - 1) throw fail("Only this year's and last year's balances can be edited", 400);
}

const sourceFor = (period: string, year: number, month: number | null) => (period === "month" ? `manual:${year}-${String(month).padStart(2, "0")}` : "manual");

/** Someone's balances for a year, with the manual edits made to them. */
export async function balancesForEmployee(employeeId: string, year = new Date().getUTCFullYear()) {
  const e = await personFor(employeeId);
  const [list, edits] = await Promise.all([
    balances.computeBalances(String(e.user), year),
    LeaveAdjustment.find(scoped({ user: e.user, year, source: /^manual/ })).select("type month history").lean(),
  ]);
  type Edit = { at?: Date | null; byName?: string | null; from?: number | null; to?: number | null; delta?: number | null; reason?: string | null };
  const history = edits.flatMap((a) => ((a.history ?? []) as unknown as Edit[]).map((h) => ({ ...h, type: a.type, month: a.month ?? null })))
    .sort((x, y) => new Date(y.at ?? 0).getTime() - new Date(x.at ?? 0).getTime());
  return { employee: { _id: e._id, name: e.name, employeeCode: e.employeeCode }, year, balances: list, history };
}

export interface AdjustInput { type: string; year: number; mode: "set" | "add"; days: number; reason: string }

export async function adjustBalance(employeeId: string, input: AdjustInput, actor: { userId: string; isSuperAdmin: boolean }) {
  const e = await personFor(employeeId);
  if (String(e.user) === actor.userId && !actor.isSuperAdmin) throw fail("You can't edit your own leave balance — ask someone else in HR", 403);
  checkYear(input.year);

  const current = (await balances.computeBalances(String(e.user), input.year)).find((b) => b.type === input.type);
  if (!current) throw fail("They have no balance for that leave type", 400);
  const nowYear = new Date().getUTCFullYear();
  if (current.period === "month" && input.year !== nowYear) throw fail("A monthly leave type can only be edited for the month in progress", 400);
  const month = current.period === "month" ? new Date().getUTCMonth() + 1 : null;

  const from = current.balance;
  const to = round(input.mode === "set" ? input.days : from + input.days);
  const delta = round(to - from);
  if (delta === 0) throw fail(`It's already ${from} days`, 400);

  const actorUser = await User.findById(actor.userId).select("name").lean<{ name?: string } | null>();
  const byName = String(actorUser?.name ?? "");
  const entry = { at: new Date(), by: new Types.ObjectId(actor.userId), byName, from, to, delta, reason: input.reason };
  await LeaveAdjustment.updateOne(
    scoped({ user: e.user, type: input.type, year: input.year, source: sourceFor(current.period, input.year, month) }),
    {
      $inc: { days: delta },
      $push: { history: entry },
      $set: { reason: input.reason, createdBy: new Types.ObjectId(actor.userId), month },
      $setOnInsert: { organization: getOrgId() },
    },
    { upsert: true },
  );

  const after = (await balances.computeBalances(String(e.user), input.year)).find((b) => b.type === input.type);
  await notify({
    users: [e.user],
    kind: "leave",
    tone: delta > 0 ? "positive" : "neutral",
    title: `Your ${current.label} balance changed: ${from} → ${after?.balance ?? to} days`,
    body: input.reason,
    href: "/leave",
    actor: actor.userId,
  });
  return { from, to: after?.balance ?? to, delta, ...(await balancesForEmployee(employeeId, input.year)) };
}
