"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Employee } from "@/types";

interface MyProfile {
  employee: Employee | null;
  profileCompleted: boolean;
  photoUrl?: string;
}

export const useMyProfile = () =>
  useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => (await api.get<ApiResponse<MyProfile>>("/auth/my-profile")).data.data!,
    staleTime: 0,
  });

export const useCompleteProfile = () =>
  useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<unknown>>("/auth/complete-profile", data)).data,
    onError: (e) =>
      toast.error(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Could not save your details"
      ),
  });
