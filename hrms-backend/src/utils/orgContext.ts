import { AsyncLocalStorage } from "node:async_hooks";

interface OrgStore {
  orgId: string | null;
  isSuperAdmin: boolean;
}

const storage = new AsyncLocalStorage<OrgStore>();

/** Run a request handler chain with the resolved org context. */
export function runWithOrg(store: OrgStore, fn: () => void) {
  storage.run(store, fn);
}

/** The active organization id for the current request (null = unscoped). */
export function getOrgId(): string | null {
  return storage.getStore()?.orgId ?? null;
}

export function isSuperAdmin(): boolean {
  return storage.getStore()?.isSuperAdmin ?? false;
}

/** A Mongo filter fragment that scopes a query to the active org. */
export function orgFilter(): Record<string, unknown> {
  const orgId = getOrgId();
  return orgId ? { organization: orgId } : {};
}

/** Merge the org scope into an existing filter. */
export function scoped<T extends Record<string, unknown>>(filter: T): T {
  return { ...filter, ...orgFilter() } as T;
}

/** Stamp a document being created with the active org. */
export function withOrg<T extends Record<string, unknown>>(doc: T): T & { organization: string | null } {
  return { ...doc, organization: getOrgId() };
}
