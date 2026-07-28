import axios from "axios";
import { getSession, signOut } from "next-auth/react";
import { getActiveOrg, setActiveOrg } from "@/lib/activeOrg";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5055/api/v1";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

// ─── Request Interceptor: attach the Express access token from the NextAuth session ──
api.interceptors.request.use(
  async (config) => {
    if (typeof window !== "undefined") {
      const session = await getSession();
      const token = session?.accessToken;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      // Super Admin's active org (ignored by the backend for regular users).
      const org = getActiveOrg();
      if (org) config.headers["X-Org-Id"] = org;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor: on 401, end the NextAuth session and bounce to login ──
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      setActiveOrg(null);
      await signOut({ callbackUrl: "/login" });
    }
    return Promise.reject(error);
  }
);

export default api;
