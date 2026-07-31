"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, OnboardingTemplate, OnboardingChecklist } from "@/types";

const TEMPLATES_KEY = ["onboarding-templates"] as const;
const CHECKLISTS_KEY = ["onboarding-checklists"] as const;
const MY_KEY = ["onboarding-my-tasks"] as const;

function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidateTemplates = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
const invalidateChecklists = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: CHECKLISTS_KEY });

// ── Templates ──────────────────────────────────────────────────────────────
export const useOnboardingTemplates = () =>
  useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => (await api.get<ApiResponse<OnboardingTemplate[]>>("/onboarding/templates")).data.data ?? [],
  });

export const useCreateOnboardingTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<OnboardingTemplate>>("/onboarding/templates", data)).data.data!,
    onSuccess: () => { invalidateTemplates(qc); toast.success("Template created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create template")),
  });
};

export const useUpdateOnboardingTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<OnboardingTemplate>>(`/onboarding/templates/${id}`, data)).data.data!,
    onSuccess: () => { invalidateTemplates(qc); toast.success("Template updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update template")),
  });
};

export const useDeleteOnboardingTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/onboarding/templates/${id}`); },
    onSuccess: () => { invalidateTemplates(qc); toast.success("Template removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove template")),
  });
};

// ── Checklists ────────────────────────────────────────────────────────────
export const useOnboardingChecklists = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...CHECKLISTS_KEY, params],
    queryFn: async () => (await api.get<ApiResponse<OnboardingChecklist[]>>("/onboarding/checklists", { params })).data.data ?? [],
  });

export const useCreateOnboardingChecklist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { employee: string; templateId: string }) => (await api.post<ApiResponse<OnboardingChecklist>>("/onboarding/checklists", data)).data.data!,
    onSuccess: () => { invalidateChecklists(qc); toast.success("Checklist created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create checklist")),
  });
};

export const useDeleteOnboardingChecklist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/onboarding/checklists/${id}`); },
    onSuccess: () => { invalidateChecklists(qc); toast.success("Checklist removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove checklist")),
  });
};

export const useSetOnboardingTaskStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ checklistId, taskId, status }: { checklistId: string; taskId: string; status: "pending" | "completed" }) =>
      (await api.patch<ApiResponse<OnboardingChecklist>>(`/onboarding/checklists/${checklistId}/tasks/${taskId}`, { status })).data.data!,
    onSuccess: () => invalidateChecklists(qc),
    onError: (e) => toast.error(errMsg(e, "Failed to update task")),
  });
};

// ── Self-service ("my tasks") ────────────────────────────────────────────
export const useMyOnboardingChecklist = () =>
  useQuery({
    queryKey: MY_KEY,
    queryFn: async () => (await api.get<ApiResponse<OnboardingChecklist | null>>("/onboarding/my-tasks")).data.data ?? null,
  });

export const useSetMyOnboardingTaskStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: "pending" | "completed" }) =>
      (await api.patch<ApiResponse<OnboardingChecklist>>(`/onboarding/my-tasks/${taskId}`, { status })).data.data!,
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_KEY }),
    onError: (e) => toast.error(errMsg(e, "Failed to update task")),
  });
};
