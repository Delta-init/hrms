import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { AuthUser, ApiResponse, LoginResponse } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";

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
        token.appUser = u.appUser;
        // Set/clear impersonation on every (re)auth so restore wipes it.
        token.impersonatedBy = u.impersonatedBy ?? undefined;
        token.error = undefined;
        return token;
      }
      // Session update (e.g. after onboarding) — patch the cached appUser so the
      // gate stops redirecting without a full re-login.
      if (trigger === "update" && session?.appUser) {
        token.appUser = { ...(token.appUser as AuthUser), ...(session.appUser as Partial<AuthUser>) };
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
      session.impersonatedBy = token.impersonatedBy as ImpersonatedBy | undefined;
      session.user = {
        ...(session.user ?? {}),
        ...(token.appUser as AuthUser),
      } as typeof session.user;
      return session;
    },
  },
};
