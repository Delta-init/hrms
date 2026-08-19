"use client";
import { useEffect } from "react";
import { Building, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllOrganizations } from "@/hooks/useOrganizations";
import { getActiveOrg, getActiveOrgFor, setActiveOrg } from "@/lib/activeOrg";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { OrganizationSimple } from "@/types";

export function OrgSwitcher() {
  const { user } = useAuth();
  const isSuperAdmin = !!(user?.role?.isSystemRole && user.role.roleName === "Super Admin");
  const { data: orgs = [], isLoading, isError } = useAllOrganizations(isSuperAdmin);

  // Restore this user's last organization, falling back to the first one. A
  // selection left by somebody else on the same browser is not adopted.
  useEffect(() => {
    if (!isSuperAdmin || orgs.length === 0) return;
    const mine = getActiveOrgFor(user?._id);
    const target = mine && orgs.some((o) => o._id === mine) ? mine : orgs[0]._id;
    const changed = getActiveOrg() !== target;
    // Always re-stamp: an entry written before this was owned has no user on
    // it, and claiming it here is what makes the next sign-in restore it.
    setActiveOrg(target, user?._id);
    if (changed) window.location.reload();
  }, [isSuperAdmin, orgs, user?._id]);

  const switchTo = (o: OrganizationSimple) => {
    if (getActiveOrg() === o._id) return;
    setActiveOrg(o._id, user?._id);
    window.location.reload();
  };

  // Regular users: read-only chip of their own org.
  if (!isSuperAdmin) {
    const org = user?.organization && typeof user.organization === "object" ? user.organization : null;
    if (!org) return null;
    return (
      <div className="mx-2 mb-2 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building className="h-4 w-4" /></div>
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{org.name}</p><p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{org.code}</p></div>
      </div>
    );
  }

  const active = orgs.find((o) => o._id === getActiveOrg()) ?? orgs[0];

  /**
   * Say the list is loading rather than pretending nothing is selected.
   *
   * "Select org · —" is what this showed for the second or so the request
   * takes, which reads as "you have not picked an organisation" — on a page
   * whose data is already being fetched for whichever one you last used. It
   * looks like something went wrong, and it invites a click that does nothing.
   */
  if (isLoading && !active) {
    return (
      <div className="mx-2 mb-2">
        <div className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-28 animate-pulse rounded bg-muted" />
            <div className="h-2 w-12 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  /**
   * And when the list never arrived, say that instead.
   *
   * Testing the loading state with the API down showed the same "Select org · —"
   * once the request had failed — a control that looks selectable, opens an
   * empty menu, and gives no hint that the problem is the connection rather
   * than the person using it.
   */
  if (!active) {
    return (
      <div className="mx-2 mb-2">
        <div className="flex w-full items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Building className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">No organisations</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {isError ? "Could not load the list" : "None available to you"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-2 mb-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/60">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Building className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{active.name}</p>
              <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{active.code}</p>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Switch organization</p>
          {orgs.map((o) => (
            <DropdownMenuItem key={o._id} onClick={() => switchTo(o)} className="cursor-pointer">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary"><Building className="h-3.5 w-3.5" /></div>
              <span className="ml-2 flex-1 truncate">{o.name}</span>
              {active?._id === o._id && <Check className={cn("h-4 w-4 text-primary")} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
