"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Users, Building2, Package, Megaphone, LifeBuoy, CornerDownLeft, Loader2 } from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { navItems } from "@/components/layout/Sidebar";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/types";

/**
 * One box for the whole application: the pages and the things in them.
 *
 * Searching only the menu can find a page somebody already knows the name of,
 * which is the case where they did not need a search box. What people type is
 * the thing itself — a colleague's name, an asset tag, half a ticket subject —
 * so both are answered here, with pages first because they resolve instantly
 * and data results arrive a moment later.
 *
 * Pages are filtered by the same permissions the sidebar uses, so the box never
 * offers a route that would refuse the person who picked it. Data results are
 * filtered on the server, per source, for the same reason.
 */

const GROUP_ICON: Record<string, typeof Users> = {
  People: Users,
  Departments: Building2,
  Assets: Package,
  Announcements: Megaphone,
  Helpdesk: LifeBuoy,
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { hasPermission, user, isKioskOnly } = useAuth();
  const debounced = useDebouncedValue(query, 250);
  const { data: hits = [], isFetching } = useGlobalSearch(debounced);

  // ⌘K / Ctrl-K, the shortcut people already try.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const isSuperAdmin = !!user?.role?.isSystemRole && user.role.roleName === "Super Admin";

  /**
   * The pages this person can actually open.
   *
   * The same test the sidebar makes, deliberately — a search result that leads
   * to a page which then refuses you is worse than no result, because it looks
   * like the application is broken rather than like you lack access.
   */
  const pages = useMemo(
    () =>
      navItems.filter(({ permModule, permAction, superAdminOnly, approvalsOnly, href }) => {
        if (isKioskOnly) return href === "/kiosk";
        if (superAdminOnly) return isSuperAdmin;
        // Approvals is decided by the server; the sidebar knows, this does not,
        // so it is offered and the page itself explains if there is nothing.
        if (approvalsOnly) return true;
        return permModule === null ? true : hasPermission(permModule, permAction ?? "view");
      }),
    [hasPermission, isKioskOnly, isSuperAdmin]
  );

  const grouped = useMemo<Array<[string, SearchHit[]]>>(() => {
    const byGroup = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const list = byGroup.get(h.group) ?? [];
      list.push(h);
      byGroup.set(h.group, list);
    }
    return Array.from(byGroup.entries());
  }, [hits]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 py-1.5 pl-2.5 pr-2 text-sm text-muted-foreground transition-colors",
          "hover:border-border hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden lg:inline">Search…</span>
        {/* Only where the shortcut exists to be pressed. */}
        <kbd className="ml-4 hidden rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] lg:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        {/* shouldFilter off: the server has already decided what matches, and
            letting the client filter again would hide results whose match is in
            a field the row does not display. */}
        <CommandInput
          placeholder="Search people, pages, assets…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {query.trim().length < 2
              ? "Type at least two characters."
              : isFetching
                ? "Searching…"
                : "Nothing found."}
          </CommandEmpty>

          <CommandGroup heading="Pages">
            {pages
              .filter((p) => !query.trim() || p.label.toLowerCase().includes(query.trim().toLowerCase()))
              .slice(0, 6)
              .map(({ href, label, icon: Icon }) => (
                <CommandItem key={href} value={`page ${label}`} onSelect={() => go(href)}>
                  <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{label}</span>
                  <CornerDownLeft className="ml-auto h-3 w-3 text-muted-foreground/50" />
                </CommandItem>
              ))}
          </CommandGroup>

          {grouped.map(([group, rows]) => {
            const Icon = GROUP_ICON[group] ?? Search;
            return (
              <CommandGroup key={group} heading={group}>
                {rows.map((h) => (
                  <CommandItem key={`${group}-${h.id}`} value={`${group} ${h.title} ${h.subtitle}`} onSelect={() => go(h.href)}>
                    <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{h.title}</span>
                      {h.subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}

          {/* Said while the pages above are already usable, so the panel never
              looks empty just because the network is slow. */}
          {isFetching && debounced.trim().length >= 2 && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />Searching your data…
            </div>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
