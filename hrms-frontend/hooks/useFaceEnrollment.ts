"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axios";
import { toast } from "@/lib/toast";
import type { ApiResponse, FaceSettings, FaceStatus } from "@/types";

const SETTINGS_KEY = ["face", "settings"] as const;
const statusKey = (userId: string) => ["face", "status", userId] as const;

/** The failed-capture index the server reports, so the UI can point at it. */
export interface FaceEnrollFailure {
  message: string;
  failures?: string[];
  frame?: number;
}

function enrollError(e: unknown): FaceEnrollFailure {
  const data = (e as { response?: { data?: { message?: string; errors?: unknown } } })?.response?.data;
  const errors = data?.errors as { failures?: string[]; frame?: number } | undefined;
  return {
    message: data?.message ?? "Could not enroll this face",
    failures: errors?.failures,
    frame: errors?.frame,
  };
}

/** Whether face enrollment is available at all, and the rules it enforces. */
export const useFaceSettings = () =>
  useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => (await api.get<ApiResponse<FaceSettings>>("/face/settings")).data.data!,
    staleTime: 5 * 60_000, // server config, not user data
  });

export const useFaceStatus = (userId: string, enabled = true) =>
  useQuery({
    queryKey: statusKey(userId),
    queryFn: async () =>
      (await api.get<ApiResponse<FaceStatus>>(`/face/profiles/${userId}`)).data.data!,
    enabled: enabled && !!userId,
  });

export interface CaptureVerdict {
  ok: boolean;
  message?: string;
  failures?: string[];
}

/**
 * Judge one capture the moment it is taken.
 *
 * Runs the same gates the save will, so anything accepted here will not be the
 * frame that fails at the end — which is the difference between retaking one
 * photo and redoing the whole sitting.
 */
export const useCheckCapture = (userId: string) =>
  useMutation({
    mutationFn: async (image: string) =>
      (await api.post<ApiResponse<CaptureVerdict>>(`/face/profiles/${userId}/check`, { image }))
        .data.data!,
  });

export const useEnrollFace = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (images: string[]) =>
      (
        await api.post<ApiResponse<FaceStatus>>(`/face/profiles/${userId}`, {
          images,
          consentAcknowledged: true,
        })
      ).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: statusKey(userId) });
      toast.success("Face enrolled");
    },
    // Deliberately no toast: which capture failed and why belongs next to the
    // retake button, not in a notification that disappears.
    onError: () => {},
  });
};

export const useDeleteFaceProfile = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.delete<ApiResponse<null>>(`/face/profiles/${userId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: statusKey(userId) });
      toast.success("Face data deleted");
    },
    onError: (e) => toast.error(enrollError(e).message),
  });
};

export { enrollError };
