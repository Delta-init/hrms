"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, InvitablePerson, MeetingBooking, MeetingRoom } from "@/types";

const KEY = ["meetings"] as const;
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}
const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: KEY });

export const useMeetingRooms = (includeInactive = false) =>
  useQuery({
    queryKey: [...KEY, "rooms", includeInactive],
    queryFn: async () =>
      (await api.get<ApiResponse<MeetingRoom[]>>("/meetings/rooms", { params: includeInactive ? { includeInactive: "true" } : undefined })).data.data ?? [],
  });

export const useMeetingBookings = (params: Record<string, string>) =>
  useQuery({
    queryKey: [...KEY, "bookings", params],
    queryFn: async () => (await api.get<ApiResponse<MeetingBooking[]>>("/meetings/bookings", { params })).data.data ?? [],
  });

/** Employees with a login — only fetched when the form is actually open. */
export const useInvitablePeople = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "invitable"],
    queryFn: async () => (await api.get<ApiResponse<InvitablePerson[]>>("/meetings/invitable")).data.data ?? [],
    enabled,
  });

export const useCreateBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<MeetingBooking>>("/meetings/bookings", data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Room booked"); },
    onError: (e) => toast.error(errMsg(e, "Could not book the room")),
  });
};

export const useUpdateBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.put<ApiResponse<MeetingBooking>>(`/meetings/bookings/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Booking updated"); },
    onError: (e) => toast.error(errMsg(e, "Could not update the booking")),
  });
};

export const useCancelBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.patch(`/meetings/bookings/${id}/cancel`); },
    onSuccess: () => { invalidate(qc); toast.success("Booking cancelled"); },
    onError: (e) => toast.error(errMsg(e, "Could not cancel the booking")),
  });
};

export const useDeleteBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/meetings/bookings/${id}`); },
    onSuccess: () => { invalidate(qc); toast.success("Booking deleted"); },
    onError: (e) => toast.error(errMsg(e, "Could not delete the booking")),
  });
};

export const useCreateRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post<ApiResponse<MeetingRoom>>("/meetings/rooms", data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Room added"); },
    onError: (e) => toast.error(errMsg(e, "Could not add the room")),
  });
};
