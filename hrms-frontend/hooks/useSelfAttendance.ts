"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, AttendanceToday, PunchClientContext } from "@/types";

const TODAY_KEY = ["attendance", "today"] as const;
const MINE_KEY = ["attendance", "mine"] as const;

function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useTodayAttendance = () =>
  useQuery({
    queryKey: TODAY_KEY,
    queryFn: async () => (await api.get<ApiResponse<AttendanceToday>>("/attendance/today")).data.data!,
    refetchInterval: 60_000, // keep the window/thresholds fresh
    refetchOnWindowFocus: true,
  });

export const useMyAttendance = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...MINE_KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<import("@/types").Attendance[]>>("/attendance/mine", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useClockIn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ctx?: PunchClientContext) =>
      (await api.post<ApiResponse<unknown>>("/attendance/clock-in", ctx ?? {})).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance"] }); toast.success("Clocked in ✅"); },
    onError: (e) => toast.error(errMsg(e, "Could not clock in")),
  });
};

export const useClockOut = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ctx?: PunchClientContext) =>
      (await api.post<ApiResponse<unknown>>("/attendance/clock-out", ctx ?? {})).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance"] }); toast.success("Clocked out 👋"); },
    onError: (e) => toast.error(errMsg(e, "Could not clock out")),
  });
};
