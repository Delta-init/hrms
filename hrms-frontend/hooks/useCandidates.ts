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

/** Offers waiting on management, surfaced as their own list. */
export const usePendingOffers = () =>
  useQuery({
    queryKey: [...KEY, "pending-offers"],
    queryFn: async () => (await api.get<ApiResponse<Application[]>>("/hiring/offers/pending")).data.data ?? [],
  });

export const useDecideOffer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
      (await api.patch<ApiResponse<Application>>(`/hiring/applications/${id}/offer`, { approve, note })).data.data!,
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(v.approve ? "Offer approved" : "Offer refused"); },
    onError: (e) => toast.error(errMsg(e, "Could not record the decision")),
  });
};

/** Attach a CV to somebody already on file. */
export const useUploadResume = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post<ApiResponse<Candidate>>(`/hiring/candidates/${id}/resume`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })).data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("CV attached"); },
    onError: (e) => toast.error(errMsg(e, "Could not upload the CV")),
  });
};
