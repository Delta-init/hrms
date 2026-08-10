"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Employee, EmployeeLocation, EmploymentType } from "@/types";

/** Everything already known from the candidate, the requisition and the offer. */
export interface HirePrefill {
  name: string;
  email: string;
  phone?: string;
  designation: string;
  department: string | null;
  location: EmployeeLocation | null;
  employmentType: EmploymentType;
  currency: string;
  salary?: number;
  stage: string;
  status: string;
}

export const useHirePrefill = (applicationId?: string, enabled = true) =>
  useQuery({
    queryKey: ["hiring", "hire-prefill", applicationId],
    queryFn: async () => (await api.get<ApiResponse<HirePrefill>>(`/hiring/applications/${applicationId}/hire`)).data.data!,
    enabled: !!applicationId && enabled,
  });

export const useHireApplicant = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Record<string, unknown>) => {
      const res = await api.post<ApiResponse<{ employee: Employee; loginError?: string; onboardingError?: string; requisitionFilled: boolean }>>(
        `/hiring/applications/${id}/hire`, body
      );
      return { result: res.data.data!, message: res.data.message };
    },
    // The server reports a failed login or checklist rather than throwing them,
    // so the employee is never discarded — pass its wording straight through.
    onSuccess: ({ result, message }) => {
      qc.invalidateQueries({ queryKey: ["hiring"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      const partial = result.loginError || result.onboardingError;
      partial ? toast.warning?.(message ?? "Employee created with warnings") ?? toast.success(message ?? "") : toast.success(message ?? "Employee created");
    },
    onError: (e) => toast.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Could not create the employee"
    ),
  });
};
