"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import type { ApiResponse, DocumentsOverview } from "@/types";

/** Every document the organization should hold, present or missing. */
export const useDocumentsOverview = (params?: Record<string, string>) =>
  useQuery({
    queryKey: ["documents", "overview", params],
    queryFn: async () =>
      (await api.get<ApiResponse<DocumentsOverview>>("/documents", { params })).data.data!,
  });
