"use client";
import { useSession, signIn, signOut } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import api from "@/lib/axios";
import { toast } from "@/lib/toast";
import { HRMS_MODULES } from "@/types";
import type { AuthUser, HrmsModule, PermissionAction } from "@/types";

/**
 * Thin wrapper over the NextAuth session. Exposes the app user, a permission
 * helper (mirrors the backend RBAC), and login/logout actions.
 */
export function useAuth() {
  const { data: session, status } = useSession();
  const user = session?.user as AuthUser | undefined;

  const hasPermission = useCallback(
    (module: HrmsModule, action: PermissionAction = "view"): boolean => {
      const role = user?.role;
      if (!role) return false;
      if (role.isSystemRole && role.roleName === "Super Admin") return true;
      const perms = role.permissions?.[module];
      return !!perms?.[action];
    },
    [user]
  );

  /**
   * An account that exists only to run the check-in tablet.
   *
   * Read from the permissions rather than the role's name, so renaming the role
   * or adding a second one cannot quietly turn a locked-down tablet into a
   * general login. The moment such an account is granted anything besides the
   * kiosk it stops being one, which is the behaviour you want: the lockdown
   * follows what the account can actually do.
   */
  const isKioskOnly = useMemo(() => isKioskOnlyRole(user?.role), [user]);

  return {
    user,
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    hasPermission,
    isKioskOnly,
    /** Where this account belongs when it has nowhere in particular to go. */
    homePath: homePathFor(user?.role),
  };
}

/**
 * The rule itself, outside React so the sign-in form can apply it to a session
 * it has only just fetched — at the moment of login the hook's session is still
 * empty, and asking it would send a tablet to the dashboard first.
 */
export function isKioskOnlyRole(role: AuthUser["role"] | undefined | null): boolean {
  if (!role || role.isSystemRole) return false;
  const perms = (role.permissions ?? {}) as Record<string, Record<string, unknown> | undefined>;
  // Only real modules count. The stored permissions object is a Mongoose
  // subdocument and carries an `_id` of its own; if that ever survives
  // serialisation, counting it as a granted module would make this false and
  // quietly unlock the tablet. A lock that fails open is not a lock.
  const granted = HRMS_MODULES.filter((mod) => {
    const actions = perms[mod];
    return !!actions && Object.values(actions).some(Boolean);
  });
  return granted.length === 1 && granted[0] === "kiosk";
}

/** Where an account belongs when it has nowhere in particular to go. */
export function homePathFor(role: AuthUser["role"] | undefined | null): string {
  return isKioskOnlyRole(role) ? "/kiosk" : "/dashboard";
}

export function useLogin() {
  return useCallback(async (email: string, password: string) => {
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (res?.error) {
      throw new Error(res.error);
    }
    return res;
  }, []);
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    queryClient.clear();
    // The org selection is deliberately left in place — it is stored against
    // this user and restored when they sign back in. Signing in as anyone else
    // ignores it, so nothing carries across between people.
    toast.success("Logged out successfully");
    await signOut({ callbackUrl: "/login" });
  }, [queryClient]);
}

/** Admin: start impersonating a user (by their login-account id). */
export function useImpersonate() {
  const router = useRouter();
  const qc = useQueryClient();
  return useCallback(async (userId: string) => {
    const res = await api.post<{ data: { ticket: string } }>(`/users/${userId}/impersonate`);
    const ticket = res.data.data.ticket;
    const r = await signIn("impersonate", { ticket, redirect: false });
    if (r?.error) throw new Error(r.error);
    qc.clear();
    toast.success("Now viewing as this user");
    router.push("/dashboard");
    router.refresh();
  }, [router, qc]);
}

/** Exit impersonation — restores the admin session seamlessly. */
export function useExitImpersonation() {
  const { data: session } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  return useCallback(async () => {
    const restoreTicket = session?.impersonatedBy?.restoreTicket;
    if (!restoreTicket) return;
    const r = await signIn("impersonate", { ticket: restoreTicket, redirect: false });
    if (r?.error) throw new Error(r.error);
    qc.clear();
    toast.success("Back to your account");
    router.push("/dashboard");
    router.refresh();
  }, [session, router, qc]);
}
