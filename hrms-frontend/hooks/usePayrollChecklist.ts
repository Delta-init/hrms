"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, PayrollChecklistItem } from "@/types";

const KEY = ["payroll-checklist"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const usePayrollChecklist = (enabled = true) =>
  useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<ApiResponse<PayrollChecklistItem[]>>("/payroll-checklist")).data.data ?? [],
    enabled,
  });

export const useCreateChecklistItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { label: string; link?: string }) => (await api.post<ApiResponse<PayrollChecklistItem>>("/payroll-checklist", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Item added"); },
    onError: (e) => toast.error(errMsg(e, "Failed to add item")),
  });
};

export const useDeleteChecklistItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/payroll-checklist/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Item removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove item")),
  });
};
