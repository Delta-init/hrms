"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Shield,
  Sparkles,
  UserRound,
  Building2,
  Network,
  CalendarCheck,
  CalendarClock,
  Wallet,
  Clock,
  ClipboardCheck,
  LogOut,
  Landmark,
  Banknote,
  TrendingUp,
  Receipt,
  Boxes,
  ClipboardList,
  FileText,
  Megaphone,
  ListChecks,
  LifeBuoy,
  FileBarChart,
  GitBranch,
  Settings,
  X,
} from "lucide-react";
import { OrgSwitcher } from "@/components/layout/OrgSwitcher";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/lib/store/uiStore";
import { useAuth } from "@/hooks/useAuth";
import { useMyProfile } from "@/hooks/useOnboarding";
import type { HrmsModule } from "@/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Drawer, DrawerContent } from "@/components/ui/drawer";

export const navItems: {
  href: string;
  label: string;
  icon: React.ElementType;
  permModule: HrmsModule | null;
}[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permModule: "dashboard" },
  { href: "/employees", label: "Employees", icon: UserRound, permModule: "employees" },
  { href: "/departments", label: "Departments", icon: Building2, permModule: "departments" },
  { href: "/org-chart", label: "Org Chart", icon: Network, permModule: "employees" },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck, permModule: "attendance" },
  { href: "/leave", label: "Leave", icon: CalendarClock, permModule: "leave" },
  { href: "/regularization", label: "Regularization", icon: ClipboardCheck, permModule: null },
  // Always reachable: the Payroll page shows admins the full "Payslips" tab
  // (gated by the payroll permission) and every employee their own "My Payslips".
  { href: "/payroll", label: "Payroll", icon: Wallet, permModule: null },
  { href: "/work-schedules", label: "Work Schedules", icon: Clock, permModule: "workSchedules" },
  { href: "/resignations", label: "Resignations", icon: LogOut, permModule: "resignations" },
  { href: "/loans", label: "Loans", icon: Banknote, permModule: "loans" },
  { href: "/salary-increments", label: "Salary Increments", icon: TrendingUp, permModule: "salaryIncrements" },
  // Self-service "My Claims" for everyone; the review/all tabs are gated inside the page.
  { href: "/reimbursements", label: "Reimbursements", icon: Receipt, permModule: null },
  { href: "/assets", label: "Assets", icon: Boxes, permModule: "assets" },
  { href: "/onboarding-tasks", label: "Onboarding Tasks", icon: ClipboardList, permModule: "onboardingTasks" },
  { href: "/letters", label: "Letters", icon: FileText, permModule: "letters" },
  { href: "/announcements", label: "Announcements", icon: Megaphone, permModule: "announcements" },
  // Always reachable: everyone can see/respond to Open Surveys; the Manage tab is gated inside the page.
  { href: "/surveys", label: "Surveys", icon: ListChecks, permModule: null },
  // Always reachable: everyone can raise/track their own tickets; the Manage tab is gated inside the page.
  { href: "/helpdesk", label: "Helpdesk", icon: LifeBuoy, permModule: null },
  { href: "/reports", label: "Reports", icon: FileBarChart, permModule: "reports" },
  { href: "/organizations", label: "Organizations", icon: Landmark, permModule: "organizations" },
  { href: "/users", label: "Users", icon: Users, permModule: "users" },
  { href: "/roles", label: "Roles & Permissions", icon: Shield, permModule: "roles" },
  { href: "/approval-workflows", label: "Approval Workflows", icon: GitBranch, permModule: "approvalWorkflows" },
  { href: "/settings", label: "Settings", icon: Settings, permModule: null },
];

function NavLinks({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { hasPermission } = useAuth();

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
      {navItems.map(({ href, label, icon: Icon, permModule }) => {
        const isActive = pathname === href || pathname.startsWith(href + "/");
        const allowed = permModule === null ? true : hasPermission(permModule, "view");
        if (!allowed) return null;

        const linkEl = (
          <Link
            href={href}
            onClick={() => onNavigate?.()}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
              isActive
                ? "text-sidebar-primary-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            {isActive && (
              <motion.div
                layoutId="nav-active-pill"
                className="absolute inset-0 rounded-lg bg-sidebar-primary shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
              />
            )}
            <span className="relative z-10 shrink-0">
              <Icon className="h-5 w-5" />
            </span>
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="relative z-10 flex-1 whitespace-nowrap overflow-hidden"
                >
                  {label}
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
        );

        return (
          <Tooltip key={href}>
            <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
            {collapsed && <TooltipContent side="right">{label}</TooltipContent>}
          </Tooltip>
        );
      })}
    </nav>
  );
}

function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex h-16 items-center gap-3 border-b border-sidebar-border/10 px-4 shrink-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary">
        <Sparkles className="h-5 w-5 text-primary-foreground" />
      </div>
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <p className="text-sm font-bold text-sidebar-foreground whitespace-nowrap">Delta HRMS</p>
            <p className="text-xs text-muted-foreground whitespace-nowrap">Human Resources</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserProfileSection({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const { data: profile } = useMyProfile();
  const photo = profile?.photoUrl || "";
  const name = user?.name ?? "User";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((p) => p[0]).join("").toUpperCase() || "U";
  const roleName = user?.role?.roleName ?? "User";

  return (
    <div className="border-t border-sidebar-border p-3 shrink-0">
      {collapsed ? (
        <div className="flex justify-center py-1">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={name} className="h-9 w-9 rounded-full object-cover shadow-sm" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-sm">
              {initials}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3">
          <div className="flex items-center gap-3">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={name} className="h-10 w-10 shrink-0 rounded-full object-cover shadow-sm" />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shadow-sm">
                {initials}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">{name}</p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">{roleName}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopSidebar() {
  const { sidebarCollapsed } = useUiStore();
  return (
    <TooltipProvider delayDuration={0}>
      <motion.aside
        animate={{ width: sidebarCollapsed ? 72 : 260 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="relative hidden h-full flex-col overflow-hidden rounded-r-3xl bg-sidebar shadow-[2px_0_30px_rgba(0,0,0,0.12)] dark:shadow-[4px_0_32px_rgba(0,0,0,0.45)] md:flex"
      >
        <Logo collapsed={sidebarCollapsed} />
        {!sidebarCollapsed && (
          <div className="pt-3">
            <OrgSwitcher />
          </div>
        )}
        <NavLinks collapsed={sidebarCollapsed} />
        <UserProfileSection collapsed={sidebarCollapsed} />
      </motion.aside>
    </TooltipProvider>
  );
}

function MobileDrawer() {
  const { mobileDrawerOpen, setMobileDrawerOpen } = useUiStore();
  return (
    <Drawer direction="left" open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
      <DrawerContent
        hideHandle
        className="inset-x-auto inset-y-0 left-0 right-auto mt-0 flex h-full w-72 flex-col rounded-none rounded-r-xl border-l-0 border-r border-sidebar-border bg-sidebar"
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm font-bold text-sidebar-foreground">Delta HRMS</p>
              <p className="text-xs text-muted-foreground">Human Resources</p>
            </div>
          </div>
          <button
            onClick={() => setMobileDrawerOpen(false)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="pt-3">
          <OrgSwitcher />
        </div>
        <TooltipProvider delayDuration={0}>
          <NavLinks onNavigate={() => setMobileDrawerOpen(false)} />
        </TooltipProvider>
        <UserProfileSection />
      </DrawerContent>
    </Drawer>
  );
}

export function Sidebar() {
  return (
    <>
      <DesktopSidebar />
      <MobileDrawer />
    </>
  );
}
