"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axios";
import { toast } from "@/lib/toast";
import type { ApiResponse, Kiosk, PairedKiosk } from "@/types";

const KEY = ["kiosks"] as const;

function errMsg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useKiosks = (enabled = true) =>
  useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<ApiResponse<Kiosk[]>>("/kiosks")).data.data ?? [],
    enabled,
  });

export const useRegisterKiosk = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; location?: string }) =>
      (await api.post<ApiResponse<PairedKiosk>>("/kiosks", data)).data.data!,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errMsg(e, "Could not pair this device")),
  });
};

export const useRotateKioskToken = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<ApiResponse<PairedKiosk>>(`/kiosks/${id}/rotate-token`)).data.data!,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errMsg(e, "Could not issue a new token")),
  });
};

export const useSetKioskActive = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch<ApiResponse<Kiosk>>(`/kiosks/${id}/active`, { active })).data.data!,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success(v.active ? "Kiosk enabled" : "Kiosk disabled");
    },
    onError: (e) => toast.error(errMsg(e, "Could not update this kiosk")),
  });
};

export const useDeleteKiosk = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete<ApiResponse<null>>(`/kiosks/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Kiosk removed");
    },
    onError: (e) => toast.error(errMsg(e, "Could not remove this kiosk")),
  });
};
