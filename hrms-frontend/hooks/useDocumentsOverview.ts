"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, DocumentRef, DocumentsOverview } from "@/types";

/** Every document the organization should hold, present or missing. */
export const useDocumentsOverview = (params?: Record<string, string>) =>
  useQuery({
    queryKey: ["documents", "overview", params],
    queryFn: async () =>
      (await api.get<ApiResponse<DocumentsOverview>>("/documents", { params })).data.data!,
  });

/**
 * Stop counting the selected documents, or start again.
 *
 * Both invalidate the overview *and* the dashboard: the expiry card counts the
 * same documents by a different route, and leaving it stale would show a figure
 * the documents page has just contradicted.
 */
function useIgnoreMutation(path: "ignore" | "unignore", done: (n: number) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { items: DocumentRef[]; reason?: string }) =>
      (await api.post<ApiResponse<{ ignored?: number; restored?: number }>>(`/documents/${path}`, vars)).data.data!,
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(done(data?.ignored ?? data?.restored ?? vars.items.length));
    },
    onError: (e: unknown) =>
      toast.error(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "That did not work"
      ),
  });
}

export const useIgnoreDocuments = () =>
  useIgnoreMutation("ignore", (n) => `${n} document${n === 1 ? "" : "s"} will no longer be counted`);

export const useUnignoreDocuments = () =>
  useIgnoreMutation("unignore", (n) => `${n} document${n === 1 ? "" : "s"} back in the counts`);
