"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, DocumentsResponse, EmployeeOtherDocument } from "@/types";

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

/*
 * Free-form documents and credentials — anything the fixed passport/visa slots
 * don't cover. Administrator-only, like the passport and visa details they sit
 * beside, so there is no self-service variant.
 */

const otherKey = (employeeId: string) => ["documents", employeeId, "other"] as const;
const otherPath = (employeeId: string) => `/employees/${employeeId}/other-documents`;

export const useOtherDocuments = (employeeId: string, enabled = true) =>
  useQuery({
    queryKey: otherKey(employeeId),
    queryFn: async () =>
      (await api.get<ApiResponse<EmployeeOtherDocument[]>>(otherPath(employeeId))).data.data ?? [],
    enabled: enabled && !!employeeId,
  });

/** Details plus an optional file in one multipart request. */
function otherForm(input: OtherDocumentInput): FormData {
  const form = new FormData();
  for (const key of ["label", "number", "issueDate", "expiryDate", "notes"] as const) {
    const value = input[key];
    // Undefined leaves a field alone on update; "" clears it.
    if (value !== undefined) form.append(key, value ?? "");
  }
  if (input.file) form.append("file", input.file);
  return form;
}

export interface OtherDocumentInput {
  label?: string;
  number?: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
  file?: File | null;
}

/** Expiring entries feed the dashboard's renewal list, so that goes stale too. */
function afterOtherChange(qc: ReturnType<typeof useQueryClient>, employeeId: string) {
  qc.invalidateQueries({ queryKey: otherKey(employeeId) });
  qc.invalidateQueries({ queryKey: ["employees"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
}

export const useAddOtherDocument = (employeeId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OtherDocumentInput) =>
      (await api.post<ApiResponse<EmployeeOtherDocument[]>>(otherPath(employeeId), otherForm(input), {
        headers: { "Content-Type": undefined },
      })).data.data ?? [],
    onSuccess: () => { afterOtherChange(qc, employeeId); toast.success("Document added"); },
    onError: (e) => toast.error(errMsg(e, "Failed to add the document")),
  });
};

export const useUpdateOtherDocument = (employeeId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, ...input }: OtherDocumentInput & { recordId: string }) =>
      (await api.put<ApiResponse<EmployeeOtherDocument[]>>(`${otherPath(employeeId)}/${recordId}`, otherForm(input), {
        headers: { "Content-Type": undefined },
      })).data.data ?? [],
    onSuccess: () => { afterOtherChange(qc, employeeId); toast.success("Document updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update the document")),
  });
};

export const useDeleteOtherDocument = (employeeId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recordId: string) =>
      (await api.delete<ApiResponse<EmployeeOtherDocument[]>>(`${otherPath(employeeId)}/${recordId}`)).data.data ?? [],
    onSuccess: () => { afterOtherChange(qc, employeeId); toast.success("Document removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove the document")),
  });
};
