"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, Program, ProgramForUser, ProgramRegistration } from "@/types";

const KEY = ["programs"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

/** Everything, for whoever runs programs. */
export const usePrograms = (params?: Record<string, string>, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "all", params],
    queryFn: async () => (await api.get<ApiResponse<Program[]>>("/programs", { params })).data.data ?? [],
    enabled,
  });

/**
 * What this person can book, with their own place in each.
 *
 * Kept fairly fresh: places disappear while somebody is looking at the page,
 * and a Register button that fails because the list was a minute old is worse
 * than one that had already greyed out.
 */
export const useMyPrograms = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "mine"],
    queryFn: async () => (await api.get<ApiResponse<ProgramForUser[]>>("/programs/mine")).data.data ?? [],
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

export const useProgramRegistrations = (id: string | null) =>
  useQuery({
    queryKey: [...KEY, "registrations", id],
    queryFn: async () => (await api.get<ApiResponse<ProgramRegistration[]>>(`/programs/${id}/registrations`)).data.data ?? [],
    enabled: !!id,
  });

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY });
  // The bell and the dashboard prompt both read from programs.
  qc.invalidateQueries({ queryKey: ["notifications"] });
};

export const useCreateProgram = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Program>) => (await api.post<ApiResponse<Program>>("/programs", data)).data,
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "Program created"); },
    onError: (e) => toast.error(errMsg(e, "Could not create that program")),
  });
};

export const useUpdateProgram = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Program> }) =>
      (await api.put<ApiResponse<Program>>(`/programs/${id}`, data)).data,
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "Program updated"); },
    onError: (e) => toast.error(errMsg(e, "Could not update that program")),
  });
};

/**
 * Replace a program's banner.
 *
 * Sent as multipart on its own endpoint rather than as a field on the edit
 * form — otherwise every ordinary text change would have to be a file upload.
 */
export const useUploadProgramImage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const body = new FormData();
      body.append("file", file);
      // The shared client defaults every request to Content-Type: application/json.
      // Left in place, that default wins over what FormData needs — the body
      // still serialises as multipart, but without the boundary parameter the
      // header is supposed to carry, so the server cannot split it back into
      // parts. Every other upload in this app clears it for this exact reason.
      return (await api.post<ApiResponse<Program>>(`/programs/${id}/image`, body, {
        headers: { "Content-Type": undefined },
      })).data;
    },
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "Image updated"); },
    onError: (e) => toast.error(errMsg(e, "Could not upload that image")),
  });
};

export const useDeleteProgram = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/programs/${id}`); },
    onSuccess: () => { invalidate(qc); toast.success("Program deleted"); },
    onError: (e) => toast.error(errMsg(e, "Could not delete that program")),
  });
};

/**
 * Take a place.
 *
 * The server's message is used rather than a fixed one: "This program is full"
 * arriving as a red toast is the answer, and replacing it with "Could not
 * register" would hide the only useful thing it said.
 */
export const useRegisterForProgram = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<ApiResponse<ProgramForUser>>(`/programs/${id}/register`)).data,
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "You have a place"); },
    onError: (e) => toast.error(errMsg(e, "Could not take a place")),
  });
};

export const useCancelRegistration = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete<ApiResponse<ProgramForUser>>(`/programs/${id}/register`)).data,
    onSuccess: (res) => { invalidate(qc); toast.success(res.message ?? "Your place has been given up"); },
    onError: (e) => toast.error(errMsg(e, "Could not give up that place")),
  });
};
