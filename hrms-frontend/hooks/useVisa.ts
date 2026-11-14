"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, MyVisaStatus, VisaOutstanding, VisaSubmissionRow } from "@/types";

const KEY = ["visas"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

/** Whether the visa popup must show for the person signed in. */
export const useMyVisa = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "me"],
    queryFn: async () => (await api.get<ApiResponse<MyVisaStatus>>("/visas/me")).data.data!,
    enabled,
    staleTime: 5 * 60_000,
  });

export const useSubmitMyVisa = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, expiryDate, file }: { kind: "visa" | "renewal"; expiryDate?: string; file: File }) => {
      const form = new FormData();
      form.append("kind", kind);
      if (expiryDate) form.append("expiryDate", expiryDate);
      form.append("file", file);
      return (await api.post<ApiResponse<MyVisaStatus>>("/visas/me", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (res) => { qc.setQueryData([...KEY, "me"], res.data); toast.success("Sent to HR for checking"); },
    onError: (e) => toast.error(errMsg(e, "Could not send your visa")),
  });
};

// ── HR ──
export const useVisaSubmissions = (status: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "submissions", status ?? "all"],
    queryFn: async () => (await api.get<ApiResponse<{ pending: number; rows: VisaSubmissionRow[] }>>("/visas/submissions", { params: status ? { status } : {} })).data.data!,
    enabled,
  });

export const useVisaPendingCount = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "pending-count"],
    queryFn: async () => (await api.get<ApiResponse<{ pending: number }>>("/visas/pending-count")).data.data?.pending ?? 0,
    enabled,
    staleTime: 60_000,
  });

export const useVisaOutstanding = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "outstanding"],
    queryFn: async () => (await api.get<ApiResponse<VisaOutstanding>>("/visas/outstanding")).data.data!,
    enabled,
  });

const useDecision = <V,>(fn: (v: V) => Promise<{ message?: string }>, fallback: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(res.message ?? "Saved");
    },
    onError: (e) => toast.error(errMsg(e, fallback)),
  });
};

export const useApproveVisa = () =>
  useDecision(async (id: string) => (await api.post<ApiResponse<unknown>>(`/visas/submissions/${id}/approve`)).data, "Could not approve it");

export const useReturnVisa = () =>
  useDecision(async ({ id, note }: { id: string; note: string }) => (await api.post<ApiResponse<unknown>>(`/visas/submissions/${id}/reject`, { note })).data, "Could not send it back");

export const useSetVisaNotRequired = () =>
  useDecision(async ({ employeeId, notRequired }: { employeeId: string; notRequired: boolean }) =>
    (await api.put<ApiResponse<unknown>>(`/visas/not-required/${employeeId}`, { notRequired })).data, "Could not save that");
