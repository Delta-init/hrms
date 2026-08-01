"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Survey, SurveyResponse, SurveyResults, SurveyStatus, SurveyAnswer } from "@/types";
import type { SurveyFormValues } from "@/lib/validations/surveySchema";

const KEY = ["surveys"] as const;
const MINE_KEY = ["surveys-mine"] as const;

function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

// ── Admin ────────────────────────────────────────────────────────────────────
export const useSurveys = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<ApiResponse<Survey[]>>("/surveys")).data.data ?? [],
    enabled: options?.enabled ?? true,
  });

export const useSurveyResults = (id: string | null) =>
  useQuery({
    queryKey: [...KEY, id, "results"],
    queryFn: async () => (await api.get<ApiResponse<SurveyResults>>(`/surveys/${id}/results`)).data.data!,
    enabled: !!id,
  });

export const useCreateSurvey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: SurveyFormValues) => (await api.post<ApiResponse<Survey>>("/surveys", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Survey created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create survey")),
  });
};

export const useUpdateSurvey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: SurveyFormValues }) =>
      (await api.put<ApiResponse<Survey>>(`/surveys/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Survey updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update survey")),
  });
};

export const useSetSurveyStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SurveyStatus }) =>
      (await api.patch<ApiResponse<Survey>>(`/surveys/${id}/status`, { status })).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: MINE_KEY });
      toast.success("Survey status updated");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to update status")),
  });
};

export const useDeleteSurvey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/surveys/${id}`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: MINE_KEY });
      toast.success("Survey deleted");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to delete survey")),
  });
};

// ── Self-service ─────────────────────────────────────────────────────────────
export const useMySurveys = () =>
  useQuery({
    queryKey: MINE_KEY,
    queryFn: async () => (await api.get<ApiResponse<Survey[]>>("/surveys/mine")).data.data ?? [],
  });

export const useSubmitSurveyResponse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, answers }: { id: string; answers: SurveyAnswer[] }) =>
      (await api.post<ApiResponse<SurveyResponse>>(`/surveys/${id}/responses`, { answers })).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: MINE_KEY }); toast.success("Response submitted — thank you!"); },
    onError: (e) => toast.error(errMsg(e, "Failed to submit response")),
  });
};
