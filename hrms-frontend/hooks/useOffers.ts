"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, OfferEmailTemplate, OfferThread } from "@/types";

const KEY = ["hiring", "offers"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useOfferTemplates = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "templates"],
    queryFn: async () => (await api.get<ApiResponse<OfferEmailTemplate[]>>("/hiring/offer-templates")).data.data ?? [],
    enabled,
  });

/** Offer letter templates — from Letters, readable by the hiring team. */
export const useOfferLetterTemplates = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "letter-templates"],
    queryFn: async () =>
      (await api.get<ApiResponse<Array<{ _id: string; name: string; subject?: string }>>>("/hiring/offer-letter-templates")).data.data ?? [],
    enabled,
  });

export const useOfferInbox = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "inbox"],
    queryFn: async () =>
      (await api.get<ApiResponse<{ mailbox: string | null; lastCheckedAt: string | null; lastError: string | null }>>("/hiring/offer-inbox")).data.data!,
    enabled,
    staleTime: 60_000,
  });

export const useSaveOfferTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<OfferEmailTemplate> & { id?: string }) =>
      id
        ? (await api.put<ApiResponse<OfferEmailTemplate>>(`/hiring/offer-templates/${id}`, data)).data.data!
        : (await api.post<ApiResponse<OfferEmailTemplate>>("/hiring/offer-templates", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...KEY, "templates"] }); toast.success("Template saved"); },
    onError: (e) => toast.error(errMsg(e, "Could not save the template")),
  });
};

export const useDeleteOfferTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/hiring/offer-templates/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...KEY, "templates"] }); toast.success("Template deleted"); },
    onError: (e) => toast.error(errMsg(e, "Could not delete the template")),
  });
};

export const usePreviewOffer = () =>
  useMutation({
    mutationFn: async ({ id, ...body }: { id: string; emailTemplate?: string | null; letterTemplate?: string | null; joiningDate?: string | null }) =>
      (await api.post<ApiResponse<{ to: string; subject: string; body: string; letterSubject: string; letterBody: string }>>(`/hiring/applications/${id}/offer/preview`, body)).data.data!,
    onError: (e) => toast.error(errMsg(e, "Could not fill in the templates")),
  });

export const useSendOffer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; subject: string; body: string; letterSubject?: string; letterBody?: string }) =>
      (await api.post<ApiResponse<null>>(`/hiring/applications/${id}/offer/send`, body)).data.message,
    // The pipeline card says the offer went, so it is stale too.
    onSuccess: (msg) => { qc.invalidateQueries({ queryKey: ["hiring"] }); toast.success(msg ?? "Offer sent"); },
    onError: (e) => toast.error(errMsg(e, "The offer could not be sent")),
  });
};

export const useOfferThread = (applicationId?: string) =>
  useQuery({
    queryKey: [...KEY, "thread", applicationId ?? ""],
    queryFn: async () => (await api.get<ApiResponse<OfferThread>>(`/hiring/applications/${applicationId}/offer/mails`)).data.data!,
    enabled: !!applicationId,
    // Replies arrive in the background; an open thread picks them up.
    refetchInterval: 60_000,
  });

export const useUploadSignedOffer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post<ApiResponse<OfferThread>>(`/hiring/applications/${id}/offer/signed`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })).data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hiring"] }); toast.success("Signed offer saved"); },
    onError: (e) => toast.error(errMsg(e, "Could not save the signed offer")),
  });
};
