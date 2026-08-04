"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, RosterAssignment } from "@/types";

const KEY = ["roster-assignments"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useRosterAssignments = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<RosterAssignment[]>>("/work-schedules/roster", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

export const useCreateRosterAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<RosterAssignment>>("/work-schedules/roster", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Shift assigned"); },
    onError: (e) => toast.error(errMsg(e, "Failed to assign shift")),
  });
};

export const useUpdateRosterAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<RosterAssignment>>(`/work-schedules/roster/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Assignment updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update assignment")),
  });
};

export const useDeleteRosterAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/work-schedules/roster/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Assignment removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove assignment")),
  });
};
