"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, MonthlyPerformanceReport, PerformanceReportEligible } from "@/types";

const KEY = ["performance-reports"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

/** Everybody the caller may file a report for — themselves, plus their own team. */
export const useReportEligible = () =>
  useQuery({
    queryKey: [...KEY, "eligible"],
    queryFn: async () => (await api.get<ApiResponse<PerformanceReportEligible[]>>("/performance-reports/eligible")).data.data ?? [],
  });

/** The caller's own reports, across every month. */
export const useMyPerformanceReports = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "mine", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<MonthlyPerformanceReport[]>>("/performance-reports/mine", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

/** Everybody's — HR sees the lot; a department head is narrowed to their own team. */
export const usePerformanceReports = (params?: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "all", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<MonthlyPerformanceReport[]>>("/performance-reports", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled,
  });

export const useFilePerformanceReport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { employee: string; month: string; reportText?: string; file?: File | null }) => {
      const form = new FormData();
      form.append("employee", v.employee);
      form.append("month", v.month);
      if (v.reportText) form.append("reportText", v.reportText);
      if (v.file) form.append("file", v.file);
      return (await api.post<ApiResponse<MonthlyPerformanceReport>>("/performance-reports", form, {
        headers: { "Content-Type": "multipart/form-data" },
      })).data.data!;
    },
    onSuccess: () => { invalidate(qc); toast.success("Report filed"); },
    onError: (e) => toast.error(errMsg(e, "Could not file the report")),
  });
};
