"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, LeaveRequest, Holiday, LeaveOptions } from "@/types";

const LEAVE_KEY = ["leaves"] as const;
const HOLIDAY_KEY = ["holidays"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

// ── Leaves ──
export const useLeaves = (params?: Record<string, string>) => {
  return useQuery({
    queryKey: [...LEAVE_KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<LeaveRequest[]>>("/leaves", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });
};

export const useMyLeaves = (params?: Record<string, string>) => {
  return useQuery({
    queryKey: [...LEAVE_KEY, "mine", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<LeaveRequest[]>>("/leaves/mine", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });
};

export const useCreateLeave = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await api.post<ApiResponse<LeaveRequest>>("/leaves", data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: LEAVE_KEY }); toast.success("Leave request created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create leave request")),
  });
};

export const useUpdateLeave = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await api.put<ApiResponse<LeaveRequest>>(`/leaves/${id}`, data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: LEAVE_KEY }); toast.success("Leave request updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update leave request")),
  });
};

export const useReviewLeave = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await api.patch<ApiResponse<LeaveRequest>>(`/leaves/${id}/review`, data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: LEAVE_KEY }); toast.success("Leave reviewed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to review leave request")),
  });
};

export const useDeleteLeave = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/leaves/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: LEAVE_KEY }); toast.success("Leave request deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete leave request")),
  });
};

/** Self-service — withdraw one's own still-pending request. */
export const useWithdrawLeave = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.patch<ApiResponse<LeaveRequest>>(`/leaves/${id}/withdraw`);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: LEAVE_KEY }); toast.success("Leave request withdrawn"); },
    onError: (e) => toast.error(errMsg(e, "Failed to withdraw leave request")),
  });
};

// ── Holidays (leave calendar) ──
export const useHolidays = (params?: Record<string, string>) => {
  return useQuery({
    queryKey: [...HOLIDAY_KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Holiday[]>>("/holidays", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });
};

export const useCreateHoliday = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await api.post<ApiResponse<Holiday>>("/holidays", data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: HOLIDAY_KEY }); toast.success("Holiday added"); },
    onError: (e) => toast.error(errMsg(e, "Failed to add holiday")),
  });
};

export const useDeleteHoliday = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/holidays/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: HOLIDAY_KEY }); toast.success("Holiday removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove holiday")),
  });
};

/**
 * Leave types the requester's schedule grants, with what is left this month.
 *
 * The form used to offer every type in the enum regardless of policy, so a
 * request could only fail after it had been filled in.
 */
export const useLeaveOptions = (userId?: string, month?: string) =>
  useQuery({
    queryKey: ["leave-options", userId ?? "me", month ?? "current"],
    queryFn: async () =>
      (await api.get<ApiResponse<LeaveOptions>>("/leaves/options", {
        params: { ...(userId ? { user: userId } : {}), ...(month ? { month } : {}) },
      })).data.data!,
    enabled: userId !== "",
  });
