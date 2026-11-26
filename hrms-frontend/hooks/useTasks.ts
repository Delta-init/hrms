"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, MyTaskSummary, Task, TaskCategory, TaskEnds, TaskRepeat, TaskSeries, TaskSummary } from "@/types";

/* Tasks HR hands out (2026-11-25). Your own need no permission; everyone else's need `tasks`. */

const KEY = ["tasks"] as const;
const errMsg = (e: unknown, f: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  // A decision here changes the Approvals counts too.
  qc.invalidateQueries({ queryKey: ["approvals"] });
};

export const useTasks = (params: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Task[]>>("/tasks", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled,
  });

export const useTask = (id?: string | null) =>
  useQuery({
    queryKey: [...KEY, "one", id],
    queryFn: async () => (await api.get<ApiResponse<Task>>(`/tasks/${id}`)).data.data!,
    enabled: !!id,
  });

export const useTaskSummary = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "summary"],
    queryFn: async () => (await api.get<ApiResponse<TaskSummary>>("/tasks/summary")).data.data!,
    enabled,
  });

/** The caller's own counts — sidebar badge and dashboard card. */
export const useMyTaskSummary = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "mine-summary"],
    queryFn: async () => (await api.get<ApiResponse<MyTaskSummary>>("/tasks/mine/summary")).data.data!,
    enabled,
    staleTime: 60_000,
  });

export const useTaskCategories = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "categories"],
    queryFn: async () => (await api.get<ApiResponse<TaskCategory[]>>("/tasks/categories")).data.data ?? [],
    enabled,
    staleTime: 5 * 60_000,
  });

export const useCreateTaskCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => (await api.post<ApiResponse<TaskCategory>>("/tasks/categories", { name })).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...KEY, "categories"] }); toast.success("Category added"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't add the category")),
  });
};

export interface TaskInput {
  title: string; details?: string; category?: string | null; priority: string;
  employees: string[]; departments: string[]; dueAt: string; steps: string[];
  needsApproval: boolean; proofRequired: boolean;
  /** Repeating (Part 2); absent or kind "once" for a one-off task. */
  repeat?: { kind: "once" | TaskRepeat["kind"]; weekdays?: number[]; everyDays?: number | null; ends: TaskEnds };
}

export const useCreateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: TaskInput) => (await api.post<ApiResponse<{ created: number }>>("/tasks", data)).data,
    onSuccess: (r) => { invalidate(qc); toast.success(r.message ?? "Task assigned"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't assign the task")),
  });
};

export const useUpdateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TaskInput> }) => (await api.put<ApiResponse<Task>>(`/tasks/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Task updated"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't update the task")),
  });
};

export const useCancelTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => (await api.patch<ApiResponse<Task>>(`/tasks/${id}/cancel`, { note })).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Task cancelled"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't cancel the task")),
  });
};

/** Tick or untick a step. Quiet on success — the tick itself is the feedback. */
export const useToggleTaskStep = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stepId, done }: { id: string; stepId: string; done: boolean }) =>
      (await api.patch<ApiResponse<Task>>(`/tasks/${id}/steps/${stepId}`, { done })).data.data!,
    onSuccess: (t) => { qc.setQueryData([...KEY, "one", t._id], t); qc.invalidateQueries({ queryKey: [...KEY, "list"] }); qc.invalidateQueries({ queryKey: [...KEY, "mine-summary"] }); },
    onError: (e) => toast.error(errMsg(e, "Couldn't update the step")),
  });
};

export const useSubmitTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note, files }: { id: string; note?: string; files?: File[] }) => {
      const form = new FormData();
      if (note) form.append("note", note);
      for (const f of files ?? []) form.append("files", f);
      return (await api.post<ApiResponse<Task>>(`/tasks/${id}/submit`, form, { timeout: 120_000 })).data;
    },
    onSuccess: (r) => { invalidate(qc); toast.success(r.message ?? "Sent to HR for approval"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't mark it done")),
  });
};

export const useReviewTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: "approve" | "send_back"; note?: string }) =>
      (await api.patch<ApiResponse<Task>>(`/tasks/${id}/review`, { decision, note })).data,
    onSuccess: (r) => { invalidate(qc); toast.success(r.message ?? "Done"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't save the decision")),
  });
};

// ── Repeating tasks (Part 2) ─────────────────────────────────────────────────

export const useTaskSeriesList = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "series"],
    queryFn: async () => (await api.get<ApiResponse<TaskSeries[]>>("/tasks/series")).data.data ?? [],
    enabled,
  });

export interface SeriesInput {
  title?: string; details?: string; category?: string | null; priority?: string; steps?: string[];
  needsApproval?: boolean; proofRequired?: boolean; dueTime?: string;
  repeat?: { kind: TaskRepeat["kind"]; weekdays?: number[]; everyDays?: number | null; ends: TaskEnds };
}

export const useUpdateTaskSeries = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: SeriesInput }) => (await api.put<ApiResponse<TaskSeries>>(`/tasks/series/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Repeating task updated"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't update it")),
  });
};

export const useSetTaskSeriesState = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, state }: { id: string; state: TaskSeries["state"] }) => (await api.patch<ApiResponse<TaskSeries>>(`/tasks/series/${id}/state`, { state })).data,
    onSuccess: (r) => { invalidate(qc); toast.success(r.message ?? "Saved"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't change it")),
  });
};
