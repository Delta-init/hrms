"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Loan, LoanHistory, LoanPaymentMethod } from "@/types";

const KEY = ["loans"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useLoans = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Loan[]>>("/loans", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

export const useCreateLoan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Loan>>("/loans", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Loan created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create loan")),
  });
};

export const useUpdateLoan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Loan>>(`/loans/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Loan updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update loan")),
  });
};

export const useDeleteLoan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/loans/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Loan deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete loan")),
  });
};

/** Every month of one loan: taken, skipped, reduced, paid directly, and still to come. */
export const useLoanHistory = (id: string | null | undefined) =>
  useQuery({
    queryKey: [...KEY, "history", id],
    queryFn: async () => (await api.get<ApiResponse<LoanHistory>>(`/loans/${id}/history`)).data.data!,
    enabled: !!id,
  });

/** The signed-in employee's own loans and advances, each with its history. */
export const useMyLoans = () =>
  useQuery({
    queryKey: [...KEY, "mine"],
    queryFn: async () => (await api.get<ApiResponse<LoanHistory[]>>("/loans/mine")).data.data ?? [],
  });

// A month's change recalculates its draft payslip, so payslips are refreshed too.
const afterChange = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ["payslips"] });
};

/** Skip a month (amount 0) or take less in it. */
export const usePlanLoanMonth = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, month, amount, reason }: { id: string; month: string; amount: number; reason?: string }) =>
      (await api.put<ApiResponse<LoanHistory>>(`/loans/${id}/months/${month}`, { amount, reason })).data.data!,
    onSuccess: (_d, v) => { afterChange(qc); toast.success(v.amount > 0 ? "Month reduced" : "Month skipped"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't change the month")),
  });
};

/** Put a month back on the normal schedule. */
export const useClearLoanMonth = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, month }: { id: string; month: string }) =>
      (await api.delete<ApiResponse<LoanHistory>>(`/loans/${id}/months/${month}`)).data.data!,
    onSuccess: () => { afterChange(qc); toast.success("Month back on the normal schedule"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't change the month")),
  });
};

export const useAddLoanPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; amount: number; date: string; method: LoanPaymentMethod; reference?: string; note?: string }) =>
      (await api.post<ApiResponse<LoanHistory>>(`/loans/${id}/payments`, data)).data.data!,
    onSuccess: () => { afterChange(qc); toast.success("Payment recorded"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't record the payment")),
  });
};

export const useRemoveLoanPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, paymentId }: { id: string; paymentId: string }) =>
      (await api.delete<ApiResponse<LoanHistory>>(`/loans/${id}/payments/${paymentId}`)).data.data!,
    onSuccess: () => { afterChange(qc); toast.success("Payment removed"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't remove the payment")),
  });
};
