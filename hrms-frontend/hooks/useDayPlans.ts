"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, DayPlanDayView, DayPlanRoutine, DayPlanRoutineItem } from "@/types";

/* Day plans (2026-11-26): HR's routines, and each person's own day by the clock. */

const KEY = ["tasks", "day-plans"] as const;
const MINE = ["tasks", "my-day"] as const;
const errMsg = (e: unknown, f: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;

export const useDayPlans = (enabled = true) =>
  useQuery({ queryKey: [...KEY, "list"], queryFn: async () => (await api.get<ApiResponse<DayPlanRoutine[]>>("/tasks/day-plans")).data.data ?? [], enabled });

export const usePlanDay = (id?: string | null, date?: string) =>
  useQuery({
    queryKey: [...KEY, "day", id, date ?? "today"],
    queryFn: async () => (await api.get<ApiResponse<{ date: string; day: DayPlanDayView | null }>>(`/tasks/day-plans/${id}/day`, { params: date ? { date } : {} })).data.data!,
    enabled: !!id,
  });

export interface RoutineInput {
  name: string; employee: string; weekdays: number[]; startAt: string; roundEveryMins: number;
  items: DayPlanRoutineItem[]; active?: boolean;
}

export const useSaveDayPlan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id?: string; data: RoutineInput }) =>
      (id ? await api.put<ApiResponse<DayPlanRoutine>>(`/tasks/day-plans/${id}`, data) : await api.post<ApiResponse<DayPlanRoutine>>("/tasks/day-plans", data)).data,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(r.message ?? "Saved"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't save the day plan")),
  });
};

export const useMyDay = (enabled = true) =>
  useQuery({ queryKey: [...MINE], queryFn: async () => (await api.get<ApiResponse<DayPlanDayView[]>>("/tasks/my-day")).data.data ?? [], enabled, staleTime: 30_000 });

/**
 * Every change to his day goes through here: the server answers with the whole day re-timed, which replaces the
 * cached one, so times shown are always the server's.
 */
export const useDayAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ method, url, body }: { method: "patch" | "post" | "put" | "delete"; url: string; body?: unknown; quiet?: boolean; message?: string }) =>
      (await api.request<ApiResponse<DayPlanDayView>>({ method, url: `/tasks/my-day/${url}`, data: body })).data.data!,
    onSuccess: (day, v) => {
      qc.setQueryData<DayPlanDayView[]>([...MINE], (days) => (days ?? []).map((d) => (d._id === day._id ? { ...day, planName: d.planName } : d)));
      qc.invalidateQueries({ queryKey: KEY });
      if (v.message) toast.success(v.message);
    },
    onError: (e) => { toast.error(errMsg(e, "Couldn't save that")); qc.invalidateQueries({ queryKey: [...MINE] }); },
  });
};
