"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, SalaryIncrement } from "@/types";

const KEY = ["salary-increments"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useSalaryIncrements = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<SalaryIncrement[]>>("/salary-increments", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

export const useCreateSalaryIncrement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<SalaryIncrement>>("/salary-increments", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["payslips"] }); toast.success("Salary increment recorded"); },
    onError: (e) => toast.error(errMsg(e, "Failed to record increment")),
  });
};

export const useUpdateSalaryIncrement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<SalaryIncrement>>(`/salary-increments/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["payslips"] }); toast.success("Salary increment updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update increment")),
  });
};

export const useDeleteSalaryIncrement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/salary-increments/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["payslips"] }); toast.success("Salary increment deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete increment")),
  });
};
