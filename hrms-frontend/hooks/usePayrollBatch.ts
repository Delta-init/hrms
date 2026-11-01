"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, PayrollBatch, PayrollPreflight } from "@/types";

const KEY = ["payroll-batches"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const usePayrollBatch = (month: string) =>
  useQuery({
    queryKey: [...KEY, month],
    queryFn: async () => (await api.get<ApiResponse<PayrollBatch>>(`/payroll-batches/${month}`)).data.data!,
    enabled: /^\d{4}-\d{2}$/.test(month),
  });

/**
 * Only fetched when somebody opens the submit dialog.
 *
 * It counts payslips and employees on every call, and running that on each
 * render of the payroll page would be a query per keystroke in the month box
 * for an answer nobody had asked for yet.
 */
export const usePayrollPreflight = (month: string, enabled: boolean) =>
  useQuery({
    queryKey: [...KEY, month, "preflight"],
    queryFn: async () => (await api.get<ApiResponse<PayrollPreflight>>(`/payroll-batches/${month}/preflight`)).data.data!,
    enabled: enabled && /^\d{4}-\d{2}$/.test(month),
    staleTime: 0,
    gcTime: 0,
  });

export const useSubmitPayroll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (month: string) =>
      (await api.post<ApiResponse<PayrollBatch>>(`/payroll-batches/${month}/submit`)).data,
    onSuccess: (res) => {
      // Payslips are issued as part of submitting, and the whole month goes
      // read-only, so the run table has to be re-read rather than patched.
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["payslips"] });
      toast.success(res.message);
    },
    onError: (e) => toast.error(errMsg(e, "Could not submit this payroll")),
  });
};

export const useRecallPayroll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (month: string) =>
      (await api.post<ApiResponse<PayrollBatch>>(`/payroll-batches/${month}/recall`)).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["payslips"] });
      toast.success(res.message);
    },
    onError: (e) => toast.error(errMsg(e, "Could not recall this payroll")),
  });
};

/** The CRM salary slabs kept for a month (2026-11-01): each salesperson's slab salary and the employee it pays. */
export interface SlabSalaryRow {
  email: string; crm: string; crmName: string; name: string; role: string; level: string; salary: number; payable: number;
  employee: { id: string; name: string } | null;
}
export interface SlabSalaries { month: string; fetchedAt: string | null; rows: SlabSalaryRow[] }
export interface SlabRefresh {
  month: string; matched: number;
  unmatched: Array<{ crm: string; name: string; email: string; salary: number }>;
  removed: Array<{ crm: string; name: string; email: string }>;
  crmFailures: Array<{ crm: string; error: string }>;
  payslipsRebuilt: number;
  payslipsFailed: Array<{ payslip: string; error: string }>;
}

export const useSlabSalaries = (month: string) =>
  useQuery({
    queryKey: [...KEY, month, "slab-salaries"],
    queryFn: async () => (await api.get<ApiResponse<SlabSalaries>>(`/payroll-batches/${month}/slab-salaries`)).data.data!,
    enabled: /^\d{4}-\d{2}$/.test(month),
  });

export const useRefreshSlabSalaries = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (month: string) =>
      (await api.post<ApiResponse<SlabRefresh>>(`/payroll-batches/${month}/slab-salaries/refresh`)).data.data!,
    onSuccess: (r) => {
      // The month's payslips for those people were rebuilt on the slab salaries.
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["payslips"] });
      toast.success(`Slab salaries refreshed — ${r.matched} matched, ${r.payslipsRebuilt} payslip${r.payslipsRebuilt === 1 ? "" : "s"} rebuilt`);
    },
    onError: (e) => toast.error(errMsg(e, "Could not refresh the slab salaries")),
  });
};
