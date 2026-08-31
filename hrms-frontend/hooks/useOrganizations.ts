"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Organization, OrganizationSimple } from "@/types";

const KEY = ["organizations"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useOrganizations = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Organization[]>>("/organizations", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

/** Lightweight list for the switcher. */
export const useAllOrganizations = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "all"],
    queryFn: async () => (await api.get<ApiResponse<OrganizationSimple[]>>("/organizations/all")).data.data ?? [],
    enabled,
    staleTime: 5 * 60 * 1000,
  });

/** One organization, for its own page. */
export const useOrganization = (id?: string) =>
  useQuery({
    queryKey: [...KEY, id],
    queryFn: async () => (await api.get<ApiResponse<Organization>>(`/organizations/${id}`)).data.data!,
    enabled: !!id,
  });

export const useCreateOrganization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Organization>>("/organizations", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Organization created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create organization")),
  });
};

export const useUpdateOrganization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Organization>>(`/organizations/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Organization updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update organization")),
  });
};

export const useDeleteOrganization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/organizations/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Organization deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete organization")),
  });
};
