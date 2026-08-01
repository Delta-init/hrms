"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, ApprovableModule, ApprovalWorkflow } from "@/types";
import type { ApprovalWorkflowFormValues } from "@/lib/validations/approvalWorkflowSchema";

const KEY = ["approval-workflows"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useApprovalWorkflows = () => {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await api.get<ApiResponse<ApprovalWorkflow[]>>("/approval-workflows");
      return res.data.data ?? [];
    },
  });
};

export const useUpsertApprovalWorkflow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ module, data }: { module: ApprovableModule; data: ApprovalWorkflowFormValues }) => {
      const res = await api.put<ApiResponse<ApprovalWorkflow>>(`/approval-workflows/${module}`, data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Approval workflow saved"); },
    onError: (e) => toast.error(errMsg(e, "Failed to save approval workflow")),
  });
};
