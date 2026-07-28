"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, OneTimeAdjustment } from "@/types";

const KEY = ["one-time-adjustments"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useOneTimeAdjustments = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<OneTimeAdjustment[]>>("/one-time-adjustments", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useCreateOneTime = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<OneTimeAdjustment>>("/one-time-adjustments", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["payslips"] }); toast.success("Adjustment added"); },
    onError: (e) => toast.error(errMsg(e, "Failed to add adjustment")),
  });
};

export const useUpdateOneTime = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<OneTimeAdjustment>>(`/one-time-adjustments/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["payslips"] }); toast.success("Adjustment updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update adjustment")),
  });
};

export const useDeleteOneTime = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/one-time-adjustments/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["payslips"] }); toast.success("Adjustment removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove adjustment")),
  });
};
