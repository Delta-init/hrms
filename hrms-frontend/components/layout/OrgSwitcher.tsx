"use client";
import { useEffect } from "react";
import { Building, Check, ChevronsUpDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllOrganizations } from "@/hooks/useOrganizations";
import { getActiveOrg, getActiveOrgFor, setActiveOrg } from "@/lib/activeOrg";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { OrganizationSimple } from "@/types";

export function OrgSwitcher() {
  const { user } = useAuth();
  const isSuperAdmin = !!(user?.role?.isSystemRole && user.role.roleName === "Super Admin");
  const { data: orgs = [] } = useAllOrganizations(isSuperAdmin);

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

  return (
    <div className="mx-2 mb-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/60">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Building className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{active?.name ?? "Select org"}</p>
              <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{active?.code ?? "—"}</p>
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
