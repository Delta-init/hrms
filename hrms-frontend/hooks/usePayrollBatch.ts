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
