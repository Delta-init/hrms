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

export const useUpdateRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.put<ApiResponse<MeetingRoom>>(`/meetings/rooms/${id}`, data)).data.data!,
    onSuccess: () => { invalidate(qc); toast.success("Room updated"); },
    onError: (e) => toast.error(errMsg(e, "Could not update the room")),
  });
};

/**
 * Take a room out of use.
 *
 * Retired, never deleted — bookings already made still point at it, and a
 * meeting whose room has vanished is worse than one in a room nobody books any
 * more. `useUpdateRoom` with `active: true` puts it back.
 */
export const useRetireRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.patch(`/meetings/rooms/${id}/retire`); },
    onSuccess: () => { invalidate(qc); toast.success("Room retired"); },
    onError: (e) => toast.error(errMsg(e, "Could not retire the room")),
  });
};

/** The review form, after a review meeting. */
export const useSaveReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.put<ApiResponse<MeetingBooking>>(`/meetings/bookings/${id}/review`, data)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Review saved — the employee has been told"); },
    onError: (e) => toast.error(errMsg(e, "Could not save the review")),
  });
};

export const useSetRecording = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, recordingLink }: { id: string; recordingLink: string }) =>
      (await api.patch<ApiResponse<MeetingBooking>>(`/meetings/bookings/${id}/recording`, { recordingLink })).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Recording saved"); },
    onError: (e) => toast.error(errMsg(e, "Could not save the recording")),
  });
};

export const useAcknowledgeReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch<ApiResponse<MeetingBooking>>(`/meetings/bookings/${id}/acknowledge`)).data.data!,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Acknowledged"); },
    onError: (e) => toast.error(errMsg(e, "Could not acknowledge")),
  });
};

/** One meeting, for the join page. */
export const useMeetingBooking = (id?: string) =>
  useQuery({
    queryKey: [...KEY, "booking", id],
    queryFn: async () => (await api.get<ApiResponse<MeetingBooking>>(`/meetings/bookings/${id}`)).data.data!,
    enabled: !!id,
    retry: false,
  });

/** Send where we are; get the meeting link back. */
export const useJoinMeeting = () =>
  useMutation({
    mutationFn: async ({ id, latitude, longitude, accuracy }: { id: string; latitude: number; longitude: number; accuracy?: number | null }) =>
      (await api.post<ApiResponse<{ meetingLink: string; clockedIn: boolean; distanceMetres: number | null; sameLocation: boolean | null }>>(
        `/meetings/bookings/${id}/join`, { latitude, longitude, accuracy }
      )).data.data!,
  });

/** Who is emailed about every room booking. */
export const useBookingAlerts = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "booking-alerts"],
    queryFn: async () => (await api.get<ApiResponse<Array<{ _id: string; name: string; email: string }>>>("/meetings/booking-alerts")).data.data ?? [],
    enabled,
  });

export const useSaveBookingAlerts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (users: string[]) =>
      (await api.put<ApiResponse<Array<{ _id: string; name: string; email: string }>>>("/meetings/booking-alerts", { users })).data.data ?? [],
    onSuccess: (d) => { qc.setQueryData([...KEY, "booking-alerts"], d); toast.success("Booking alerts saved"); },
    onError: (e) => toast.error(errMsg(e, "Could not save booking alerts")),
  });
};
