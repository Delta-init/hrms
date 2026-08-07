"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, DocumentsResponse } from "@/types";

/**
 * Employee documents — the caller's own, or someone else's.
 *
 * Passing an `employeeId` switches to the administrator endpoints, which need
 * the employees permission; leaving it out is self-service and needs nothing
 * beyond being signed in. Both sides return the same shape, so the upload UI
 * doesn't care which one it is talking to.
 */
const keyFor = (employeeId?: string) => ["documents", employeeId ?? "me"] as const;
const pathFor = (employeeId?: string) => (employeeId ? `/employees/${employeeId}/documents` : "/auth/documents");

function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useDocuments = (employeeId?: string, enabled = true) =>
  useQuery({
    queryKey: keyFor(employeeId),
    queryFn: async () => (await api.get<ApiResponse<DocumentsResponse>>(pathFor(employeeId))).data.data!,
    enabled,
  });

/** Self-service alias, used by the onboarding flow. */
export const useMyDocuments = (enabled = true) => useDocuments(undefined, enabled);

export const useUploadDocument = (employeeId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, file }: { type: string; file: File }) => {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file);
      const res = await api.post<ApiResponse<DocumentsResponse>>(pathFor(employeeId), form, {
        headers: { "Content-Type": undefined }, // let the browser set the multipart boundary
      });
      return res.data.data!;
    },
    onSuccess: (data) => {
      qc.setQueryData(keyFor(employeeId), data);
      // The photo slot doubles as the profile picture, so the employee record
      // is stale either way — self-service writes to the caller's own record,
      // which is what feeds their avatar.
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Document uploaded");
    },
    onError: (e) => toast.error(errMsg(e, "Upload failed")),
  });
};

export const useDeleteDocument = (employeeId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (type: string) =>
      (await api.delete<ApiResponse<DocumentsResponse>>(`${pathFor(employeeId)}/${type}`)).data.data!,
    onSuccess: (data) => {
      qc.setQueryData(keyFor(employeeId), data);
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Document removed");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to remove document")),
  });
};
