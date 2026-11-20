import { DgoAuditEntry } from "../../models/DgoAuditEntry.js";
import type { DgoViewer } from "./dgoAccess.js";

/** Plain JSON of whatever was changed, so the audit row never holds a live document. */
const plain = (v: unknown): unknown => (v == null ? null : JSON.parse(JSON.stringify(v)));

/**
 * Write one audit row. Unlike a notification this is not best-effort: the row is
 * part of the change, so a failure here reaches the caller.
 */
export async function dgoAudit(
  v: Pick<DgoViewer, "orgId" | "userId" | "name">,
  action: string,
  entity: string,
  entityId: unknown,
  before: unknown,
  after: unknown
): Promise<void> {
  await DgoAuditEntry.create({
    organization: v.orgId,
    actor: v.userId,
    actorName: v.name,
    action,
    entity,
    entityId: entityId == null ? null : String(entityId),
    before: plain(before),
    after: plain(after),
  });
}
