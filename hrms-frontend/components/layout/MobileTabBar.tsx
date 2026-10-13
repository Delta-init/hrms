"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { LayoutDashboard, Sparkles, ClipboardCheck, Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useUiStore } from "@/lib/store/uiStore";
import { usePendingRegularizationCount } from "@/hooks/useRegularizations";
import { cn } from "@/lib/utils";

/**
 * Bottom tab bar on phones — below `md`, where there is no sidebar.
 *
 * A floating pill, the same as the LMS's: the three pages people open most
 * from a phone, and Menu, which opens the drawer holding everything the
 * sidebar does. It sits above the iPhone home indicator; the dashboard layout
 * keeps the same height clear at the bottom of the page.
 *
 * A tab is only drawn for someone who can open its page — the sidebar's own
 * rule — and a kiosk tablet, which only ever shows the kiosk, gets no bar.
 */
export function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const reduce = useReducedMotion();
  const { hasPermission, isKioskOnly } = useAuth();
  const { mobileDrawerOpen, setMobileDrawerOpen } = useUiStore();
  // The same badge the sidebar shows — only for someone who could act on the queue.
  const { data: pendingReg = 0 } = usePendingRegularizationCount(!isKioskOnly && hasPermission("regularization", "view"));

  if (isKioskOnly) return null;

  const links = [
    hasPermission("dashboard", "view") && { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, badge: 0 },
    hasPermission("officeKeeping", "view") && { href: "/office-keeping", label: "Office", icon: Sparkles, badge: 0 },
    { href: "/regularization", label: "Regularize", icon: ClipboardCheck, badge: pendingReg },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: React.ElementType; badge: number }>;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const tab = (active: boolean, Icon: React.ElementType, label: string, badge = 0) => (
    <span className="relative flex h-full w-full flex-col items-center justify-center gap-0.5">
      {active && (
        <motion.span
          layoutId={reduce ? undefined : "tabbar-pill"}
          className="absolute inset-x-0.5 inset-y-1 rounded-[22px] bg-primary/10"
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        />
      )}
      <span className="relative">
        <Icon className={cn("h-[21px] w-[21px]", active ? "text-primary" : "text-muted-foreground")} strokeWidth={active ? 2.4 : 2} />
        {badge > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 420 }}
            className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white ring-2 ring-card"
          >
            {badge > 99 ? "99+" : badge}
          </motion.span>
        )}
      </span>
      <span className={cn("relative text-[10.5px] font-semibold", active ? "text-primary" : "text-muted-foreground")}>{label}</span>
    </span>
  );

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 z-40 flex justify-center px-3 md:hidden"
      style={{ bottom: "calc(10px + env(safe-area-inset-bottom))" }}
    >
      <div className="flex h-16 w-full max-w-[480px] items-stretch rounded-[30px] border border-border bg-card/90 px-1 shadow-[0_10px_30px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
        {links.map(({ href, label, icon, badge }) => {
          const active = isActive(href) && !mobileDrawerOpen;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={badge ? `${label}, ${badge} pending` : label}
              className="flex-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-[22px]"
            >
              {tab(active, icon, label, badge)}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileDrawerOpen(true)}
          aria-label="Menu"
          aria-expanded={mobileDrawerOpen}
          className="flex-1 rounded-[22px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {tab(mobileDrawerOpen, Menu, "Menu")}
        </button>
      </div>
    </nav>
  );
}
