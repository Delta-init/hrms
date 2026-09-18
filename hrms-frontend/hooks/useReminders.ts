"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Reminder } from "@/types";

const KEY = ["reminders"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

/** Reminders the caller created — self-service, no module permission required. */
export const useMyReminders = () =>
  useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<ApiResponse<Reminder[]>>("/reminders/mine")).data.data ?? [],
  });

export const useCreateReminder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Reminder>>("/reminders", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Reminder scheduled"); },
    onError: (e) => toast.error(errMsg(e, "Failed to schedule reminder")),
  });
};

export const useCancelReminder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/reminders/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Reminder cancelled"); },
    onError: (e) => toast.error(errMsg(e, "Failed to cancel reminder")),
  });
};
