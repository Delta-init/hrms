"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, AgreementState, InductionProgress, AgreementTemplateRow } from "@/types";

const KEY = ["agreements", "me"] as const;
const errMsg = (e: unknown, f: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;

export const useMyAgreements = (opts?: { enabled?: boolean }) =>
  useQuery({
    queryKey: KEY,
    enabled: opts?.enabled ?? true,
    queryFn: async () => (await api.get<ApiResponse<AgreementState>>("/agreements/me")).data.data!,
    // A missing template or an unclassified employee comes back as a 409 with
    // a message worth showing, so failures are not retried into a spinner.
    retry: false,
  });

export const useStartInduction = () =>
  useMutation({
    mutationFn: async () =>
      (await api.post<ApiResponse<{ video: { url: string; durationSeconds: number; title: string }; progress: InductionProgress }>>("/agreements/induction/start")).data.data!,
  });

/** Silent by design — it fires every few seconds and must never raise a toast. */
export const useInductionHeartbeat = () =>
  useMutation({
    mutationFn: async (position: number) =>
      (await api.post<ApiResponse<InductionProgress>>("/agreements/induction/heartbeat", { position })).data.data!,
  });

export const useSignAgreements = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { signaturePng: string; typedName: string }) =>
      (await api.post<ApiResponse<unknown>>("/agreements/sign", body)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agreements"] }); toast.success("Signed and sent to HR"); },
    onError: (e) => toast.error(errMsg(e, "Could not submit your signature")),
  });
};

// ── Administration ──
export const useAgreementTemplates = () =>
  useQuery({
    queryKey: ["agreements", "templates"],
    queryFn: async () =>
      (await api.get<ApiResponse<{ templates: AgreementTemplateRow[]; video: { title: string; durationSeconds: number; url: string } | null; unclassified: number }>>("/agreements/templates")).data.data!,
  });

export const useUploadTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, kind, variant }: { file: File; kind: string; variant: string }) => {
      const fd = new FormData();
      fd.append("file", file); fd.append("kind", kind); fd.append("variant", variant);
      return (await api.post<ApiResponse<unknown>>("/agreements/templates", fd)).data;
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["agreements"] }); toast.success(r.message ?? "Uploaded"); },
    onError: (e) => toast.error(errMsg(e, "Upload failed")),
  });
};

export const useUploadInductionVideo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return (await api.post<ApiResponse<unknown>>("/agreements/induction/video", fd)).data;
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["agreements"] }); toast.success(r.message ?? "Uploaded"); },
    onError: (e) => toast.error(errMsg(e, "Upload failed")),
  });
};
