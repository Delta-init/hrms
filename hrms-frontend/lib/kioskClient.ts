import axios from "axios";
import type { ApiResponse, KioskPunchResult } from "@/types";

/**
 * API client for the kiosk screen.
 *
 * Deliberately separate from `lib/axios`: that one attaches a NextAuth session
 * and signs the user out on a 401. A kiosk has no session to attach and nobody
 * to sign out — a 401 there means the device was unpaired, which the screen
 * handles by asking for a token again.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";

const STORAGE_KEY = "hrms.kiosk.token";

export function getKioskToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setKioskToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(STORAGE_KEY, token);
  else window.localStorage.removeItem(STORAGE_KEY);
}

const kioskApi = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

kioskApi.interceptors.request.use((config) => {
  const token = getKioskToken();
  if (token) config.headers["X-Kiosk-Token"] = token;
  return config;
});

export interface KioskSession {
  id: string;
  name: string;
  location: string | null;
  /** False only when the server has liveness explicitly turned off. */
  livenessRequired: boolean;
}

export type LivenessStep = "center" | "left" | "right";

export interface LivenessChallenge {
  id: string | null;
  steps: LivenessStep[];
  expiresAt?: string;
}

/**
 * Ask the server which poses to prompt for.
 *
 * The tablet never picks its own — a device choosing the challenge it then
 * satisfies proves nothing at all.
 */
export async function fetchChallenge(): Promise<LivenessChallenge> {
  const res = await kioskApi.post<ApiResponse<LivenessChallenge>>("/kiosks/challenge");
  return res.data.data!;
}

/** Confirm the stored token still works, and find out which device this is. */
export async function fetchKioskSession(token?: string): Promise<KioskSession> {
  const res = await kioskApi.get<ApiResponse<KioskSession>>("/kiosks/session", {
    headers: token ? { "X-Kiosk-Token": token } : undefined,
  });
  return res.data.data!;
}

export async function submitPunch(
  images: string[],
  challengeId?: string | null
): Promise<KioskPunchResult> {
  const res = await kioskApi.post<ApiResponse<KioskPunchResult>>("/kiosks/punch", {
    images,
    ...(challengeId ? { challengeId } : {}),
  });
  return res.data.data!;
}

export default kioskApi;
