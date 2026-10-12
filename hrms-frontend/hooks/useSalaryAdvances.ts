"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, SalaryAdvance, SalaryAdvanceEligibility } from "@/types";

const KEY = ["salary-advances"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

/** What the caller may ask for right now — the limit, and why not if they can't. */
export const useAdvanceEligibility = () =>
  useQuery({
    queryKey: [...KEY, "eligibility"],
    queryFn: async () => (await api.get<ApiResponse<SalaryAdvanceEligibility>>("/advances/eligibility")).data.data!,
  });

/** The caller's own requests. Needs no permission. */
export const useMyAdvances = () =>
  useQuery({
    queryKey: [...KEY, "mine"],
    queryFn: async () => (await api.get<ApiResponse<SalaryAdvance[]>>("/advances/mine", { params: { limit: "100" } })).data.data ?? [],
  });

/** HR's panel. */
export const useAdvanceQueue = (status: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "queue", status],
    queryFn: async () => (await api.get<ApiResponse<SalaryAdvance[]>>("/advances", { params: { status, limit: "200" } })).data.data ?? [],
    enabled,
  });

export const useRequestAdvance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { amount: number; reason: string; neededBy?: string | null }) =>
      (await api.post<ApiResponse<SalaryAdvance>>("/advances", v)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Advance requested — HR has been told"); },
    onError: (e) => toast.error(errMsg(e, "Could not request the advance")),
  });
};

export const useReviewAdvance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; decision: "approve" | "reject"; months?: number; startMonth?: string; note?: string }) => {
      const { id, ...body } = v;
      return (await api.patch<ApiResponse<SalaryAdvance>>(`/advances/${id}/review`, body)).data;
    },
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "Decision recorded"); },
    onError: (e) => toast.error(errMsg(e, "Could not record the decision")),
  });
};

export const useWithdrawAdvance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.patch(`/advances/${id}/withdraw`); },
    onSuccess: () => { invalidate(qc); toast.success("Request withdrawn"); },
    onError: (e) => toast.error(errMsg(e, "Could not withdraw the request")),
  });
};
