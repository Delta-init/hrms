"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type {
  ApiResponse, ApprovalDetail, ApprovalInbox, ApprovalModule, ApprovalSummary, BulkDecideResult,
} from "@/types";

const KEY = ["approvals"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

/**
 * Everything waiting, or everything already decided, across every organisation.
 *
 * Deliberately unscoped: the point of this console is that somebody running
 * several tenants does not have to remember which one a request came from to
 * find out it is waiting. The API restricts it to a Super Admin.
 */
export const useApprovalInbox = (params: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "inbox", params],
    queryFn: async () => (await api.get<ApiResponse<ApprovalInbox>>("/approvals", { params })).data.data!,
    // A queue read by several people at once goes stale quickly, and acting on
    // a stale row is the failure that matters here.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

/**
 * Counts only, for the dashboard card.
 *
 * `enabled` because the dashboard renders for everyone and this endpoint is
 * management-only — asking anyway would put a 403 in every other user's console
 * on every page load.
 */
export const useApprovalSummary = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "summary"],
    queryFn: async () => (await api.get<ApiResponse<ApprovalSummary>>("/approvals/summary")).data.data!,
    enabled,
    staleTime: 60_000,
  });

/** The whole record behind one row, fetched only when the panel opens. */
export const useApprovalDetail = (module: ApprovalModule | null, id: string | null) =>
  useQuery({
    queryKey: [...KEY, "detail", module, id],
    queryFn: async () =>
      (await api.get<ApiResponse<ApprovalDetail>>(`/approvals/${module}/${id}`)).data.data!,
    enabled: !!module && !!id,
  });

export const useDecideApproval = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { module: ApprovalModule; id: string; approve: boolean; note?: string }) =>
      (await api.patch<ApiResponse<unknown>>(`/approvals/${v.module}/${v.id}`, {
        approve: v.approve, note: v.note || undefined,
      })).data,
    onSuccess: (_d, v) => {
      // Every module this touches has its own cached lists elsewhere in the app.
      qc.invalidateQueries();
      toast.success(v.approve ? "Approved" : "Rejected");
    },
    // Each module's own rules still apply — a reviewer who does not hold the
    // current step, or who raised the request themselves, is refused by name.
    onError: (e) => toast.error(errMsg(e, "Could not record the decision")),
  });
};

export const useBulkDecideApprovals = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { module: ApprovalModule; ids: string[]; approve: boolean; note: string }) =>
      (await api.post<ApiResponse<BulkDecideResult>>("/approvals/bulk", v)).data.data!,
    onSuccess: (result, v) => {
      qc.invalidateQueries();
      // Partial failure is said out loud. "12 approved" while three quietly
      // failed is worse than not offering the bulk action at all.
      if (result.failed.length) {
        toast.error(`${result.succeeded} of ${result.requested} done — ${result.failed.length} could not be`);
      } else {
        toast.success(`${result.succeeded} ${v.approve ? "approved" : "rejected"}`);
      }
    },
    onError: (e) => toast.error(errMsg(e, "Could not record the decisions")),
  });
};
