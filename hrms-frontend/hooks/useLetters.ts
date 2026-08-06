"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, LetterTemplate, GeneratedLetter } from "@/types";

const TEMPLATES_KEY = ["letter-templates"] as const;
const GENERATED_KEY = ["generated-letters"] as const;

function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

// ── Templates ──────────────────────────────────────────────────────────────
export const useLetterTemplates = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...TEMPLATES_KEY, params],
    queryFn: async () => (await api.get<ApiResponse<LetterTemplate[]>>("/letters/templates", { params })).data.data ?? [],
  });

export const useCreateLetterTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<LetterTemplate>>("/letters/templates", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: TEMPLATES_KEY }); toast.success("Template created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create template")),
  });
};

export const useUpdateLetterTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<LetterTemplate>>(`/letters/templates/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: TEMPLATES_KEY }); toast.success("Template updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update template")),
  });
};

export const useDeleteLetterTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/letters/templates/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: TEMPLATES_KEY }); toast.success("Template removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove template")),
  });
};

// ── Generated letters ────────────────────────────────────────────────────
export const useGeneratedLetters = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...GENERATED_KEY, params],
    queryFn: async () => (await api.get<ApiResponse<GeneratedLetter[]>>("/letters/generated", { params })).data.data ?? [],
  });

/** Self-service — letters generated for the caller. */
export const useMyGeneratedLetters = () =>
  useQuery({
    queryKey: [...GENERATED_KEY, "mine"],
    queryFn: async () => (await api.get<ApiResponse<GeneratedLetter[]>>("/letters/generated/mine")).data.data ?? [],
  });

export const useGenerateLetter = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { employee: string; templateId: string; notes?: string }) => (await api.post<ApiResponse<GeneratedLetter>>("/letters/generated", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: GENERATED_KEY }); toast.success("Letter generated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to generate letter")),
  });
};

export const useDeleteGeneratedLetter = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/letters/generated/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: GENERATED_KEY }); toast.success("Letter removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove letter")),
  });
};
