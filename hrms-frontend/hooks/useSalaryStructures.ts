"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, SalaryStructure, SalaryStructureAssignment, SalaryBreakup } from "@/types";

const KEY = ["salary-structures"] as const;
const ASSIGN_KEY = ["salary-structure-assignments"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidatePayroll = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ASSIGN_KEY });
  qc.invalidateQueries({ queryKey: ["payslips"] });
};

// ── Structure templates ────────────────────────────────────────────────────────
export const useSalaryStructures = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<SalaryStructure[]>>("/salary-structures", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useCreateStructure = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<SalaryStructure>>("/salary-structures", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Salary structure created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create structure")),
  });
};

export const useUpdateStructure = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<SalaryStructure>>(`/salary-structures/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); invalidatePayroll(qc); toast.success("Salary structure updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update structure")),
  });
};

export const useDeleteStructure = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/salary-structures/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Salary structure deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete structure")),
  });
};

// ── Assignments ─────────────────────────────────────────────────────────────────
export const useAssignments = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...ASSIGN_KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<SalaryStructureAssignment[]>>("/salary-structures/assignments", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

export const useAssignStructure = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<SalaryStructureAssignment>>("/salary-structures/assignments", data)).data.data!,
    onSuccess: () => { invalidatePayroll(qc); toast.success("Structure assigned"); },
    onError: (e) => toast.error(errMsg(e, "Failed to assign structure")),
  });
};

export const useUpdateAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<SalaryStructureAssignment>>(`/salary-structures/assignments/${id}`, data)).data.data!,
    onSuccess: () => { invalidatePayroll(qc); toast.success("Assignment updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update assignment")),
  });
};

export const useDeleteAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/salary-structures/assignments/${id}`); },
    onSuccess: () => { invalidatePayroll(qc); toast.success("Assignment removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove assignment")),
  });
};

// ── Live breakup preview ──────────────────────────────────────────────────────
export const useBreakup = (employee?: string, month?: string) =>
  useQuery({
    queryKey: ["salary-breakup", employee, month],
    enabled: !!employee && !!month,
    queryFn: async () => (await api.get<ApiResponse<SalaryBreakup>>("/salary-structures/breakup", { params: { employee, month } })).data.data!,
  });
