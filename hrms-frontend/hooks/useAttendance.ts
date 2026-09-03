"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Attendance, AttendanceCalendarData, DailyAttendanceData } from "@/types";

const KEY = ["attendance"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useAttendanceCalendar = (month: string, employee?: string) =>
  useQuery({
    queryKey: [...KEY, "calendar", month, employee ?? "all"],
    queryFn: async () => (await api.get<ApiResponse<AttendanceCalendarData>>("/attendance/calendar", { params: { month, ...(employee ? { employee } : {}) } })).data.data!,
    enabled: !!month,
  });

/** Everybody's status on one day. Kept fresh — it is a "right now" screen. */
export const useAttendanceDaily = (date: string, employee?: string) =>
  useQuery({
    queryKey: [...KEY, "daily", date, employee ?? "all"],
    queryFn: async () => (await api.get<ApiResponse<DailyAttendanceData>>("/attendance/daily", { params: { date, ...(employee ? { employee } : {}) } })).data.data!,
    enabled: !!date,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

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

/**
 * One record, in full.
 *
 * The day view lists people rather than records — most rows have no record at
 * all — so it holds an id, not the thing itself. Editing loads the real record
 * rather than assembling one from the row, which would drift from the dialog's
 * expectations the moment either changed.
 */
export const useAttendanceById = (id?: string) =>
  useQuery({
    queryKey: [...KEY, "one", id ?? ""],
    queryFn: async () => (await api.get<ApiResponse<Attendance>>(`/attendance/${id}`)).data.data!,
    enabled: !!id,
  });

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

/**
 * Set the status on several days at once.
 *
 * The whole list is invalidated rather than the touched rows patched: a status
 * change moves the "today at a glance" counts above the table as well, and
 * those are a second query over the same records.
 */
export const useBulkSetAttendanceStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const res = await api.patch<ApiResponse<{ matched: number; modified: number }>>("/attendance/bulk-status", { ids, status });
      return res.data;
    },
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(res.message ?? "Attendance updated"); },
    onError: (e) => toast.error(errMsg(e, "Could not update those records")),
  });
};

/**
 * Set one day's status for several people, record or no record.
 *
 * The bulk endpoint above takes record ids, so it cannot touch the people this
 * is usually wanted for: a day nobody clocked into has no record and therefore
 * no id. This addresses them by employee and day, and the server creates what
 * is missing.
 */
export const useSetDayStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { employees: string[]; date: string; status: string; note?: string }) => {
      const res = await api.patch<ApiResponse<{ matched: number; modified: number; created: number; skipped: number }>>(
        "/attendance/day-status",
        input
      );
      return res.data;
    },
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(res.message ?? "Attendance updated"); },
    onError: (e) => toast.error(errMsg(e, "Could not set that status")),
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
