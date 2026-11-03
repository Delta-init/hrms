"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, CompOffCredit, CompOffSuggestion } from "@/types";

const CREDITS_KEY = ["comp-off-credits"] as const;
const MY_BALANCE_KEY = ["comp-off-my-balance"] as const;

function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useMyCompOffBalance = (enabled = true) =>
  useQuery({
    queryKey: MY_BALANCE_KEY,
    queryFn: async () => (await api.get<ApiResponse<{ balance: number }>>("/comp-off/mine")).data.data!,
    enabled,
  });

/** Someone else's balance — the leave-approve-gated sibling of useMyCompOffBalance, for creating leave on another employee's behalf. */
export const useCompOffBalanceFor = (userId: string, enabled = true) =>
  useQuery({
    queryKey: [...MY_BALANCE_KEY, userId],
    queryFn: async () => (await api.get<ApiResponse<{ balance: number }>>(`/comp-off/${userId}`)).data.data!,
    enabled: enabled && !!userId,
  });

/** The caller's own earned/redeemed history — self-service, no module permission required. */
export const useMyCompOffCredits = (enabled = true) =>
  useQuery({
    queryKey: [...MY_BALANCE_KEY, "credits"],
    queryFn: async () => (await api.get<ApiResponse<CompOffCredit[]>>("/comp-off/mine/credits")).data.data ?? [],
    enabled,
  });

export const useCompOffCredits = (enabled = true) =>
  useQuery({
    queryKey: CREDITS_KEY,
    queryFn: async () => (await api.get<ApiResponse<CompOffCredit[]>>("/comp-off/credits")).data.data ?? [],
    enabled,
  });

export const useCompOffSuggestions = (enabled = true) =>
  useQuery({
    queryKey: ["comp-off-suggestions"],
    queryFn: async () => (await api.get<ApiResponse<CompOffSuggestion[]>>("/comp-off/suggestions")).data.data ?? [],
    enabled,
  });

export const useGrantCompOff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<CompOffCredit>>("/comp-off/credits", data)).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CREDITS_KEY });
      qc.invalidateQueries({ queryKey: ["comp-off-suggestions"] });
      qc.invalidateQueries({ queryKey: MY_BALANCE_KEY });
      toast.success("Comp-off credited");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to credit comp-off")),
  });
};

export const useRevokeCompOff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/comp-off/credits/${id}`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CREDITS_KEY });
      qc.invalidateQueries({ queryKey: MY_BALANCE_KEY });
      toast.success("Credit revoked");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to revoke credit")),
  });
};

/** Asking for a day back — pending until HR approves it. */
export const useRequestCompOff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { date: string; amount: number; reason: string }) =>
      (await api.post<ApiResponse<CompOffCredit>>("/comp-off/mine/requests", data)).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_BALANCE_KEY });
      qc.invalidateQueries({ queryKey: CREDITS_KEY });
      toast.success("Comp-off requested — HR will review it");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to request comp-off")),
  });
};

const reviewed = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: CREDITS_KEY });
  qc.invalidateQueries({ queryKey: MY_BALANCE_KEY });
  qc.invalidateQueries({ queryKey: ["comp-off-suggestions"] });
};

export const useApproveCompOff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; amount?: number; note?: string }) =>
      (await api.post<ApiResponse<CompOffCredit>>(`/comp-off/credits/${id}/approve`, data)).data.data!,
    onSuccess: () => { reviewed(qc); toast.success("Comp-off approved"); },
    onError: (e) => toast.error(errMsg(e, "Failed to approve comp-off")),
  });
};

export const useApproveManyCompOff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (await api.post<ApiResponse<{ approved: number; skipped: number }>>("/comp-off/credits/approve", { ids })).data.data!,
    onSuccess: (r) => {
      reviewed(qc);
      toast.success(`${r.approved} approved${r.skipped ? ` · ${r.skipped} skipped (your own, or already decided)` : ""}`);
    },
    onError: (e) => toast.error(errMsg(e, "Failed to approve comp-off")),
  });
};

export const useRejectCompOff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) =>
      (await api.post<ApiResponse<CompOffCredit>>(`/comp-off/credits/${id}/reject`, { note })).data.data!,
    onSuccess: () => { reviewed(qc); toast.success("Comp-off rejected"); },
    onError: (e) => toast.error(errMsg(e, "Failed to reject comp-off")),
  });
};
