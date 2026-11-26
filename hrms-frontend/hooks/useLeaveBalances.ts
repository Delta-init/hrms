"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, LeavePolicy, LeaveBalance, EmployeeLeaveBalances } from "@/types";

const POLICY_KEY = ["leave-policies"] as const;
const BALANCE_KEY = ["leave-balances"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: POLICY_KEY });
  qc.invalidateQueries({ queryKey: BALANCE_KEY });
};

export const useLeavePolicies = (enabled = true) =>
  useQuery({
    queryKey: POLICY_KEY,
    queryFn: async () => (await api.get<ApiResponse<LeavePolicy[]>>("/leave-balances/policies")).data.data ?? [],
    enabled,
  });

export const useCreateLeavePolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<LeavePolicy>>("/leave-balances/policies", data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Leave policy created"); },
    onError: (e) => toast.error(errMsg(e, "Failed to create leave policy")),
  });
};

export const useUpdateLeavePolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<LeavePolicy>>(`/leave-balances/policies/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Leave policy updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update leave policy")),
  });
};

export const useDeleteLeavePolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/leave-balances/policies/${id}`); },
    onSuccess: () => { invalidate(qc); toast.success("Leave policy removed"); },
    onError: (e) => toast.error(errMsg(e, "Failed to remove leave policy")),
  });
};

export const useMyLeaveBalances = (year?: number) =>
  useQuery({
    queryKey: [...BALANCE_KEY, "mine", year],
    queryFn: async () => (await api.get<ApiResponse<LeaveBalance[]>>("/leave-balances/mine", { params: year ? { year } : undefined })).data.data ?? [],
  });

/** Someone else's balances (leave view), with the manual edits made to them. */
export const useEmployeeLeaveBalances = (employeeId?: string | null, year?: number) =>
  useQuery({
    queryKey: [...BALANCE_KEY, "employee", employeeId, year],
    queryFn: async () => (await api.get<ApiResponse<EmployeeLeaveBalances>>(`/leave-balances/employee/${employeeId}`, { params: year ? { year } : undefined })).data.data!,
    enabled: !!employeeId,
  });

/** HR / Super Admin: set someone's days left, or add or remove days, with a reason. */
export const useAdjustLeaveBalance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, data }: { employeeId: string; data: { type: string; year: number; mode: "set" | "add"; days: number; reason: string } }) =>
      (await api.post<ApiResponse<EmployeeLeaveBalances & { from: number; to: number }>>(`/leave-balances/employee/${employeeId}/adjust`, data)).data,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: BALANCE_KEY }); toast.success(r.message ?? "Balance changed"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't change the balance")),
  });
};
