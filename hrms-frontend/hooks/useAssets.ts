"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Asset } from "@/types";

const KEY = ["assets"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

export const useAssets = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Asset[]>>("/assets", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

/**
 * The category and branch values the register actually uses.
 *
 * Both are open text, so a hard-coded filter list goes stale the moment
 * somebody adds a kind of thing nobody had bought before.
 */
export const useAssetFacets = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "facets"],
    queryFn: async () =>
      (await api.get<ApiResponse<{ categories: { value: string; count: number }[]; branches: { value: string; count: number }[] }>>("/assets/facets")).data.data!,
    enabled,
  });

/** Self-service — assets currently assigned to the caller. */
export const useMyAssets = () =>
  useQuery({
    queryKey: [...KEY, "mine"],
    queryFn: async () => (await api.get<ApiResponse<Asset[]>>("/assets/mine")).data.data ?? [],
  });

export const useAsset = (id?: string) =>
  useQuery({
    queryKey: [...KEY, id],
    queryFn: async () => (await api.get<ApiResponse<Asset>>(`/assets/${id}`)).data.data!,
    enabled: !!id,
  });

export const useCreateAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Asset>>("/assets", data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Asset added"); },
    onError: (e) => toast.error(errMsg(e, "Failed to add asset")),
  });
};

export const useUpdateAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Asset>>(`/assets/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Asset updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update asset")),
  });
};

export const useDeleteAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/assets/${id}`); },
    onSuccess: () => { invalidate(qc); toast.success("Asset removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove asset")),
  });
};

export const useIssueAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.patch<ApiResponse<Asset>>(`/assets/${id}/issue`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Asset issued"); },
    onError: (e) => toast.error(errMsg(e, "Failed to issue asset")),
  });
};

export const useReturnAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.patch<ApiResponse<Asset>>(`/assets/${id}/return`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Asset returned"); },
    onError: (e) => toast.error(errMsg(e, "Failed to return asset")),
  });
};

export const useMarkAssetAvailable = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch<ApiResponse<Asset>>(`/assets/${id}/available`, {})).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Asset marked available"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update asset")),
  });
};

export const useRetireAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch<ApiResponse<Asset>>(`/assets/${id}/retire`, {})).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Asset retired"); },
    onError: (e) => toast.error(errMsg(e, "Failed to retire asset")),
  });
};
