"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Interview, InterviewFeedback, PanelConflict, Recommendation } from "@/types";

const KEY = ["hiring"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useInterviews = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "interviews", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Interview[]>>("/hiring/interviews", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useInterview = (id?: string) =>
  useQuery({
    queryKey: [...KEY, "interview", id],
    queryFn: async () => (await api.get<ApiResponse<Interview>>(`/hiring/interviews/${id}`)).data.data!,
    enabled: !!id,
  });

/**
 * Who on the panel is already booked at that time.
 *
 * Only against interviews this system scheduled — an `.ics` invite cannot read
 * anyone's calendar — so it warns rather than blocks.
 */
export const usePanelConflicts = (panel: string[], scheduledAt: string, durationMinutes: number, exclude?: string) =>
  useQuery({
    queryKey: [...KEY, "conflicts", panel.join(","), scheduledAt, durationMinutes, exclude],
    queryFn: async () =>
      (await api.get<ApiResponse<PanelConflict[]>>("/hiring/interviews/conflicts", {
        params: { panel: panel.join(","), scheduledAt, durationMinutes, ...(exclude ? { exclude } : {}) },
      })).data.data ?? [],
    enabled: panel.length > 0 && !!scheduledAt,
  });

export const useScheduleInterview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await api.post<ApiResponse<Interview>>("/hiring/interviews", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Interview scheduled — invites sent"); },
    onError: (e) => toast.error(errMsg(e, "Could not schedule the interview")),
  });
};

export const useUpdateInterview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      (await api.put<ApiResponse<Interview>>(`/hiring/interviews/${id}`, body)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Interview updated"); },
    onError: (e) => toast.error(errMsg(e, "Could not update the interview")),
  });
};

export const useCancelInterview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch<ApiResponse<Interview>>(`/hiring/interviews/${id}/cancel`)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Interview cancelled — the calendar entry is withdrawn"); },
    onError: (e) => toast.error(errMsg(e, "Could not cancel the interview")),
  });
};

export const useSubmitFeedback = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; recommendation: Recommendation; scores?: { skill: string; rating: number }[]; notes?: string }) =>
      (await api.post<ApiResponse<InterviewFeedback>>(`/hiring/interviews/${id}/feedback`, body)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Feedback recorded"); },
    onError: (e) => toast.error(errMsg(e, "Could not record your feedback")),
  });
};
