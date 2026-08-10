"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Application, ApplicationStage, ApplicationStatus, Candidate, Pipeline } from "@/types";

const KEY = ["hiring"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useCandidates = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "candidates", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Candidate[]>>("/hiring/candidates", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useCandidate = (id?: string) =>
  useQuery({
    queryKey: [...KEY, "candidate", id],
    queryFn: async () => (await api.get<ApiResponse<Candidate>>(`/hiring/candidates/${id}`)).data.data!,
    enabled: !!id,
  });

export const usePipeline = (requisitionId?: string) =>
  useQuery({
    queryKey: [...KEY, "pipeline", requisitionId],
    queryFn: async () => (await api.get<ApiResponse<Pipeline>>(`/hiring/requisitions/${requisitionId}/pipeline`)).data.data!,
    enabled: !!requisitionId,
  });

export const useCreateCandidate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Candidate>) => {
      const res = await api.post<ApiResponse<Candidate>>("/hiring/candidates", data);
      return { record: res.data.data!, message: res.data.message };
    },
    // The server says when an email was already on file and the existing record
    // was updated instead — pass that through rather than a generic "added".
    onSuccess: ({ message }) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(message ?? "Candidate added"); },
    onError: (e) => toast.error(errMsg(e, "Could not save the candidate")),
  });
};

export const useApplyCandidate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { requisition: string; candidate: string; stage?: ApplicationStage }) =>
      (await api.post<ApiResponse<Application>>("/hiring/applications", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Added to the pipeline"); },
    onError: (e) => toast.error(errMsg(e, "Could not add them to the pipeline")),
  });
};

export const useMoveApplication = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; stage?: ApplicationStage; status?: ApplicationStatus; reason?: string; rating?: number | null; offeredSalary?: number | null }) =>
      (await api.patch<ApiResponse<Application>>(`/hiring/applications/${id}`, body)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e) => toast.error(errMsg(e, "Could not update the application")),
  });
};

export const useDeleteCandidate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hiring/candidates/${id}`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Candidate deleted"); },
    onError: (e) => toast.error(errMsg(e, "Could not delete the candidate")),
  });
};
