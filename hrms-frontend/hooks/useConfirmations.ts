"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Confirmation, DueConfirmation } from "@/types";

const KEY = ["confirmations"];
const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

/** Employees whose probation ends within the window (overdue included). */
export const useConfirmationsDue = (withinDays = 30, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, "due", withinDays],
    queryFn: async () =>
      (await api.get<ApiResponse<DueConfirmation[]>>(`/confirmations/due?withinDays=${withinDays}`)).data.data ?? [],
    enabled: options?.enabled ?? true,
  });

export const useConfirmations = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => (await api.get<ApiResponse<Confirmation[]>>("/confirmations", { params })).data,
    enabled: options?.enabled ?? true,
  });

/**
 * Start a confirmation. With `useWorkflow` it routes through the configured
 * approval chain; without it the employee is confirmed outright.
 */
export const useInitiateConfirmation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await api.post<ApiResponse<Confirmation>>("/confirmations", data)).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(res.message ?? "Confirmation saved");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to confirm employee")),
  });
};

export const useReviewConfirmation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.patch<ApiResponse<Confirmation>>(`/confirmations/${id}/review`, data)).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Confirmation reviewed");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to review confirmation")),
  });
};

export const useWithdrawConfirmation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete<ApiResponse<null>>(`/confirmations/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Confirmation withdrawn");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to withdraw confirmation")),
  });
};
