"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Regularization, RegularizationOutcome } from "@/types";

const KEY = ["regularizations"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

/** `enabled` guards the call on the caller's `view` permission — without it the
 *  query still ran for people who cannot read the module, 403ing every load. */
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
export const useMyRegularizationAllowance = () =>
  useQuery({
    queryKey: [...KEY, "mine", "allowance"],
    queryFn: async () =>
      (await api.get<ApiResponse<{ used: number; limit: number; remaining: number; nextNeedsManager: boolean; managerId: string | null }>>(
        "/regularizations/mine/allowance"
      )).data.data!,
  });

export const useCreateRegularization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Regularization>>("/regularizations", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Regularization submitted"); },
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
