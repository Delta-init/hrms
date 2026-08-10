"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, HiringWorkflowState, JobRequisition, RequisitionStatus } from "@/types";

const KEY = ["hiring"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useRequisitions = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "requisitions", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<JobRequisition[]>>("/hiring/requisitions", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

/** Whether a chain is configured. Without one the Finance gate does not exist. */
export const useHiringWorkflow = () =>
  useQuery({
    queryKey: [...KEY, "workflow"],
    queryFn: async () => (await api.get<ApiResponse<HiringWorkflowState>>("/hiring/workflow")).data.data!,
  });

export const useCreateRequisition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<JobRequisition>) =>
      (await api.post<ApiResponse<JobRequisition>>("/hiring/requisitions", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Requisition raised"); },
    onError: (e) => toast.error(errMsg(e, "Could not raise the requisition")),
  });
};

export const useReviewRequisition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, reviewNote }: { id: string; status: RequisitionStatus; reviewNote?: string }) =>
      (await api.patch<ApiResponse<JobRequisition>>(`/hiring/requisitions/${id}/review`, { status, reviewNote })).data.data!,
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(`Requisition ${v.status}`); },
    // The workflow refuses a reviewer who does not hold the current step, and
    // that message names the role — surface it rather than a generic failure.
    onError: (e) => toast.error(errMsg(e, "Could not record the decision")),
  });
};

export const useDeleteRequisition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hiring/requisitions/${id}`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Requisition deleted"); },
    onError: (e) => toast.error(errMsg(e, "Could not delete the requisition")),
  });
};
