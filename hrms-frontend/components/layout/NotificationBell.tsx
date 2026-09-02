"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, CalendarDays, Clock, ShieldCheck, Megaphone, Wallet, Info } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useNotifications, useUnreadCount, useMarkRead, useMarkAllRead } from "@/hooks/useNotifications";
import { waitingFor } from "@/components/approvals/shared";
import type { AppNotification, NotificationKind } from "@/types";

/**
 * What has happened, for somebody who is in the app rather than in their mail.
 *
 * The same events go out by email, and deliberately still do — most of the day
 * nobody is looking at this. The bell is for the rest of it: a decision that
 * lands while you are working should not need you to open another program.
 *
 * Opening the panel does not mark anything read. Reading a title in a list is
 * not the same as having dealt with it, and a badge that clears itself the
 * moment you glance at it stops meaning anything. Clicking one marks that one;
 * the header clears the lot when the reader says so.
 */

const ICON: Record<NotificationKind, typeof Bell> = {
  leave: CalendarDays,
  regularization: Clock,
  approval: ShieldCheck,
  announcement: Megaphone,
  payroll: Wallet,
  system: Info,
};

const TONE: Record<AppNotification["tone"], string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data: unread = 0 } = useUnreadCount();
  // The list is only worth fetching once somebody opens the panel; the badge
  // above is what runs on every page.
  const { data: rows = [], isLoading } = useNotifications(open);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const openOne = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n._id);
    setOpen(false);
    if (n.href) router.push(n.href);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[min(26rem,60vh)] overflow-y-auto">
          {isLoading ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <Bell className="mx-auto h-6 w-6 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">Nothing yet.</p>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                Decisions on your requests will show up here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((n) => {
                const Icon = ICON[n.kind] ?? Info;
                return (
                  <li key={n._id}>
                    <button
                      type="button"
                      onClick={() => openOne(n)}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/60",
                        !n.readAt && "bg-primary/5"
                      )}
                    >
                      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE[n.tone])} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm leading-snug", !n.readAt && "font-semibold")}>
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.body}</span>
                        )}
                        <span className="mt-1 block text-[11px] text-muted-foreground/70">
                          {waitingFor(n.createdAt)} ago
                        </span>
                      </span>
                      {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {rows.length > 0 && unread === 0 && (
          <div className="flex items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5" />All caught up
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
