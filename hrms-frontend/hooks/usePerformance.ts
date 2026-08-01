"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type {
  ApiResponse, PerformanceCycle, PerformanceCycleStatus, Appraisal, AppraisalGoal,
} from "@/types";
import type { CycleFormValues } from "@/lib/validations/performanceSchema";

const CYCLES_KEY = ["performance-cycles"] as const;
const APPRAISALS_KEY = ["performance-appraisals"] as const;
const MINE_KEY = ["performance-mine"] as const;

function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

// ── Cycles (admin) ────────────────────────────────────────────────────────────
export const useCycles = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: CYCLES_KEY,
    queryFn: async () => (await api.get<ApiResponse<PerformanceCycle[]>>("/performance/cycles")).data.data ?? [],
    enabled: options?.enabled ?? true,
  });

export const useCreateCycle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CycleFormValues) => (await api.post<ApiResponse<PerformanceCycle>>("/performance/cycles", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: CYCLES_KEY }); toast.success("Cycle created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create cycle")),
  });
};

export const useSetCycleStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PerformanceCycleStatus }) =>
      (await api.patch<ApiResponse<PerformanceCycle>>(`/performance/cycles/${id}/status`, { status })).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CYCLES_KEY });
      qc.invalidateQueries({ queryKey: APPRAISALS_KEY });
      qc.invalidateQueries({ queryKey: MINE_KEY });
      toast.success("Cycle status updated");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to update cycle status")),
  });
};

export const useDeleteCycle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/performance/cycles/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CYCLES_KEY }); toast.success("Cycle deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete cycle")),
  });
};

// ── Appraisals (admin / manager review) ───────────────────────────────────────
export const useAppraisals = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...APPRAISALS_KEY, params],
    queryFn: async () => (await api.get<ApiResponse<Appraisal[]>>("/performance/appraisals", { params })).data.data ?? [],
    enabled: options?.enabled ?? true,
  });

export const useReviewAppraisal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, managerComment, goalRatings }: { id: string; managerComment?: string; goalRatings: { goalId: string; managerRating: number }[] }) =>
      (await api.patch<ApiResponse<Appraisal>>(`/performance/appraisals/${id}/review`, { managerComment, goalRatings })).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: APPRAISALS_KEY });
      qc.invalidateQueries({ queryKey: MINE_KEY });
      toast.success("Appraisal reviewed");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to submit review")),
  });
};

// ── Self-service ─────────────────────────────────────────────────────────────
export const useMyAppraisals = () =>
  useQuery({
    queryKey: MINE_KEY,
    queryFn: async () => (await api.get<ApiResponse<Appraisal[]>>("/performance/mine")).data.data ?? [],
  });

export const useSetMyGoals = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, goals }: { id: string; goals: Partial<AppraisalGoal>[] }) =>
      (await api.put<ApiResponse<Appraisal>>(`/performance/mine/${id}/goals`, { goals })).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MINE_KEY });
      qc.invalidateQueries({ queryKey: APPRAISALS_KEY });
      toast.success("Goals saved");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to save goals")),
  });
};

export const useSubmitMySelfReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, selfComment }: { id: string; selfComment?: string }) =>
      (await api.post<ApiResponse<Appraisal>>(`/performance/mine/${id}/submit`, { selfComment })).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MINE_KEY });
      qc.invalidateQueries({ queryKey: APPRAISALS_KEY });
      toast.success("Self-review submitted");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to submit self-review")),
  });
};
