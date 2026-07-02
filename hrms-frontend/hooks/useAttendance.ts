"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Attendance } from "@/types";

const KEY = ["attendance"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useAttendance = (params?: Record<string, string>) => {
  return useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Attendance[]>>("/attendance", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });
};

export const useCreateAttendance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await api.post<ApiResponse<Attendance>>("/attendance", data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Attendance recorded"); },
    onError: (e) => toast.error(errMsg(e, "Failed to record attendance")),
  });
};

export const useUpdateAttendance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await api.put<ApiResponse<Attendance>>(`/attendance/${id}`, data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Attendance updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update attendance")),
  });
};

export const useDeleteAttendance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/attendance/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Attendance deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete attendance")),
  });
};
