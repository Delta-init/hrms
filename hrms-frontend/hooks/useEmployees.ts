"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Employee } from "@/types";

const KEY = ["employees"] as const;
/**
 * The org chart and the dashboard widgets are both derived from employees, so
 * an employee change has to expire them too. Without this a manager reassigned
 * on the chart snapped back to its old place until a hard reload.
 */
function invalidateEmployeeViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
}
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useEmployees = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Employee[]>>("/employees", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

/**
 * The code to offer for a new employee — one past the highest existing one.
 * Only fetched while the create dialog is open, and never cached, so two people
 * adding employees at once don't both get handed the same code from cache.
 */
export const useNextEmployeeCode = (enabled: boolean) =>
  useQuery({
    queryKey: [...KEY, "next-code"],
    queryFn: async () => (await api.get<ApiResponse<{ code: string }>>("/employees/next-code")).data.data?.code ?? "",
    enabled,
    staleTime: 0,
    gcTime: 0,
  });

export const useEmployee = (id?: string) =>
  useQuery({
    queryKey: [...KEY, "detail", id],
    queryFn: async () => (await api.get<ApiResponse<Employee>>(`/employees/${id}`)).data.data!,
    enabled: !!id,
  });

/** Resolve the employee linked to a login account (404 → null, no retry). */
export const useEmployeeByUser = (userId?: string) =>
  useQuery({
    queryKey: [...KEY, "by-user", userId],
    queryFn: async () => {
      try {
        return (await api.get<ApiResponse<Employee>>(`/employees/by-user/${userId}`)).data.data!;
      } catch {
        return null;
      }
    },
    enabled: !!userId,
    retry: false,
  });

/** Self-service — the caller's own employee record. */
export const useMyEmployeeProfile = () =>
  useQuery({
    queryKey: [...KEY, "me"],
    queryFn: async () => (await api.get<ApiResponse<Employee>>("/employees/me")).data.data!,
  });

/** Self-service — update the caller's own personal-information sections. */
export const useUpdateMyProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.put<ApiResponse<Employee>>("/employees/me", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: [...KEY, "me"] }); toast.success("Profile updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update profile")),
  });
};

export const useCreateEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<Employee>>("/employees", data)).data,
    onSuccess: (res) => {
      invalidateEmployeeViews(qc);
      // The employee is saved even when the optional login step failed, so this
      // reports the partial outcome rather than a flat "created".
      const partial = res.message?.startsWith("Employee created, but");
      if (partial) toast.warning("Employee created", { description: res.message });
      else toast.success("Employee created");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to create employee")),
  });
};

export const useUpdateEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => (await api.put<ApiResponse<Employee>>(`/employees/${id}`, data)).data.data!,
    onSuccess: () => { invalidateEmployeeViews(qc); toast.success("Employee updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update employee")),
  });
};

export const useDeleteEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/employees/${id}`); },
    onSuccess: () => { invalidateEmployeeViews(qc); toast.success("Employee deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete employee")),
  });
};

/**
 * Forget the browser a remote employee's attendance is tied to.
 *
 * The way out of a new laptop, a reinstalled browser or cleared site data —
 * without it, every one of those is a permanent lockout.
 */
export const useResetEmployeeDevice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.post(`/employees/${id}/reset-device`); },
    onSuccess: () => { invalidateEmployeeViews(qc); toast.success("Device reset — their next punch registers a new one"); },
    onError: (e) => toast.error(errMsg(e, "Could not reset the device")),
  });
};

export const useCreateEmployeeLogin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.post<ApiResponse<{ loginEmail: string }>>(`/employees/${id}/create-login`, data)).data,
    onSuccess: () => {
      invalidateEmployeeViews(qc);
      toast.success("Login created", { description: "An activation email with the temporary password was sent to the employee." });
    },
    onError: (e) => toast.error(errMsg(e, "Failed to create login")),
  });
};
