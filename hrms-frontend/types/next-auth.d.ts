import type { AuthUser } from "@/types";
import type { PackedAuthUser } from "@/lib/auth/authOptions";
import type { DefaultSession } from "next-auth";

interface ImpersonatedBy {
  id: string;
  name: string;
  restoreTicket: string;
}

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    /**
     * Set when the refresh failed, so the browser can tell a live session from
     * a dead one. Without it the session still carries the stale access token
     * and looks perfectly healthy from the outside.
     */
    error?: string;
    impersonatedBy?: ImpersonatedBy;
    user: AuthUser & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: string;
    appUser?: PackedAuthUser;
    impersonatedBy?: ImpersonatedBy;
  }
}
