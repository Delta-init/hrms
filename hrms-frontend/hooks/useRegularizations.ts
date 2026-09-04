"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, MissedRegularizationDay, Regularization, RegularizationOutcome } from "@/types";

const KEY = ["regularizations"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

/** `enabled` guards the call on the caller's `view` permission — without it the
 *  query still ran for people who cannot read the module, 403ing every load. */
/**
 * How many corrections are waiting on a decision.
 *
 * Same shape and same caching as the leave count: it sits in the sidebar on
 * every page, so a queue length a minute old is worth what a current one is.
 */
export const usePendingRegularizationCount = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "pending-count"],
    queryFn: async () =>
      (await api.get<ApiResponse<{ count: number }>>("/regularization/pending-count")).data.data?.count ?? 0,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

export const useRegularizations = (params?: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Regularization[]>>("/regularizations", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled,
  });

export const useMyRegularizations = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "mine", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Regularization[]>>("/regularizations/mine", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

/**
 * How many corrections the caller has left this month.
 *
 * Fetched separately from the list because it is about the person, not the
 * page: the count includes requests that are already approved and no longer on
 * screen, and recomputing it from the visible rows would understate it.
 */
export const useMyRegularizationAllowance = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "mine", "allowance"],
    queryFn: async () =>
      (await api.get<ApiResponse<{ used: number; limit: number; remaining: number; blocked: boolean }>>(
        "/regularizations/mine/allowance"
      )).data.data!,
    enabled,
  });

/**
 * This month's own days worth a second look — the same list the weekend
 * reminder mail sends. Drives the dashboard prompt.
 */
export const useMyMissedRegularizations = () =>
  useQuery({
    queryKey: [...KEY, "mine", "missed"],
    queryFn: async () =>
      (await api.get<ApiResponse<MissedRegularizationDay[]>>("/regularizations/mine/missed")).data.data ?? [],
  });

export interface CreateRegularizationResult {
  record: Regularization;
  /** Whether the department head (or reporting manager) actually got mailed — false where neither is set. */
  mailedDepartmentHead: boolean;
  mailedHr: boolean;
}

export const useCreateRegularization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await api.post<ApiResponse<CreateRegularizationResult>>("/regularizations", data)).data.data!,
    // No toast here — the dialog shows a popup with exactly who got mailed,
    // which a generic "submitted" toast would only repeat less usefully.
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e) => toast.error(errMsg(e, "Failed to submit regularization")),
  });
};

export const useUpdateRegularization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Regularization>>(`/regularizations/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["attendance"] }); toast.success("Regularization updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update regularization")),
  });
};

/** Approve/reject — separate from update, which no longer accepts a status. */
export const useReviewRegularization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { status: "approved" | "rejected"; reviewNote?: string | null; resultingStatus?: RegularizationOutcome } }) =>
      (await api.patch<ApiResponse<Regularization>>(`/regularizations/${id}/review`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["attendance"] }); toast.success("Regularization reviewed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to review regularization")),
  });
};

export const useDeleteRegularization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/regularizations/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Regularization deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete regularization")),
  });
};
