"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, User } from "@/types";
import type { CreateUserFormValues, UpdateUserFormValues } from "@/lib/validations/userSchema";

const USERS_KEY = ["users"] as const;

function errMsg(error: unknown, fallback: string) {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
  );
}

export const useUsers = (params?: Record<string, string>, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: [...USERS_KEY, params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<User[]>>("/users", { params });
      return { data: response.data.data ?? [], pagination: response.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });
};

export const useUser = (id: string) => {
  return useQuery({
    queryKey: [...USERS_KEY, id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<User>>(`/users/${id}`);
      return response.data.data!;
    },
    enabled: !!id,
    // A user who isn't there won't appear on the third attempt. Retrying only
    // delayed the "not found" state behind a spinner.
    retry: false,
  });
};

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateUserFormValues) => {
      const response = await api.post<ApiResponse<User>>("/users", data);
      return response.data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEY });
      toast.success("User created successfully");
    },
    onError: (error) => toast.error(errMsg(error, "Failed to create user")),
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateUserFormValues }) => {
      const response = await api.put<ApiResponse<User>>(`/users/${id}`, data);
      return response.data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEY });
      toast.success("User updated successfully");
    },
    onError: (error) => toast.error(errMsg(error, "Failed to update user")),
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEY });
      toast.success("User deleted successfully");
    },
    onError: (error) => toast.error(errMsg(error, "Failed to delete user")),
  });
};
