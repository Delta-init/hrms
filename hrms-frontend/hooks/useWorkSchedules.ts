"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, WorkSchedule, WorkScheduleSimple } from "@/types";

const KEY = ["work-schedules"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useWorkSchedules = (params?: Record<string, string>) => {
  return useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<WorkSchedule[]>>("/work-schedules", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });
};

export const useWorkSchedulesSimple = () => {
  return useQuery({
    queryKey: [...KEY, "simple"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<WorkScheduleSimple[]>>("/work-schedules/all");
      return res.data.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
};

export const useCreateWorkSchedule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await api.post<ApiResponse<WorkSchedule>>("/work-schedules", data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Work schedule created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create work schedule")),
  });
};

export const useUpdateWorkSchedule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await api.put<ApiResponse<WorkSchedule>>(`/work-schedules/${id}`, data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Work schedule updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update work schedule")),
  });
};

export const useDeleteWorkSchedule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/work-schedules/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Work schedule deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete work schedule")),
  });
};
