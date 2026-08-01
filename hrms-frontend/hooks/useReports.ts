"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, ReportSource, ReportRunResult, ReportSourceKey, ReportFilterValues } from "@/types";

function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useReportSources = () =>
  useQuery({
    queryKey: ["reports", "sources"],
    queryFn: async () => (await api.get<ApiResponse<ReportSource[]>>("/reports/sources")).data.data ?? [],
    staleTime: 5 * 60 * 1000,
  });

export const useRunReport = () =>
  useMutation({
    mutationFn: async (input: { source: ReportSourceKey; columns?: string[]; filters: ReportFilterValues }) =>
      (await api.post<ApiResponse<ReportRunResult>>("/reports/run", input)).data.data!,
    onError: (e) => toast.error(errMsg(e, "Failed to run report")),
  });
