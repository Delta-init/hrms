"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, FirstDaysView, TeamVideoInfo, WatchProgress } from "@/types";

const KEY = ["first-days"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

/**
 * The joiner's own guide — null for everybody else, which is almost everyone.
 * Asked on every page by the theme, so it is cached for a few minutes.
 */
export const useMyFirstDays = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "mine"],
    queryFn: async () => (await api.get<ApiResponse<FirstDaysView | null>>("/first-days/mine")).data.data ?? null,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

/** The new joiners a head or HR looks after. Empty for everyone else. */
export const useTeamFirstDays = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "team"],
    queryFn: async () => (await api.get<ApiResponse<FirstDaysView[]>>("/first-days/team")).data.data ?? [],
    enabled,
    staleTime: 60 * 1000,
  });

/** Every first-days action returns the guide as it now stands; the lists refresh behind it. */
function useStep<V>(fn: (vars: V) => Promise<FirstDaysView>, done: string, failed: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success(done); },
    onError: (e) => toast.error(errMsg(e, failed)),
  });
}

const upload = (url: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<ApiResponse<FirstDaysView>>(url, form, { headers: { "Content-Type": "multipart/form-data" } });
};

// ── The joiner ──
export const useConfirmMySession = () =>
  useStep<void>(async () => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/session")).data.data!, "Session confirmed", "Could not confirm the session");
export const useHandInHomework = () =>
  useStep(async (file: File) => (await upload("/first-days/mine/homework", file)).data.data!, "Homework handed in", "Could not upload your homework");
export const useSubmitRolePlay = () =>
  useStep(async (link: string) => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/role-play", { link })).data.data!, "Role-play handed in", "Could not save the link");
export const useSubmitCallNotes = () =>
  useStep(async (notes: string) => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/call-notes", { notes })).data.data!, "Write-up handed in", "Could not save your write-up");
export const useCallsDone = () =>
  useStep<void>(async () => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/calls")).data.data!, "Marked done", "Could not mark the calls done");

// ── Heads and HR ──
export const useConfirmSessionAsHead = () =>
  useStep(async (employeeId: string) => (await api.post<ApiResponse<FirstDaysView>>(`/first-days/${employeeId}/session`)).data.data!, "Session confirmed", "Could not confirm the session");
export const useSendHomework = () =>
  useStep(async ({ employeeId, file }: { employeeId: string; file: File }) => (await upload(`/first-days/${employeeId}/homework`, file)).data.data!, "Homework sent", "Could not send the homework");
export const useSetToolAccess = () =>
  useStep(async ({ employeeId, tool, given }: { employeeId: string; tool: "threeCx" | "zoho" | "crm"; given: boolean }) =>
    (await api.post<ApiResponse<FirstDaysView>>(`/first-days/${employeeId}/access`, { tool, given })).data.data!, "Access updated", "Could not update access");
export const useAssignClients = () =>
  useStep(async (employeeId: string) => (await api.post<ApiResponse<FirstDaysView>>(`/first-days/${employeeId}/clients`)).data.data!, "Clients marked as assigned", "Could not save that");

// ── The team video ──
export const useTeamVideo = (departmentId?: string, enabled = true) =>
  useQuery({
    queryKey: [...KEY, "team-video", departmentId],
    queryFn: async () => (await api.get<ApiResponse<TeamVideoInfo | null>>(`/first-days/team-video/${departmentId}`)).data.data ?? null,
    enabled: !!departmentId && enabled,
    retry: false,
  });

export const useUploadTeamVideo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ departmentId, file, title }: { departmentId: string; file: File; title?: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (title) form.append("title", title);
      return (await api.post<ApiResponse<TeamVideoInfo>>(`/first-days/team-video/${departmentId}`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 10 * 60 * 1000,
      })).data.data!;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("Team video uploaded"); },
    onError: (e) => toast.error(errMsg(e, "Could not upload the video")),
  });
};

/** The joiner watching it: open where they left off, then report the playhead. Silent — it fires every few seconds. */
export const useStartTeamVideo = () =>
  useMutation({
    mutationFn: async () =>
      (await api.post<ApiResponse<{ video: { title: string; url: string; durationSeconds: number }; progress: WatchProgress }>>("/first-days/mine/team-video/start")).data.data!,
  });
export const useTeamVideoBeat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (position: number) => (await api.post<ApiResponse<WatchProgress>>("/first-days/mine/team-video/beat", { position })).data.data!,
    onSuccess: (p) => { if (p.completed) qc.invalidateQueries({ queryKey: KEY }); },
  });
};
