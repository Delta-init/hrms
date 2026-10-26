"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axios";
import type { ApiResponse } from "@/types";

const KEY = ["guide-seen"] as const;

/** When the HRMS guide video was first seen or skipped — null until then. */
export const useGuideSeen = (enabled = true) =>
  useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const me = (await api.get<ApiResponse<{ guideSeenAt?: string | null }>>("/auth/me")).data.data;
      return { guideSeenAt: me?.guideSeenAt ?? null };
    },
    enabled,
    staleTime: Infinity,
  });

export const useMarkGuideSeen = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<ApiResponse<{ guideSeenAt: string | null }>>("/auth/guide-seen")).data.data!,
    onSuccess: (d) => qc.setQueryData(KEY, d),
  });
};
