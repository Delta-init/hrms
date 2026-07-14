"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, DocumentsResponse } from "@/types";

const KEY = ["my-documents"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useMyDocuments = (enabled = true) =>
  useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<ApiResponse<DocumentsResponse>>("/auth/documents")).data.data!,
    enabled,
  });

export const useUploadDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, file }: { type: string; file: File }) => {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file);
      const res = await api.post<ApiResponse<DocumentsResponse>>("/auth/documents", form, {
        headers: { "Content-Type": undefined }, // let the browser set the multipart boundary
      });
      return res.data.data!;
    },
    onSuccess: (data) => { qc.setQueryData(KEY, data); toast.success("Document uploaded"); },
    onError: (e) => toast.error(errMsg(e, "Upload failed")),
  });
};

export const useDeleteDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (type: string) =>
      (await api.delete<ApiResponse<DocumentsResponse>>(`/auth/documents/${type}`)).data.data!,
    onSuccess: (data) => { qc.setQueryData(KEY, data); toast.success("Document removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove document")),
  });
};
