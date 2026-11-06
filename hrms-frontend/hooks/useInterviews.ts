"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type {
  ApiResponse, Interview, InterviewFeedback, InterviewSheetPage, MyInterview, PanelConflict, Recommendation,
} from "@/types";

const KEY = ["hiring"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useInterviews = (params?: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "interviews", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Interview[]>>("/hiring/interviews", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled,
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

// ── The panellist's sheet ────────────────────────────────────────────────────

/** The interviews this person sits on. Empty for most people, who are on no panel. */
export const useMyInterviews = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "my-interviews"],
    queryFn: async () => (await api.get<ApiResponse<MyInterview[]>>("/hiring/my-interviews")).data.data ?? [],
    enabled,
    staleTime: 60 * 1000,
  });

export const useMySheet = (id?: string) =>
  useQuery({
    queryKey: [...KEY, "my-sheet", id],
    queryFn: async () => (await api.get<ApiResponse<InterviewSheetPage>>(`/hiring/my-interviews/${id}`)).data.data!,
    enabled: !!id,
    // Typing is happening on this page; a refetch on refocus would put the
    // server's copy back over what is in the boxes.
    refetchOnWindowFocus: false,
  });

export interface SaveSheetBody {
  answers: Array<{ questionId: string; response: string; marks: number | null }>;
  recommendation: Recommendation | null;
  notes: string;
  submit: boolean;
}

/**
 * Save the sheet — quietly for a draft, which happens on its own while they
 * type; with a toast for a submit, which is the step they took on purpose.
 */
export const useSaveSheet = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: SaveSheetBody & { id: string }) =>
      (await api.put<ApiResponse<InterviewSheetPage>>(`/hiring/my-interviews/${id}`, body)).data.data!,
    onSuccess: (data, v) => {
      qc.setQueryData([...KEY, "my-sheet", v.id], data);
      if (v.submit) {
        qc.invalidateQueries({ queryKey: [...KEY, "my-interviews"] });
        qc.invalidateQueries({ queryKey: [...KEY, "interview-results"] });
        toast.success("Interview sheet submitted");
      }
    },
    onError: (e, v) => { if (v.submit) toast.error(errMsg(e, "Could not submit the sheet")); },
  });
};
