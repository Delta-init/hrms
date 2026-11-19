import { Resignation } from "../models/Resignation.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { env, type CrmLink } from "../config/env.js";
import { scoped } from "../utils/orgContext.js";
import { crmCall, CrmError } from "../utils/crmHandoverClient.js";
import type { IResignationCrmHandover } from "../types/index.js";

/*
 * A leaver's CRM handover at final settlement (the user, 2026-11-19: "when an employee resigns, his leads … need to
 * transfer to a person or split", and their CRM login turned off first). For each CRM in CRM_HANDOVER_LINKS:
 *
 *   look      what they hold there, found by their email — work email first, then their login's
 *   hand over HR picks one person or several (split evenly, or by counts); the CRM turns their login off and moves
 *             their open leads with its own Transfer leads — closed and lost stay theirs, so commission doesn't move
 *   outside   when the CRM can't be reached, or it was dealt with there, HR notes it was handled outside HRMS and why
 *
 * Finalising the settlement waits until every CRM is clear: no account there, or no open leads and the login off,
 * or noted as handled outside. With no CRMs configured there is no step.
 */

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const links = (): CrmLink[] => env.CRM_HANDOVER_LINKS;
const linkFor = (key: string) => {
  const l = links().find((x) => x.key === key);
  if (!l) throw fail("No such CRM", 404);
  return l;
};

export interface HandoverTarget { userId: string; count?: number | null }
interface CrmPerson { id: string; name: string; email: string; status: string }
interface CrmSummary {
  found: boolean;
  user?: CrmPerson;
  open?: number;
  closed?: number;
  lost?: number;
  loginOff?: boolean;
  candidates?: Array<{ id: string; name: string; email: string; team: string | null }>;
}
interface CrmHandoverResult {
  user: CrmPerson;
  open: number;
  loginOff: boolean;
  transfer: { id: string; moved: number; targets: Array<{ name: string; count: number }> } | null;
}

/** One CRM, as the settlement's handover card shows it. */
export interface CrmSystemStatus {
  key: string;
  name: string;
  outside: { reason: string; byName: string; at: Date | null } | null;
  log: IResignationCrmHandover[];
  reachable: boolean;
  found: boolean;
  ready: boolean;
  error?: string;
  user?: CrmPerson;
  open?: number;
  closed?: number;
  lost?: number;
  loginOff?: boolean;
  candidates?: Array<{ id: string; name: string; email: string; team: string | null }>;
}

async function loadResignation(id: string) {
  const r = await Resignation.findOne(scoped({ _id: id }));
  if (!r) throw fail("Resignation not found", 404);
  return r;
}

/** The emails to find them by in a CRM: their work email, then the one they log in to HRMS with. */
async function emailsFor(r: { employee: unknown; user?: unknown }) {
  const emp = await Employee.findOne(scoped({ _id: r.employee })).select("name email user").lean<{ name: string; email?: string; user?: unknown } | null>();
  const userId = emp?.user ?? r.user;
  const user = userId ? await User.findById(userId).select("email").lean<{ email?: string } | null>() : null;
  const emails = [emp?.email, user?.email].map((e) => (e ?? "").trim().toLowerCase()).filter(Boolean);
  return { name: emp?.name ?? "", emails: [...new Set(emails)] };
}

/** HR's latest word on a CRM being handled outside HRMS, if it still stands. */
function outsideNote(log: IResignationCrmHandover[]) {
  const last = [...log].reverse().find((e) => e.action === "handled_outside" || e.action === "outside_cleared");
  return last?.action === "handled_outside" ? { reason: last.reason ?? "", byName: last.byName ?? "", at: last.at ?? null } : null;
}

/** Each CRM: what they hold there and whether it is clear for the settlement. */
export async function handoverStatus(resignationId: string) {
  const r = await loadResignation(resignationId);
  const { name, emails } = await emailsFor(r);
  const log = (r.crmHandover ?? []) as IResignationCrmHandover[];

  const systems = await Promise.all(links().map(async (link): Promise<CrmSystemStatus> => {
    const mine = log.filter((e) => e.crm === link.key);
    const outside = outsideNote(mine);
    const base = { key: link.key, name: link.name, outside, log: mine };
    if (!emails.length) {
      return { ...base, reachable: true, found: false, ready: !!outside, error: "No email on their record to find them by" };
    }
    try {
      const s = await crmCall<CrmSummary>(link, "GET", "/handover", { query: new URLSearchParams(emails.map((e) => ["email", e])) });
      if (!s.found) return { ...base, reachable: true, found: false, ready: true };
      const open = s.open ?? 0;
      const loginOff = !!s.loginOff;
      return {
        ...base, reachable: true, found: true,
        user: s.user, open, closed: s.closed ?? 0, lost: s.lost ?? 0, loginOff,
        candidates: s.candidates ?? [],
        ready: (open === 0 && loginOff) || !!outside,
      };
    } catch (e) {
      return { ...base, reachable: false, found: false, ready: !!outside, error: e instanceof Error ? e.message : String(e) };
    }
  }));

  return {
    employee: { name, emails },
    configured: links().length > 0,
    systems,
    ready: systems.every((s) => s.ready),
    settled: !!r.settlement?.settled,
  };
}

/** Why the settlement can't be finalised yet — one line per CRM that isn't clear. Nothing when all are. */
export async function handoverBlockers(resignationId: string): Promise<string[]> {
  if (!links().length) return [];
  const st = await handoverStatus(resignationId);
  const who = st.employee.name || "They";
  return st.systems.filter((s) => !s.ready).map((s) => {
    if (!s.reachable) return `${s.name}: ${s.error} — try again, or mark it handled outside HRMS`;
    if (!s.found) return `${s.name}: ${s.error ?? "not checked"}`;
    const open = s.open ?? 0;
    const loginOff = s.loginOff;
    if (open > 0) return `${s.name}: ${who} still ${open === 1 ? "has 1 open lead" : `has ${open} open leads`} — hand them over first`;
    if (!loginOff) return `${s.name}: ${who}'s login is still on — hand over to turn it off`;
    return `${s.name}: not clear yet`;
  });
}

/** What a split would give each person there — nothing moves. */
export async function previewHandover(resignationId: string, crm: string, targets: HandoverTarget[]) {
  const link = linkFor(crm);
  const r = await loadResignation(resignationId);
  const { emails } = await emailsFor(r);
  if (!emails.length) throw fail("There is no email on their record to find them by", 400);
  return crmCall(link, "POST", "/handover/preview", { body: { emails, targets } });
}

/** Turn their login off in the CRM and move their open leads as HR chose. */
export async function handOver(resignationId: string, crm: string, targets: HandoverTarget[], actor: { id: string; name: string; email?: string }) {
  const link = linkFor(crm);
  const r = await loadResignation(resignationId);
  if (r.settlement?.settled) throw fail("The settlement is already finalised", 400);
  if (!["accepted", "relieved"].includes(r.status)) throw fail("Accept the resignation before handing over their CRM work", 400);
  const { emails } = await emailsFor(r);
  if (!emails.length) throw fail("There is no email on their record to find them by", 400);

  // A few hundred leads move one by one there; give it time.
  const done = await crmCall<CrmHandoverResult>(link, "POST", "/handover", {
    body: { emails, targets, by: { name: actor.name, email: actor.email } },
    timeoutMs: 120_000,
  });

  r.crmHandover = [
    ...((r.crmHandover ?? []) as IResignationCrmHandover[]),
    {
      crm: link.key, name: link.name, action: "handed_over",
      crmUser: { name: done.user?.name, email: done.user?.email },
      moved: done.transfer?.moved ?? 0,
      targets: done.transfer?.targets ?? [],
      transferId: done.transfer?.id ?? "",
      openAfter: done.open ?? 0,
      by: actor.id as never, byName: actor.name, at: new Date(),
    },
  ] as never;
  await r.save();
  return handoverStatus(resignationId);
}

/** HR's note that a CRM was dealt with outside HRMS — needed when it can't be reached. */
export async function markOutside(resignationId: string, crm: string, reason: string, actor: { id: string; name: string }) {
  const link = linkFor(crm);
  if (reason.trim().length < 5) throw fail("Say briefly how it was handled", 400);
  const r = await loadResignation(resignationId);
  if (r.settlement?.settled) throw fail("The settlement is already finalised", 400);
  // Only for a CRM HRMS can't do it in — out of reach, or no email to find them by. One that answers is handed over
  // there, so a settlement can't be finalised past leads still sitting with the leaver.
  const now = (await handoverStatus(resignationId)).systems.find((x) => x.key === link.key);
  if (now?.reachable && !now.error) {
    throw fail(now.found ? `${link.name} is reachable — hand over there instead` : `${link.name} has no account for them — nothing to note`, 400);
  }
  r.crmHandover = [
    ...((r.crmHandover ?? []) as IResignationCrmHandover[]),
    { crm: link.key, name: link.name, action: "handled_outside", reason: reason.trim(), by: actor.id as never, byName: actor.name, at: new Date() },
  ] as never;
  await r.save();
  return handoverStatus(resignationId);
}

/** Take that note back. */
export async function clearOutside(resignationId: string, crm: string, actor: { id: string; name: string }) {
  const link = linkFor(crm);
  const r = await loadResignation(resignationId);
  if (r.settlement?.settled) throw fail("The settlement is already finalised", 400);
  if (!outsideNote(((r.crmHandover ?? []) as IResignationCrmHandover[]).filter((e) => e.crm === link.key))) {
    throw fail(`${link.name} isn't marked as handled outside HRMS`, 400);
  }
  r.crmHandover = [
    ...((r.crmHandover ?? []) as IResignationCrmHandover[]),
    { crm: link.key, name: link.name, action: "outside_cleared", by: actor.id as never, byName: actor.name, at: new Date() },
  ] as never;
  await r.save();
  return handoverStatus(resignationId);
}

export { CrmError };
