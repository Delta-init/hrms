"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Payslip, PayslipSummary, PayrollRun } from "@/types";

const KEY = ["payslips"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const usePayslips = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Payslip[]>>("/payslips", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useMyPayslips = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "mine", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Payslip[]>>("/payslips/mine", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const usePayslipSummary = (employee?: string, month?: string) =>
  useQuery({
    queryKey: [...KEY, "summary", employee, month],
    queryFn: async () => (await api.get<ApiResponse<PayslipSummary>>("/payslips/summary", { params: { employee: employee!, month: month! } })).data.data!,
    enabled: !!employee && !!month,
    staleTime: 60_000,
  });

export const usePayrollRun = (month?: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "run", month],
    queryFn: async () => (await api.get<ApiResponse<PayrollRun>>("/payslips/run", { params: { month: month! } })).data.data!,
    enabled: !!month && enabled,
  });

export const useGeneratePayroll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (month: string) => (await api.post<ApiResponse<{ created: number; skipped: number; total: number }>>("/payslips/run", { month })).data.data!,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success(`Generated ${r.created} payslip${r.created === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} already existed` : ""}`);
    },
    onError: (e) => toast.error(errMsg(e, "Failed to generate payroll")),
  });
};

export const useCreatePayslip = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Payslip>>("/payslips", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Payslip created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create payslip")),
  });
};

export const useUpdatePayslip = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Payslip>>(`/payslips/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Payslip updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update payslip")),
  });
};

export const useDeletePayslip = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/payslips/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Payslip deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete payslip")),
  });
};
