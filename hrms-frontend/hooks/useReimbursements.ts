"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Reimbursement } from "@/types";

const KEY = ["reimbursements"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ["payslips"] });
};

export const useReimbursements = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Reimbursement[]>>("/reimbursements", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useMyReimbursements = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "mine", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Reimbursement[]>>("/reimbursements/mine", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useCreateReimbursement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Reimbursement>>("/reimbursements", data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Claim submitted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to submit claim")),
  });
};

export const useUpdateReimbursement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Reimbursement>>(`/reimbursements/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Claim updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update claim")),
  });
};

export const useReviewReimbursement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.patch<ApiResponse<Reimbursement>>(`/reimbursements/${id}/review`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Claim reviewed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to review claim")),
  });
};

export const useDeleteReimbursement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/reimbursements/${id}`); },
    onSuccess: () => { invalidate(qc); toast.success("Claim deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete claim")),
  });
};
