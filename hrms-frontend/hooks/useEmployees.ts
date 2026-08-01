"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Employee } from "@/types";

const KEY = ["employees"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useEmployees = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Employee[]>>("/employees", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

export const useEmployee = (id?: string) =>
  useQuery({
    queryKey: [...KEY, "detail", id],
    queryFn: async () => (await api.get<ApiResponse<Employee>>(`/employees/${id}`)).data.data!,
    enabled: !!id,
  });

/** Resolve the employee linked to a login account (404 → null, no retry). */
export const useEmployeeByUser = (userId?: string) =>
  useQuery({
    queryKey: [...KEY, "by-user", userId],
    queryFn: async () => {
      try {
        return (await api.get<ApiResponse<Employee>>(`/employees/by-user/${userId}`)).data.data!;
      } catch {
        return null;
      }
    },
    enabled: !!userId,
    retry: false,
  });

/** Self-service — the caller's own employee record. */
export const useMyEmployeeProfile = () =>
  useQuery({
    queryKey: [...KEY, "me"],
    queryFn: async () => (await api.get<ApiResponse<Employee>>("/employees/me")).data.data!,
  });

export const useCreateEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Employee>>("/employees", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Employee created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create employee")),
  });
};

export const useUpdateEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Employee>>(`/employees/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Employee updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update employee")),
  });
};

export const useDeleteEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/employees/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Employee deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete employee")),
  });
};

export const useCreateEmployeeLogin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.post<ApiResponse<{ loginEmail: string }>>(`/employees/${id}/create-login`, data)).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Login created", { description: "Share the temporary password — they activate at /set-password on first sign-in." });
    },
    onError: (e) => toast.error(errMsg(e, "Failed to create login")),
  });
};
