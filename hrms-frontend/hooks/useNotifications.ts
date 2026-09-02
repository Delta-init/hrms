"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axios";
import type { ApiResponse, AppNotification } from "@/types";

const KEY = ["notifications"] as const;

/**
 * The bell's contents. Everybody has these, so nothing is gated.
 *
 * Polled rather than pushed. A websocket would be the right answer for a chat
 * application; for "your leave was approved" a minute of latency costs nothing,
 * and a poll cannot leave a stale connection quietly delivering nothing.
 */
export const useNotifications = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "list"],
    queryFn: async () => (await api.get<ApiResponse<AppNotification[]>>("/notifications")).data.data ?? [],
    enabled,
    staleTime: 30_000,
  });

/** Just the number on the badge — cheap enough to ask for on a timer. */
export const useUnreadCount = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "unread"],
    queryFn: async () =>
      (await api.get<ApiResponse<{ count: number }>>("/notifications/unread-count")).data.data?.count ?? 0,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

/**
 * Mark one read.
 *
 * The badge and the list are both invalidated: a count that still says three
 * after the reader has opened all three is the fastest way to make somebody
 * stop trusting it.
 */
export const useMarkRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/notifications/${id}/read`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
};

export const useMarkAllRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post("/notifications/read-all")).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
};
