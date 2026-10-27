"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Procurement } from "@/types";

const KEY = ["procurement"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

export const useProcurements = (params?: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Procurement[]>>("/procurement", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled,
  });

/** How many in each status and their estimated cost, with the list's filters (2026-10-23). */
export interface ProcurementSummary {
  total: number;
  byStatus: { status: Procurement["status"]; count: number; costs: { currency: string; amount: number }[] }[];
}
export const useProcurementSummary = (params?: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "summary", params],
    queryFn: async () => (await api.get<ApiResponse<ProcurementSummary>>("/procurement/summary", { params })).data.data!,
    enabled,
    retry: false,
  });

export const useCreateProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Procurement>>("/procurement", data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Procurement added"); },
    onError: (e) => toast.error(errMsg(e, "Failed to add procurement")),
  });
};

export const useUpdateProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.put<ApiResponse<Procurement>>(`/procurement/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Procurement updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update procurement")),
  });
};

/** HR's decision: send it on to finance, or refuse it. */
export const useReviewProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: "approve" | "reject"; note?: string }) =>
      (await api.patch<ApiResponse<Procurement>>(`/procurement/${id}/review`, { decision, note })).data.data!,
    onSuccess: (_d, v) => { invalidate(qc); toast.success(v.decision === "approve" ? "Sent to finance" : "Request rejected"); },
    onError: (e) => toast.error(errMsg(e, "Failed to record the decision")),
  });
};

/** Revise a refused request and send it round again. */
export const useResubmitProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.patch<ApiResponse<Procurement>>(`/procurement/${id}/resubmit`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Resubmitted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to resubmit")),
  });
};

export const useDeleteProcurement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/procurement/${id}`); },
    onSuccess: () => { invalidate(qc); toast.success("Procurement removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove procurement")),
  });
};

/** A quote, spec sheet or photo — attached by the requester or their department head. */
export const useUploadProcurementReport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post<ApiResponse<Procurement>>(`/procurement/${id}/report`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })).data.data!;
    },
    onSuccess: () => { invalidate(qc); toast.success("Report attached"); },
    onError: (e) => toast.error(errMsg(e, "Could not upload the report")),
  });
};

// ── Ledger: received, given out, left ──

/** One item on the shelf — every purchase of it added together. */
export interface LedgerRow {
  key: string;
  item: string;
  category: string;
  received: number;
  onOrder: number;
  givenOut: number;
  available: number;
  lastIn: string | null;
  lastOut: string | null;
}
export interface LedgerEntry {
  kind: "received" | "on_order" | "given_out";
  id: string;
  date: string;
  quantity: number;
  /** What was left after this entry — null for an order that has not arrived. */
  balance: number | null;
  who?: string;
  department?: string;
  note?: string;
  by?: string;
  vendor?: string;
}
export interface LedgerItem { item: string; key: string; totals: LedgerRow | null; entries: LedgerEntry[] }

export const useProcurementLedger = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "ledger"],
    queryFn: async () => (await api.get<ApiResponse<LedgerRow[]>>("/procurement/ledger")).data.data ?? [],
    enabled,
  });

export const useProcurementLedgerItem = (key: string | null) =>
  useQuery({
    queryKey: [...KEY, "ledger", "item", key],
    queryFn: async () => (await api.get<ApiResponse<LedgerItem>>("/procurement/ledger/item", { params: { key } })).data.data!,
    enabled: !!key,
  });

export const useGiveOut = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { item: string; quantity: number; employee?: string; department?: string; date?: string; note?: string }) =>
      (await api.post<ApiResponse<{ item: string; given: number; available: number }>>("/procurement/ledger/give-out", data)).data.data!,
    onSuccess: (r) => { invalidate(qc); toast.success(`Given out — ${r.available} ${r.item} left`); },
    onError: (e) => toast.error(errMsg(e, "Could not give it out")),
  });
};

export const useRemoveGiveOut = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/procurement/ledger/give-out/${id}`)).data,
    onSuccess: () => { invalidate(qc); toast.success("Entry removed — back in stock"); },
    onError: (e) => toast.error(errMsg(e, "Could not remove the entry")),
  });
};
