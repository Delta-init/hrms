"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, CompanyDocument, CompanyDocumentsResponse } from "@/types";

const KEY = ["documents", "company"] as const;
const PATH = "/documents/company";

function errMsg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export interface CompanyDocumentInput {
  companyName?: string;
  documentType?: string;
  number?: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
  file?: File | null;
}

/** Details plus an optional file in one multipart request. */
function toForm(input: CompanyDocumentInput): FormData {
  const form = new FormData();
  for (const key of ["companyName", "documentType", "number", "issueDate", "expiryDate", "notes"] as const) {
    const value = input[key];
    // Undefined leaves a field alone on update; "" clears it.
    if (value !== undefined) form.append(key, value ?? "");
  }
  if (input.file) form.append("file", input.file);
  return form;
}

/** Letting axios set the boundary itself is what `undefined` is for here. */
const MULTIPART = { headers: { "Content-Type": undefined } };

export const useCompanyDocuments = (params?: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () =>
      (await api.get<ApiResponse<CompanyDocumentsResponse>>(PATH, { params })).data.data!,
    enabled,
  });

/**
 * Every write invalidates the dashboard too: a company licence that has just
 * been renewed should stop being counted as expiring wherever it is counted.
 */
function useWrite<V>(fn: (v: V) => Promise<unknown>, done: string, fallback: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(done);
    },
    onError: (e: unknown) => toast.error(errMsg(e, fallback)),
  });
}

export const useAddCompanyDocument = () =>
  useWrite<CompanyDocumentInput>(
    async (input) => (await api.post<ApiResponse<CompanyDocument>>(PATH, toForm(input), MULTIPART)).data.data,
    "Document added",
    "Failed to add the document"
  );

export const useUpdateCompanyDocument = () =>
  useWrite<CompanyDocumentInput & { id: string }>(
    async ({ id, ...input }) =>
      (await api.put<ApiResponse<CompanyDocument>>(`${PATH}/${id}`, toForm(input), MULTIPART)).data.data,
    "Document updated",
    "Failed to update the document"
  );

export const useDeleteCompanyDocument = () =>
  useWrite<string>(
    async (id) => (await api.delete<ApiResponse<{ _id: string }>>(`${PATH}/${id}`)).data.data,
    "Document removed",
    "Failed to remove the document"
  );
