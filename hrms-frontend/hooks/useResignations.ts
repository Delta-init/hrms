"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Resignation, FinalSettlement } from "@/types";

const KEY = ["resignations"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useResignations = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Resignation[]>>("/resignations", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

export const useCreateResignation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Resignation>>("/resignations", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Resignation recorded"); },
    onError: (e) => toast.error(errMsg(e, "Failed to record resignation")),
  });
};

export const useReviewResignation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.patch<ApiResponse<Resignation>>(`/resignations/${id}/review`, data)).data.data!,
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["employees"] }); toast.success(`Resignation ${(v.data.status as string) === "accepted" ? "accepted" : "rejected"}`); },
    onError: (e) => toast.error(errMsg(e, "Failed to review resignation")),
  });
};

export const useWithdrawResignation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch<ApiResponse<Resignation>>(`/resignations/${id}/withdraw`, {})).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["employees"] }); toast.success("Resignation withdrawn"); },
    onError: (e) => toast.error(errMsg(e, "Failed to withdraw")),
  });
};

export const useRelieveResignation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch<ApiResponse<Resignation>>(`/resignations/${id}/relieve`, {})).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["employees"] }); toast.success("Employee relieved"); },
    onError: (e) => toast.error(errMsg(e, "Failed to relieve")),
  });
};

export const useDeleteResignation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/resignations/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Resignation deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete")),
  });
};

export const useSetExitDetails = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.patch<ApiResponse<Resignation>>(`/resignations/${id}/exit`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["employees"] }); toast.success("Exit details saved"); },
    onError: (e) => toast.error(errMsg(e, "Failed to save exit details")),
  });
};

// ── Full & final settlement ──
export const usePreviewSettlement = () =>
  useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.post<ApiResponse<FinalSettlement>>(`/resignations/${id}/settlement/preview`, data)).data.data!,
    onError: (e) => toast.error(errMsg(e, "Failed to compute settlement")),
  });

export const useSaveSettlement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.put<ApiResponse<FinalSettlement>>(`/resignations/${id}/settlement`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Settlement saved"); },
    onError: (e) => toast.error(errMsg(e, "Failed to save settlement")),
  });
};

export const useFinaliseSettlement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<ApiResponse<FinalSettlement>>(`/resignations/${id}/settlement/settle`, {})).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
      qc.invalidateQueries({ queryKey: ["payslips"] });
      toast.success("Settlement finalised");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to finalise settlement")),
  });
};
