// The Super Admin's currently-selected organization (the org switcher).
// Persisted in localStorage and sent as X-Org-Id on every API request.
const KEY = "hrms_active_org";

export function getActiveOrg(): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setActiveOrg(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
