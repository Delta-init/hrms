import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import type { JwtPayload } from "../types/index.js";

export const signAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
};

export const signRefreshToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
};

// Every verify pins algorithms explicitly so a token can't dictate how it is
// checked via its own header.
export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
};

// ── Impersonation tickets (distinct secret so they can't double as access tokens) ──
// Prefer an independent secret; fall back to a derivation of JWT_SECRET so
// existing deployments keep working (JWT_SECRET now has a 32-char floor, so the
// derived value is no longer trivially guessable).
const TICKET_SECRET = env.JWT_TICKET_SECRET ?? `${env.JWT_SECRET}::impersonation`;

export interface ImpersonationTicket {
  kind: "impersonate" | "restore";
  targetUserId?: string;
  userId?: string;
  impersonatorId?: string;
  impersonatorName?: string;
  /** Unique id, recorded on redemption so a ticket can't be replayed. */
  jti?: string;
  exp?: number;
}

export const signTicket = (payload: ImpersonationTicket, expiresIn: string): string => {
  return jwt.sign({ ...payload, jti: randomUUID() }, TICKET_SECRET, {
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  });
};

export const verifyTicket = (token: string): ImpersonationTicket => {
  return jwt.verify(token, TICKET_SECRET, { algorithms: ["HS256"] }) as ImpersonationTicket;
};
