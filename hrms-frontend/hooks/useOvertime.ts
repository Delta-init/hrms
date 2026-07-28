"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Overtime } from "@/types";

const KEY = ["overtime"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ["payslips"] });
};

export const useOvertime = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Overtime[]>>("/overtime", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useCreateOvertime = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Overtime>>("/overtime", data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Overtime added"); },
    onError: (e) => toast.error(errMsg(e, "Failed to add overtime")),
  });
};

export const useUpdateOvertime = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Overtime>>(`/overtime/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Overtime updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update overtime")),
  });
};

export const useDeleteOvertime = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/overtime/${id}`); },
    onSuccess: () => { invalidate(qc); toast.success("Overtime removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove overtime")),
  });
};
