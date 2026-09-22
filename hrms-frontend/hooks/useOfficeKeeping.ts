"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, OfficeKeepingRequest, OfficeKeepingStatus } from "@/types";

const KEY = ["office-keeping"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

/** The caller's own requests. Needs no permission. */
export const useMyOfficeKeeping = (params?: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "mine", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<OfficeKeepingRequest[]>>("/office-keeping/mine", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
  });

/** The panel — everything, for whoever runs office keeping. */
export const useOfficeKeepingQueue = (params: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "queue", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<OfficeKeepingRequest[]>>("/office-keeping", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled,
  });

export const useRaiseOfficeKeeping = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { issue: string; location: string; photo?: File | null }) => {
      const form = new FormData();
      form.append("issue", v.issue);
      form.append("location", v.location);
      if (v.photo) form.append("file", v.photo);
      const res = await api.post<ApiResponse<OfficeKeepingRequest>>("/office-keeping", form, {
        headers: { "Content-Type": undefined }, // let the browser set the multipart boundary
      });
      return res.data.data!;
    },
    onSuccess: () => { invalidate(qc); toast.success("Request raised"); },
    onError: (e) => toast.error(errMsg(e, "Could not raise the request")),
  });
};

export const useSetOfficeKeepingStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; status: OfficeKeepingStatus; note?: string }) =>
      (await api.patch<ApiResponse<OfficeKeepingRequest>>(`/office-keeping/${v.id}/status`, { status: v.status, note: v.note })).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Updated"); },
    onError: (e) => toast.error(errMsg(e, "Could not update it")),
  });
};

export const useWithdrawOfficeKeeping = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.patch(`/office-keeping/${id}/withdraw`); },
    onSuccess: () => { invalidate(qc); toast.success("Withdrawn"); },
    onError: (e) => toast.error(errMsg(e, "Could not withdraw it")),
  });
};
