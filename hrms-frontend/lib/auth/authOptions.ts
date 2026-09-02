import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { AuthUser, ApiResponse, LoginResponse, PermissionsMap, HrmsModule, ModulePermissions } from "@/types";
import { PERMISSION_ACTIONS } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";

/**
 * The session cookie is size-limited (~4KB, after which NextAuth splits it into
 * chunks — and a half-written chunk set is indistinguishable from being signed
 * out, which made the first login attempt bounce back to /login). Spelling out
 * every action of every module cost ~2.8KB on its own, so the permission map is
 * packed to one small integer per module for storage in the JWT and expanded
 * again in the session callback. Callers never see the packed form.
 */
export type PackedPermissions = Partial<Record<HrmsModule, number>>;

/** What actually lives in the JWT: the role, minus its expanded permission map. */
export type PackedAuthUser = Omit<AuthUser, "role"> & {
  role: Omit<AuthUser["role"], "permissions"> & { packedPermissions: PackedPermissions };
};

function packPermissions(perms: PermissionsMap | undefined): PackedPermissions {
  const packed: PackedPermissions = {};
  for (const [mod, actions] of Object.entries(perms ?? {})) {
    let mask = 0;
    PERMISSION_ACTIONS.forEach((action, i) => {
      if (actions?.[action]) mask |= 1 << i;
    });
    // Modules with nothing granted are omitted entirely.
    if (mask) packed[mod as HrmsModule] = mask;
  }
  return packed;
}

function unpackPermissions(packed: PackedPermissions | undefined): PermissionsMap {
  const perms: PermissionsMap = {};
  for (const [mod, mask] of Object.entries(packed ?? {})) {
    const actions = {} as ModulePermissions;
    PERMISSION_ACTIONS.forEach((action, i) => {
      actions[action] = (((mask as number) >> i) & 1) === 1;
    });
    perms[mod as HrmsModule] = actions;
  }
  return perms;
}

/** Strip the role's permission map down to its packed form for JWT storage. */
function packAppUser(u: AuthUser): PackedAuthUser {
  const { permissions, ...role } = u.role;
  return { ...u, role: { ...role, packedPermissions: packPermissions(permissions) } };
}

/** Restore the full permission map so `hasPermission` works unchanged. */
function unpackAppUser(u: PackedAuthUser | undefined): AuthUser | undefined {
  if (!u?.role) return u as AuthUser | undefined;
  const { packedPermissions, ...role } = u.role;
  return { ...u, role: { ...role, permissions: unpackPermissions(packedPermissions) } };
}

export interface ImpersonatedBy {
  id: string;
  name: string;
  restoreTicket: string;
}

/** Millisecond expiry from a JWT's `exp` claim (unverified decode). */
function jwtExpiryMs(t?: string): number {
  try {
    const part = (t ?? "").split(".")[1];
    if (!part) return 0;
    const payload = JSON.parse(Buffer.from(part, "base64").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Rotate the access token using the stored refresh token. */
async function refreshAccessToken(token: import("next-auth/jwt").JWT): Promise<import("next-auth/jwt").JWT> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: token.refreshToken }),
    });
    const json = (await res.json()) as ApiResponse<{ accessToken: string; refreshToken: string }>;
    if (!res.ok || !json.success || !json.data) throw new Error(json.message ?? "refresh failed");
    return {
      ...token,
      accessToken: json.data.accessToken,
      refreshToken: json.data.refreshToken ?? token.refreshToken,
      accessTokenExpires: jwtExpiryMs(json.data.accessToken),
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

/**
 * Auth model: Express verifies credentials + issues the JWT; NextAuth owns the
 * browser session. Two providers:
 *  - `credentials` — normal email/password sign-in.
 *  - `impersonate` — exchanges a ticket (impersonate or restore) for a session.
 */
export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const res = await fetch(`${API_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: credentials.email, password: credentials.password }),
        });
        const json = (await res.json()) as ApiResponse<LoginResponse>;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.message ?? "Invalid email or password");
        }
        const { user, accessToken, refreshToken } = json.data;
        return {
          id: user._id, name: user.name, email: user.email,
          appUser: user, accessToken, refreshToken, impersonatedBy: null,
        } as unknown as import("next-auth").User;
      },
    }),

    // Ticket exchange — impersonate a user, or restore the admin session.
    CredentialsProvider({
      id: "impersonate",
      name: "impersonate",
      credentials: { ticket: { label: "Ticket", type: "text" } },
      async authorize(credentials) {
        if (!credentials?.ticket) return null;
        const res = await fetch(`${API_URL}/auth/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket: credentials.ticket }),
        });
       
        const json = (await res.json()) as ApiResponse<
          LoginResponse & { impersonatedBy?: ImpersonatedBy }
        >;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.message ?? "Session exchange failed");
        }
        const { user, accessToken, refreshToken, impersonatedBy } = json.data;
        return {
          id: user._id, name: user.name, email: user.email,
          appUser: user, accessToken, refreshToken,
          impersonatedBy: impersonatedBy ?? null,
        } as unknown as import("next-auth").User;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        const u = user as unknown as {
          appUser: AuthUser;
          accessToken: string;
          refreshToken: string;
          impersonatedBy: ImpersonatedBy | null;
        };
        token.accessToken = u.accessToken;
        token.refreshToken = u.refreshToken;
        token.accessTokenExpires = jwtExpiryMs(u.accessToken);
        token.appUser = packAppUser(u.appUser);
        // Set/clear impersonation on every (re)auth so restore wipes it.
        token.impersonatedBy = u.impersonatedBy ?? undefined;
        token.error = undefined;
        return token;
      }
      // Session update (e.g. after onboarding) — patch the cached appUser so the
      // gate stops redirecting without a full re-login.
      if (trigger === "update" && session?.appUser && token.appUser) {
        // Only scalar fields are patched this way (profileCompleted), so the
        // packed role survives untouched.
        token.appUser = { ...token.appUser, ...(session.appUser as Partial<PackedAuthUser>) };
        return token;
      }
      // Access token still valid (60s buffer) → reuse; else rotate via refresh token.
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires - 60_000) {
        return token;
      }
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      /**
       * Carried out to the browser deliberately.
       *
       * A refresh that fails leaves the old access token in place and only sets
       * this — so a session whose refresh token has expired or been revoked
       * still answers with a token and looks alive. Anything asking "is this
       * session still good?" was reading the token and being told yes, which is
       * how somebody ended up watching "session expired" over and over without
       * ever being signed out.
       */
      session.error = token.error as string | undefined;
      session.impersonatedBy = token.impersonatedBy as ImpersonatedBy | undefined;
      session.user = {
        ...(session.user ?? {}),
        // Expanded back out here — only the cookie needs to stay small, so
        // consumers keep seeing the ordinary permission map.
        ...unpackAppUser(token.appUser),
      } as typeof session.user;
      return session;
    },
  },
};
