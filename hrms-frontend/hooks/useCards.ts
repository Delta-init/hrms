"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Card } from "@/types";

const KEY = ["cards"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useCards = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Card[]>>("/cards", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useCreateCard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Card>>("/cards", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Card created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create card")),
  });
};

export const useUpdateCard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Card>>(`/cards/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Card updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update card")),
  });
};

export const useDeleteCard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/cards/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Card deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete card")),
  });
};
