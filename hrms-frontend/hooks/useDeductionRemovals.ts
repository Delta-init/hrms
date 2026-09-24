"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, DeductionRemovalRequest, DeductionRemovalStatus, EligibleDeduction } from "@/types";

const KEY = ["deduction-removals"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

/** What the caller could ask to have removed from `month`'s pay. */
export const useEligibleDeductions = (month: string) =>
  useQuery({
    queryKey: [...KEY, "eligible", month],
    queryFn: async () =>
      (await api.get<ApiResponse<{ month: string; editable: boolean; items: EligibleDeduction[] }>>(
        "/deduction-removals/eligible",
        { params: { month } }
      )).data.data!,
    enabled: !!month,
  });

/** The caller's own requests. Needs no permission. */
export const useMyDeductionRemovals = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "mine", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<DeductionRemovalRequest[]>>("/deduction-removals/mine", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

/** The panel — everything, for whoever decides these. */
export const useDeductionRemovalQueue = (params: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "queue", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<DeductionRemovalRequest[]>>("/deduction-removals", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled,
  });

export const useRequestDeductionRemoval = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { sourceType: "loan" | "adjustment"; sourceId: string; month: string; reason: string }) =>
      (await api.post<ApiResponse<DeductionRemovalRequest>>("/deduction-removals", v)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Request raised"); },
    onError: (e) => toast.error(errMsg(e, "Could not raise the request")),
  });
};

export const useReviewDeductionRemoval = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; status: DeductionRemovalStatus; reviewNote?: string }) =>
      (await api.patch<ApiResponse<DeductionRemovalRequest>>(`/deduction-removals/${v.id}/review`, {
        status: v.status, reviewNote: v.reviewNote,
      })).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Decision recorded"); },
    onError: (e) => toast.error(errMsg(e, "Could not record the decision")),
  });
};

export const useWithdrawDeductionRemoval = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.patch(`/deduction-removals/${id}/withdraw`); },
    onSuccess: () => { invalidate(qc); toast.success("Withdrawn"); },
    onError: (e) => toast.error(errMsg(e, "Could not withdraw it")),
  });
};
