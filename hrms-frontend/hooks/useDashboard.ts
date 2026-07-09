"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import type { ApiResponse, DashboardSummary } from "@/types";

export const useDashboardSummary = (enabled = true) =>
  useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: async () => (await api.get<ApiResponse<DashboardSummary>>("/dashboard/summary")).data.data!,
    enabled,
    refetchInterval: 60_000,
  });
