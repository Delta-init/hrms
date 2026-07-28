import type { AuthUser } from "@/types";
import type { DefaultSession } from "next-auth";

interface ImpersonatedBy {
  id: string;
  name: string;
  restoreTicket: string;
}

declare module "next-auth" {
  interface Session {
    accessToken?: string;
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
    appUser?: AuthUser;
    impersonatedBy?: ImpersonatedBy;
  }
}
