"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Department, DepartmentSimple, DepartmentReport } from "@/types";

const KEY = ["departments"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useDepartments = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Department[]>>("/departments", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

export const useDepartmentsSimple = () =>
  useQuery({
    queryKey: [...KEY, "simple"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<DepartmentSimple[]>>("/departments/all");
      return res.data.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

export const useDepartmentReport = (id: string, month: string) =>
  useQuery({
    queryKey: [...KEY, "report", id, month],
    queryFn: async () => (await api.get<ApiResponse<DepartmentReport>>(`/departments/${id}/report`, { params: { month } })).data.data!,
    enabled: !!id && !!month,
  });

export const useCreateDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Department>>("/departments", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Department created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create department")),
  });
};

export const useUpdateDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Department>>(`/departments/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Department updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update department")),
  });
};

export const useDeleteDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/departments/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Department deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete department")),
  });
};
