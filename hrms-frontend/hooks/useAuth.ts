"use client";
import { useSession, signIn, signOut } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import api from "@/lib/axios";
import { toast } from "@/lib/toast";
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

  return {
    user,
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    hasPermission,
  };
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
