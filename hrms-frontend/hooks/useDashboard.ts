"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import type { ApiResponse, DashboardSummary, DashboardWishes, OrgChart } from "@/types";

export const useDashboardSummary = (enabled = true) =>
  useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: async () => (await api.get<ApiResponse<DashboardSummary>>("/dashboard/summary")).data.data!,
    enabled,
    refetchInterval: 60_000,
  });

/** Self-service — today's birthdays/anniversaries, for every employee. */
export const useDashboardWishes = () =>
  useQuery({
    queryKey: ["dashboard", "wishes"],
    queryFn: async () => (await api.get<ApiResponse<DashboardWishes>>("/dashboard/wishes")).data.data!,
  });

export const useOrgChart = (enabled = true) =>
  useQuery({
    queryKey: ["dashboard", "org-chart"],
    queryFn: async () => (await api.get<ApiResponse<OrgChart>>("/dashboard/org-chart")).data.data!,
    enabled,
  });
