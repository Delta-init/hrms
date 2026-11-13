"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type {
  ApiResponse, AdSpendOverview, AdSpendRequisition, AdSpendSettings, AdSpendWeekList, AdSpendWeekView, AdPlatform,
} from "@/types";

const KEY = ["ad-spend"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useAdSpendSettings = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "settings"],
    queryFn: async () => (await api.get<ApiResponse<AdSpendSettings>>("/ad-spend/settings")).data.data!,
    enabled,
  });

/** Platform names for the candidate form's source list — readable with hiring access alone. */
export const useAdPlatformNames = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "platform-names"],
    queryFn: async () => (await api.get<ApiResponse<string[]>>("/ad-spend/platforms")).data.data ?? [],
    enabled,
    staleTime: 5 * 60_000,
  });

export const useAdSpendRequisitions = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "requisitions"],
    queryFn: async () => (await api.get<ApiResponse<AdSpendRequisition[]>>("/ad-spend/requisitions")).data.data ?? [],
    enabled,
  });

export const useAdSpendOverview = (range: { from?: string; to?: string }, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "overview", range],
    queryFn: async () => (await api.get<ApiResponse<AdSpendOverview>>("/ad-spend/overview", { params: range })).data.data!,
    enabled,
  });

export const useAdSpendWeeks = (range: { from?: string; to?: string }, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "weeks", range],
    queryFn: async () => (await api.get<ApiResponse<AdSpendWeekList>>("/ad-spend/weeks", { params: range })).data.data!,
    enabled,
  });

export const useAdSpendWeek = (weekStart: string | null) =>
  useQuery({
    queryKey: [...KEY, "week", weekStart],
    queryFn: async () => (await api.get<ApiResponse<AdSpendWeekView>>(`/ad-spend/weeks/${weekStart}`)).data.data!,
    enabled: !!weekStart,
  });

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

export interface SaveWeekBody {
  nothingSpent: boolean;
  note: string;
  lines: { requisition: string | null; role: string; amounts: { platform: string; amount: number }[]; note: string }[];
}

export const useSaveAdSpendWeek = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ weekStart, body }: { weekStart: string; body: SaveWeekBody }) =>
      (await api.put<ApiResponse<AdSpendWeekView>>(`/ad-spend/weeks/${weekStart}`, body)).data,
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "Week saved"); },
    onError: (e) => toast.error(errMsg(e, "Could not save the week")),
  });
};

export const useDeleteAdSpendWeek = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (weekStart: string) => (await api.delete<ApiResponse<unknown>>(`/ad-spend/weeks/${weekStart}`)).data,
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "Week removed"); },
    onError: (e) => toast.error(errMsg(e, "Could not remove the week")),
  });
};

export const useAttachAdSpendFile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ weekStart, file }: { weekStart: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post<ApiResponse<AdSpendWeekView>>(`/ad-spend/weeks/${weekStart}/attachments`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })).data;
    },
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "File attached"); },
    onError: (e) => toast.error(errMsg(e, "Could not attach the file")),
  });
};

export const useRemoveAdSpendFile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ weekStart, id }: { weekStart: string; id: string }) =>
      (await api.delete<ApiResponse<AdSpendWeekView>>(`/ad-spend/weeks/${weekStart}/attachments/${id}`)).data,
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "File removed"); },
    onError: (e) => toast.error(errMsg(e, "Could not remove the file")),
  });
};

export const useUpdateAdSpendSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { currency?: string; monthlyBudget?: number; platforms?: Partial<AdPlatform>[]; trackingFrom?: string | null }) =>
      (await api.put<ApiResponse<AdSpendSettings>>("/ad-spend/settings", body)).data,
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "Settings saved"); },
    onError: (e) => toast.error(errMsg(e, "Could not save the settings")),
  });
};
