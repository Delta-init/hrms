// The Super Admin's currently-selected organization (the org switcher).
// Persisted in localStorage and sent as X-Org-Id on every API request.
//
// Stored against the user who chose it. Logging out used to clear it outright,
// so every sign-in dropped a Super Admin back onto whichever organization
// happened to sort first and they had to switch again each time. Remembering it
// per user keeps the choice across sessions without handing it to whoever signs
// in next on the same browser.
const KEY = "hrms_active_org";

interface Stored {
  userId: string | null;
  orgId: string;
}

function read(): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    // Entries written before this was keyed by user are plain org ids.
    if (!raw.startsWith("{")) return { userId: null, orgId: raw };
    const parsed = JSON.parse(raw) as Stored;
    return parsed?.orgId ? parsed : null;
  } catch {
    return null;
  }
}

/** The selected org id, whoever chose it. Used by the request interceptor,
 *  which has no session context — the backend ignores the header for anyone
 *  who isn't a Super Admin regardless. */
export function getActiveOrg(): string | null {
  return read()?.orgId ?? null;
}

/** The selection belonging to `userId`, or null if it was somebody else's. */
export function getActiveOrgFor(userId: string | null | undefined): string | null {
  const stored = read();
  if (!stored) return null;
  // A legacy entry has no owner; adopt it rather than discarding the choice.
  if (stored.userId && stored.userId !== userId) return null;
  return stored.orgId;
}

export function setActiveOrg(id: string | null, userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(KEY, JSON.stringify({ userId: userId ?? read()?.userId ?? null, orgId: id }));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
