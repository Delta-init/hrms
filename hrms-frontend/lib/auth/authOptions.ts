import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { AuthUser, ApiResponse, LoginResponse } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";

export interface ImpersonatedBy {
  id: string;
  name: string;
  restoreTicket: string;
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
         console.log(json,`${API_URL}/auth/exchange`)
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
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as {
          appUser: AuthUser;
          accessToken: string;
          refreshToken: string;
          impersonatedBy: ImpersonatedBy | null;
        };
        token.accessToken = u.accessToken;
        token.refreshToken = u.refreshToken;
        token.appUser = u.appUser;
        // Set/clear impersonation on every (re)auth so restore wipes it.
        token.impersonatedBy = u.impersonatedBy ?? undefined;
      }
      return token;
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
