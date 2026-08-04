"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Role, RoleSimple } from "@/types";
import type { CreateRoleFormValues, UpdateRoleFormValues } from "@/lib/validations/roleSchema";

const ROLES_KEY = ["roles"] as const;

function errMsg(error: unknown, fallback: string) {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
  );
}

export const useRoles = (params?: Record<string, string>, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: [...ROLES_KEY, params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Role[]>>("/roles", { params });
      return { data: response.data.data ?? [], pagination: response.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });
};

export const useRolesSimple = () => {
  return useQuery({
    queryKey: [...ROLES_KEY, "simple"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<RoleSimple[]>>("/roles/all");
      return response.data.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
};

export const useRole = (id: string) => {
  return useQuery({
    queryKey: [...ROLES_KEY, id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Role>>(`/roles/${id}`);
      return response.data.data!;
    },
    enabled: !!id,
  });
};

export const useCreateRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateRoleFormValues) => {
      const response = await api.post<ApiResponse<Role>>("/roles", data);
      return response.data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROLES_KEY });
      toast.success("Role created successfully");
    },
    onError: (error) => toast.error(errMsg(error, "Failed to create role")),
  });
};

export const useUpdateRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateRoleFormValues }) => {
      const response = await api.put<ApiResponse<Role>>(`/roles/${id}`, data);
      return response.data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROLES_KEY });
      toast.success("Role updated successfully");
    },
    onError: (error) => toast.error(errMsg(error, "Failed to update role")),
  });
};

export const useDeleteRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROLES_KEY });
      toast.success("Role deleted successfully");
    },
    onError: (error) => toast.error(errMsg(error, "Failed to delete role")),
  });
};
