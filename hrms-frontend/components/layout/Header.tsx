"use client";
import { LogOut, User, Menu, ChevronRight } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, useLogout } from "@/hooks/useAuth";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { useMyEmployeeProfile } from "@/hooks/useEmployees";
import { useUiStore } from "@/lib/store/uiStore";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { navItems } from "@/components/layout/Sidebar";

export function Header() {
  const { user, isKioskOnly } = useAuth();
  // Own employee record, for the avatar. Absent for accounts with no employee
  // profile, which falls back to initials.
  const { data: me } = useMyEmployeeProfile();
  const logout = useLogout();
  const router = useRouter();
  const { toggleMobileDrawer, toggleSidebarCollapsed } = useUiStore();
  const pathname = usePathname();

  const currentNav = navItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );
  const pageName =
    currentNav?.label ??
    (pathname.split("/")[1]
      ? pathname.split("/")[1].charAt(0).toUpperCase() + pathname.split("/")[1].slice(1)
      : "Dashboard");

  return (
    <header className="flex h-16 shrink-0 scale-[.99] items-center justify-between rounded-2xl border-b border-border/10 px-4 backdrop-blur-sm md:px-5">
      <div className="flex items-center gap-2">
        <button
          onClick={toggleMobileDrawer}
          className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          onClick={toggleSidebarCollapsed}
          className="hidden items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="mx-1 hidden h-5 w-px bg-border md:block" />

        <nav className="hidden items-center gap-1 text-sm md:flex">
          <span className="text-muted-foreground">Home</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <span className="font-semibold text-primary">{pageName}</span>
        </nav>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Neither on the tablet by the door: it is a device, not a person,
            and has nothing to look up and nobody to notify. */}
        {!isKioskOnly && (
          <>
            <GlobalSearch />
            <NotificationBell />
          </>
        )}
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 rounded-full transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <PersonAvatar
                name={user?.name ?? "?"}
                photoUrl={me?.photoUrl}
                className="h-8 w-8"
                fallbackClassName="text-xs font-semibold"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="font-medium">{user?.name}</p>
              <p className="mt-0.5 text-xs font-normal text-muted-foreground">{user?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onClick={() => router.push("/profile")}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:text-destructive"
              onClick={() => logout()}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
