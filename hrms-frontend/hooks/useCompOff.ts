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

export const useMyCompOffBalance = () =>
  useQuery({
    queryKey: MY_BALANCE_KEY,
    queryFn: async () => (await api.get<ApiResponse<{ balance: number }>>("/comp-off/mine")).data.data!,
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
