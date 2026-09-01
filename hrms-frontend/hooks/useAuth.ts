"use client";
import { useSession, signIn, signOut } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import api, { beginAuthTransition, endAuthTransition } from "@/lib/axios";
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
    // Held open for the whole sign-out: from here every 401 is this session
    // being taken away on purpose, and must not start a second sign-out of its
    // own. Never released — signOut leaves the page.
    beginAuthTransition();
    // Nothing new should be asked for on the way out, and anything already
    // asked for is about to be answered 401 by a revoked token.
    await queryClient.cancelQueries();
    // Retire the Express tokens as well. NextAuth only drops its own cookie,
    // so without this the access and refresh tokens issued to this browser
    // stayed valid for their full lifetime after the person had signed out.
    try {
      await api.post("/auth/logout");
    } catch {
      // Best effort: an unreachable API must not trap somebody in the app.
    }
    // The org selection is deliberately left in place — it is stored against
    // this user and restored when they sign back in. Signing in as anyone else
    // ignores it, so nothing carries across between people.
    toast.success("Logged out successfully");
    // A full document navigation, so the query cache goes with the page and
    // clearing it here would only start a refetch of everything we are leaving.
    try {
      await signOut({ callbackUrl: "/login" });
    } catch (e) {
      // The page is staying, so the 401 handler has to come back with it —
      // otherwise a sign-out that failed would also disable the thing that
      // notices the session is gone.
      endAuthTransition();
      throw e;
    }
  }, [queryClient]);
}

/**
 * Exchange one session for another without the page noticing.
 *
 * The cookie is replaced while the current screen still has queries running,
 * and each of those answers 401 against the session being replaced. Left
 * alone they read as an expired session and sign the person out — which is how
 * "exit impersonation" ended at the login page rather than back on the admin
 * account, taking the one-use restore ticket with it and leaving no second
 * attempt. So: stop the queries, hold the 401 handler off for the swap, and
 * only drop the cache once the new session is the one in place.
 */
async function swapSession(
  qc: ReturnType<typeof useQueryClient>,
  exchange: () => Promise<{ error?: string | null } | undefined>
) {
  beginAuthTransition();
  try {
    await qc.cancelQueries();
    const r = await exchange();
    if (r?.error) throw new Error(r.error);
    qc.clear();
  } finally {
    endAuthTransition();
  }
}

/** Admin: start impersonating a user (by their login-account id). */
export function useImpersonate() {
  const router = useRouter();
  const qc = useQueryClient();
  return useCallback(async (userId: string) => {
    const res = await api.post<{ data: { ticket: string } }>(`/users/${userId}/impersonate`);
    const ticket = res.data.data.ticket;
    await swapSession(qc, () => signIn("impersonate", { ticket, redirect: false }));
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
    await swapSession(qc, () => signIn("impersonate", { ticket: restoreTicket, redirect: false }));
    toast.success("Back to your account");
    router.push("/dashboard");
    router.refresh();
  }, [session, router, qc]);
}
