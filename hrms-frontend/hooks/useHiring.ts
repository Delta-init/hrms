"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, HiringWorkflowState, InterviewQuestion, InterviewResult, JobRequisition, RequisitionStatus } from "@/types";

const KEY = ["hiring"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useRequisitions = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "requisitions", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<JobRequisition[]>>("/hiring/requisitions", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

/** One requisition in full — with its interview questions, which a list row only counts. */
export const useRequisition = (id?: string) =>
  useQuery({
    queryKey: [...KEY, "requisition", id],
    queryFn: async () => (await api.get<ApiResponse<JobRequisition>>(`/hiring/requisitions/${id}`)).data.data!,
    enabled: !!id,
  });

/** Replace a requisition's interview questions — before or after approval. */
export const useSetRequisitionQuestions = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, interviewQuestions }: { id: string; interviewQuestions: InterviewQuestion[] }) =>
      (await api.put<ApiResponse<JobRequisition>>(`/hiring/requisitions/${id}/questions`, { interviewQuestions })).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Interview questions saved"); },
    onError: (e) => toast.error(errMsg(e, "Could not save the interview questions")),
  });
};

/** Every submitted interview sheet on a role — or one candidate's — best-marked first. */
export const useInterviewResults = (requisitionId?: string, applicationId?: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "interview-results", requisitionId, applicationId],
    queryFn: async () =>
      (await api.get<ApiResponse<InterviewResult[]>>(`/hiring/requisitions/${requisitionId}/interview-results`, {
        params: applicationId ? { application: applicationId } : undefined,
      })).data.data ?? [],
    enabled: !!requisitionId && enabled,
  });

/** Whether a chain is configured. Without one the Finance gate does not exist. */
export const useHiringWorkflow = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "workflow"],
    queryFn: async () => (await api.get<ApiResponse<HiringWorkflowState>>("/hiring/workflow")).data.data!,
    enabled,
  });

/** A replacement's candidates for a department head: the people in the departments they run. */
export const useReplaceable = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "replaceable"],
    queryFn: async () =>
      (await api.get<ApiResponse<Array<{ _id: string; name: string; employeeCode?: string; designation?: string; department?: { _id: string; name: string } | null }>>>("/hiring/requisitions/replaceable")).data.data ?? [],
    enabled,
    staleTime: 5 * 60 * 1000,
  });

export const useCreateRequisition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<JobRequisition>) =>
      (await api.post<ApiResponse<JobRequisition>>("/hiring/requisitions", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Requisition raised"); },
    onError: (e) => toast.error(errMsg(e, "Could not raise the requisition")),
  });
};

export const useReviewRequisition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, reviewNote }: { id: string; status: RequisitionStatus; reviewNote?: string }) =>
      (await api.patch<ApiResponse<JobRequisition>>(`/hiring/requisitions/${id}/review`, { status, reviewNote })).data.data!,
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(`Requisition ${v.status}`); },
    // The workflow refuses a reviewer who does not hold the current step, and
    // that message names the role — surface it rather than a generic failure.
    onError: (e) => toast.error(errMsg(e, "Could not record the decision")),
  });
};

/** Change a requisition — while it is pending and nobody has approved a step. */
export const useUpdateRequisition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<JobRequisition> }) =>
      (await api.put<ApiResponse<JobRequisition>>(`/hiring/requisitions/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Requisition updated"); },
    onError: (e) => toast.error(errMsg(e, "Could not update the requisition")),
  });
};

/** Take a requisition back before it is decided. */
export const useWithdrawRequisition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.patch<ApiResponse<JobRequisition>>(`/hiring/requisitions/${id}/withdraw`, { reason })).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Requisition withdrawn"); },
    onError: (e) => toast.error(errMsg(e, "Could not withdraw the requisition")),
  });
};

export const useDeleteRequisition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hiring/requisitions/${id}`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Requisition deleted"); },
    onError: (e) => toast.error(errMsg(e, "Could not delete the requisition")),
  });
};

/** Attach a JD to a requisition already on file. */
export const useUploadJd = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post<ApiResponse<JobRequisition>>(`/hiring/requisitions/${id}/jd`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })).data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("JD attached"); },
    onError: (e) => toast.error(errMsg(e, "Could not upload the JD")),
  });
};
