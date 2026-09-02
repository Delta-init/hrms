"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import type { ApiResponse, SearchHit } from "@/types";

/**
 * What the server can find, for whoever is asking.
 *
 * Held back until there are two characters. A one-letter contains-search is not
 * a search — it is a request for everybody whose name has an "a" in it, sent on
 * every keystroke.
 */
export const useGlobalSearch = (query: string) =>
  useQuery({
    queryKey: ["global-search", query],
    queryFn: async () =>
      (await api.get<ApiResponse<SearchHit[]>>("/search", { params: { q: query } })).data.data ?? [],
    enabled: query.trim().length >= 2,
    // Typing back over the same term is common; the answer has not changed.
    staleTime: 30_000,
  });
