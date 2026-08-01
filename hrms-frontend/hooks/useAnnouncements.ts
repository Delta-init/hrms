"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Announcement } from "@/types";
import type { AnnouncementFormValues } from "@/lib/validations/announcementSchema";

const KEY = ["announcements"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useAnnouncements = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Announcement[]>>("/announcements", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

export const useCreateAnnouncement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: AnnouncementFormValues) => (await api.post<ApiResponse<Announcement>>("/announcements", data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Announcement posted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to post announcement")),
  });
};

export const useUpdateAnnouncement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AnnouncementFormValues> }) =>
      (await api.put<ApiResponse<Announcement>>(`/announcements/${id}`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Announcement updated"); },
    onError: (e) => toast.error(errMsg(e, "Failed to update announcement")),
  });
};

export const useDeleteAnnouncement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/announcements/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Announcement deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete announcement")),
  });
};
