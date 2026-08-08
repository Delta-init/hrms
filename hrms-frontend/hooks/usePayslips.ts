"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Payslip, PayslipStatus, PayslipSummary, PayrollRun, SalaryRegister } from "@/types";

const KEY = ["payslips"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const usePayslips = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Payslip[]>>("/payslips", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

export const useMyPayslips = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "mine", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Payslip[]>>("/payslips/mine", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const usePayslip = (id?: string) =>
  useQuery({
    queryKey: [...KEY, "detail", id],
    queryFn: async () => (await api.get<ApiResponse<Payslip>>(`/payslips/${id}`)).data.data!,
    enabled: !!id,
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

export const useSalaryRegister = (month?: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "register", month],
    queryFn: async () => (await api.get<ApiResponse<SalaryRegister>>("/payslips/register", { params: { month: month! } })).data.data!,
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

/** Move a selection of payslips to one status in a single request. */
export const useBulkPayslipStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: PayslipStatus }) =>
      (await api.patch<ApiResponse<{ modified: number }>>("/payslips/bulk/status", { ids, status })).data,
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(res.message); },
    onError: (e) => toast.error(errMsg(e, "Failed to update payslips")),
  });
};

/** Delete a selection, returning each row to "not generated". */
export const useBulkDeletePayslips = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (await api.post<ApiResponse<{ deleted: number }>>("/payslips/bulk/delete", { ids })).data,
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(res.message); },
    onError: (e) => toast.error(errMsg(e, "Failed to revert payslips")),
  });
};
