"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, PaginationMeta, Procurement } from "@/types";

const KEY = ["procurement"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

export const useProcurements = (params?: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<{ records: Procurement[]; pagination: PaginationMeta }>>("/procurement", { params });
      const result = res.data.data;
      return {
        data: result?.records ?? [],
        pagination: result?.pagination ?? res.data.pagination,
      };
    },
    enabled,
  });

export const useCreateProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Procurement>>("/procurement", data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Procurement added"); },
    onError: (e) => toast.error(errMsg(e, "Failed to add procurement")),
  });
};

export const useUpdateProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.put<ApiResponse<Procurement>>(`/procurement/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Procurement updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update procurement")),
  });
};

/** HR's decision: send it on to finance, or refuse it. */
export const useReviewProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: "approve" | "reject"; note?: string }) =>
      (await api.patch<ApiResponse<Procurement>>(`/procurement/${id}/review`, { decision, note })).data.data!,
    onSuccess: (_d, v) => { invalidate(qc); toast.success(v.decision === "approve" ? "Sent to finance" : "Request rejected"); },
    onError: (e) => toast.error(errMsg(e, "Failed to record the decision")),
  });
};

/** Revise a refused request and send it round again. */
export const useResubmitProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.patch<ApiResponse<Procurement>>(`/procurement/${id}/resubmit`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Resubmitted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to resubmit")),
  });
};

export const useDeleteProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/procurement/${id}`); },
    onSuccess: () => { invalidate(qc); toast.success("Procurement removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove procurement")),
  });
};
