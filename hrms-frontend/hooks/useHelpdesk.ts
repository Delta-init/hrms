"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, HelpdeskTicket, HelpdeskStatus } from "@/types";
import type { TicketFormValues } from "@/lib/validations/helpdeskSchema";

const KEY = ["helpdesk"] as const;
const MINE_KEY = ["helpdesk-mine"] as const;

function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

// ── Admin ────────────────────────────────────────────────────────────────────
export const useTickets = (params?: Record<string, string>, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<HelpdeskTicket[]>>("/helpdesk", { params });
      return { data: res.data.data ?? [], pagination: res.data.pagination };
    },
    enabled: options?.enabled ?? true,
  });

export const useAssignTicket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, assignedTo }: { id: string; assignedTo: string | null }) =>
      (await api.patch<ApiResponse<HelpdeskTicket>>(`/helpdesk/${id}/assign`, { assignedTo })).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Ticket assigned"); },
    onError: (e) => toast.error(errMsg(e, "Failed to assign ticket")),
  });
};

export const useSetTicketStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: HelpdeskStatus }) =>
      (await api.patch<ApiResponse<HelpdeskTicket>>(`/helpdesk/${id}/status`, { status })).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: MINE_KEY });
      toast.success("Ticket status updated");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to update status")),
  });
};

export const useDeleteTicket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/helpdesk/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Ticket deleted"); },
    onError: (e) => toast.error(errMsg(e, "Failed to delete ticket")),
  });
};

// ── Self-service ─────────────────────────────────────────────────────────────
export const useMyTickets = () =>
  useQuery({
    queryKey: MINE_KEY,
    queryFn: async () => (await api.get<ApiResponse<HelpdeskTicket[]>>("/helpdesk/mine")).data.data ?? [],
  });

export const useCreateTicket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: TicketFormValues) => (await api.post<ApiResponse<HelpdeskTicket>>("/helpdesk", data)).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: MINE_KEY });
      toast.success("Ticket submitted");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to submit ticket")),
  });
};

// Comments work for both self-service (ticket owner) and admin/assignee callers.
export const useAddTicketComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) =>
      (await api.post<ApiResponse<HelpdeskTicket>>(`/helpdesk/${id}/comments`, { body })).data.data!,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: MINE_KEY });
      toast.success("Comment added");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to add comment")),
  });
};
