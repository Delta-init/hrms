"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, AttendancePenaltyPolicy } from "@/types";

const KEY = ["attendance-penalty-policy"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useAttendancePenaltyPolicy = (enabled = true) => {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await api.get<ApiResponse<AttendancePenaltyPolicy>>("/work-schedules/penalty-policy");
      return res.data.data!;
    },
    enabled,
  });
};

export const useUpdateAttendancePenaltyPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: AttendancePenaltyPolicy) => {
      const res = await api.put<ApiResponse<AttendancePenaltyPolicy>>("/work-schedules/penalty-policy", data);
      return res.data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Penalty policy updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update penalty policy")),
  });
};
