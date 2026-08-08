"use client";
import { useSession } from "next-auth/react";
import { useAllOrganizations } from "@/hooks/useOrganizations";
import { getActiveOrg } from "@/lib/activeOrg";
import type { AuthUser } from "@/types";

/**
 * The organization's timezone — what "today" means for this tenant.
 *
 * Attendance days are filed against the organization's calendar and the server
 * reads date filters as local days in that same zone, so a viewer sitting in a
 * different country still has to ask for the organization's day.
 *
 * A Super Admin belongs to no organization and works through the switcher, so
 * the zone comes from whichever one is selected. Everyone else carries theirs
 * on the session.
 */
export function useOrgTimeZone(): string {
  const { data: session } = useSession();
  const user = session?.user as AuthUser | undefined;
  const isSuperAdmin = !!(user?.role?.isSystemRole && user.role.roleName === "Super Admin");

  // Already in cache for a Super Admin — the switcher loads it on every page.
  const { data: orgs } = useAllOrganizations(isSuperAdmin);
  if (isSuperAdmin) {
    const activeId = getActiveOrg();
    const selected = orgs?.find((o) => o._id === activeId);
    if (selected?.settings?.timeZone) return selected.settings.timeZone;
  }

  const own = user?.organization;
  if (own && typeof own === "object" && own.settings?.timeZone) return own.settings.timeZone;

  // Resolves to UTC during SSR, then to the real zone once hydrated.
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
