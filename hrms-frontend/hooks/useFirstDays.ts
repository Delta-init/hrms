"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, FirstDaysView, HomeworkSendResult, TeamVideoInfo, WatchProgress } from "@/types";

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

/** Called with 0–100 as a large upload goes. */
export type OnProgress = (percent: number) => void;

const upload = (url: string, file: File | null, fields: Record<string, string> = {}, onProgress?: OnProgress) => {
  const form = new FormData();
  // Fields first: the server reads them alongside the file.
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append("file", file);
  return api.post<ApiResponse<FirstDaysView>>(url, form, {
    headers: { "Content-Type": "multipart/form-data" },
    // A homework video can be 250 MB.
    timeout: 10 * 60 * 1000,
    onUploadProgress: onProgress ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); } : undefined,
  });
};

export type HomeworkKind = "document" | "video";

// ── The joiner ──
export const useConfirmMySession = () =>
  useStep<void>(async () => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/session")).data.data!, "Session confirmed", "Could not confirm the session");
/** The joiner's answer to one homework, or a new version of it. */
export const useAnswerHomework = () =>
  useStep(async ({ itemId, file }: { itemId: string; file: File }) =>
    (await upload(`/first-days/mine/homework/${encodeURIComponent(itemId)}`, file)).data.data!, "Answer handed in", "Could not upload your answer");
/** A video homework's write-up, with a file if they attach one. */
export const useSubmitWriteUp = () =>
  useStep(async ({ itemId, notes, file }: { itemId: string; notes: string; file: File | null }) =>
    (await upload(`/first-days/mine/homework/${encodeURIComponent(itemId)}/write-up`, file, { notes })).data.data!, "Write-up handed in", "Could not save your write-up");
export const useSubmitRolePlay = () =>
  useStep(async (link: string) => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/role-play", { link })).data.data!, "Role-play handed in", "Could not save the link");
export const useSubmitCallNotes = () =>
  useStep(async (notes: string) => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/call-notes", { notes })).data.data!, "Write-up handed in", "Could not save your write-up");
export const useCallsDone = () =>
  useStep<void>(async () => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/calls")).data.data!, "Marked done", "Could not mark the calls done");

// ── Heads and HR ──
export const useConfirmSessionAsHead = () =>
  useStep(async (employeeId: string) => (await api.post<ApiResponse<FirstDaysView>>(`/first-days/${employeeId}/session`)).data.data!, "Session confirmed", "Could not confirm the session");
/** A homework for one of the joiner's days: a question document, or a video. */
export const useAddHomework = () =>
  useStep(async ({ employeeId, title, day, file, kind, onProgress }: { employeeId: string; title: string; day: string; file: File; kind: HomeworkKind; onProgress?: OnProgress }) =>
    (await upload(`/first-days/${employeeId}/homework${kind === "video" ? "/video" : ""}`, file, { title, day }, onProgress)).data.data!, "Homework sent", "Could not send the homework");
/** Replace a homework's question document or video, or attach a question to an answer kept from before. */
export const useSetHomeworkQuestion = () =>
  useStep(async ({ employeeId, itemId, file, kind }: { employeeId: string; itemId: string; file: File; kind: HomeworkKind }) =>
    (await upload(`/first-days/${employeeId}/homework/${encodeURIComponent(itemId)}/${kind === "video" ? "video" : "question"}`, file)).data.data!, "Saved", "Could not save the file");

/** One homework to several joiners, for the same date; resolves with how each went. */
export const useAddHomeworkToMany = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeIds, title, day, file, kind, onProgress }: { employeeIds: string[]; title: string; day: string; file: File; kind: HomeworkKind; onProgress?: OnProgress }) => {
      const form = new FormData();
      form.append("title", title);
      form.append("day", day);
      form.append("employeeIds", JSON.stringify(employeeIds));
      form.append("file", file);
      const res = await api.post<ApiResponse<HomeworkSendResult[]>>(`/first-days/homework/many${kind === "video" ? "/video" : ""}`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 10 * 60 * 1000,
        onUploadProgress: onProgress ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); } : undefined,
      });
      return { results: res.data.data ?? [], message: res.data.message };
    },
    onSuccess: ({ results, message }) => {
      qc.invalidateQueries({ queryKey: KEY });
      if (results.every((r) => r.ok)) toast.success(message ?? "Homework sent");
      else toast.error(message ?? "Some could not be sent");
    },
    onError: (e) => toast.error(errMsg(e, "Could not send the homework")),
  });
};
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

/**
 * The joiner watching a video they must see in full — the team's video, or a
 * video homework when `homeworkId` is given: open where they left off, then
 * report the playhead. Silent — it fires every few seconds.
 */
const watchBase = (homeworkId?: string) =>
  homeworkId ? `/first-days/mine/homework/${encodeURIComponent(homeworkId)}/video` : "/first-days/mine/team-video";
export const useStartWatching = (homeworkId?: string) =>
  useMutation({
    mutationFn: async () =>
      (await api.post<ApiResponse<{ video: { title: string; url: string; durationSeconds: number }; progress: WatchProgress }>>(`${watchBase(homeworkId)}/start`)).data.data!,
  });
export const useWatchBeat = (homeworkId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (position: number) => (await api.post<ApiResponse<WatchProgress>>(`${watchBase(homeworkId)}/beat`, { position })).data.data!,
    onSuccess: (p) => { if (p.completed) qc.invalidateQueries({ queryKey: KEY }); },
  });
};
