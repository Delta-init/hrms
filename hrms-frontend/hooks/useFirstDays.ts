"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, FirstDaysView, HomeworkSendResult, TeamVideoInfo, VimeoVideo, WatchProgress } from "@/types";

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

/** Several documents in one request, as `files`. */
const uploadMany = (url: string, files: File[], fields: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append("files", f);
  return api.post<ApiResponse<FirstDaysView>>(url, form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 5 * 60 * 1000 });
};

// ── The joiner ──
export const useConfirmMySession = () =>
  useStep<void>(async () => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/session")).data.data!, "Session confirmed", "Could not confirm the session");
/** The joiner's answer to a homework: one or more files, added to what's there (or replacing it, on the old fixed slots). */
export const useAnswerHomework = () =>
  useStep(async ({ itemId, files }: { itemId: string; files: File[] }) =>
    (await uploadMany(`/first-days/mine/homework/${encodeURIComponent(itemId)}`, files)).data.data!, "Answer handed in", "Could not upload your answer");
/** Take one of their answer files back out. */
export const useRemoveAnswerFile = () =>
  useStep(async ({ itemId, key }: { itemId: string; key: string }) =>
    (await api.post<ApiResponse<FirstDaysView>>(`/first-days/mine/homework/${encodeURIComponent(itemId)}/files/remove`, { key })).data.data!, "File removed", "Could not remove the file");
/** A video homework's write-up, with any files they attach (added to those already there). */
export const useSubmitWriteUp = () =>
  useStep(async ({ itemId, notes, files }: { itemId: string; notes: string; files: File[] }) =>
    (await uploadMany(`/first-days/mine/homework/${encodeURIComponent(itemId)}/write-up`, files, { notes })).data.data!, "Write-up handed in", "Could not save your write-up");
export const useSubmitRolePlay = () =>
  useStep(async (link: string) => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/role-play", { link })).data.data!, "Role-play handed in", "Could not save the link");
export const useSubmitCallNotes = () =>
  useStep(async (notes: string) => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/call-notes", { notes })).data.data!, "Write-up handed in", "Could not save your write-up");
export const useCallsDone = () =>
  useStep<void>(async () => (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/calls")).data.data!, "Marked done", "Could not mark the calls done");

// ── Additional homework: the joiner's own presentation videos, slides and links ──
/**
 * Files (videos or documents) and/or a link. Files go up one at a time, so a
 * handful of large videos never travel in one request; `onProgress` gets the
 * whole batch's progress, 0–100. Only the first of a batch tells their head.
 */
type ExtraInput = { files?: File[]; link?: string; onProgress?: OnProgress };
/** Batch progress: `done` bytes already sent of `total`, plus this file's share. */
const share = (onProgress: OnProgress | undefined, done: number, size: number, total: number): OnProgress | undefined =>
  onProgress ? (p) => onProgress(Math.min(100, Math.round(((done + (size * p) / 100) / total) * 100))) : undefined;
/**
 * Files (then a link) added to one already there, one request each. Their
 * head hears about the first only — or about none, when `quiet` (the rest of
 * a batch whose first part already told them).
 */
async function sendExtraBatch(extraId: string, { files = [], link }: ExtraInput, onProgress?: OnProgress, quiet = false, done = 0, total = 0) {
  const base = `/first-days/mine/extras/${encodeURIComponent(extraId)}`;
  const all = total || files.reduce((n, f) => n + f.size, 0) || 1;
  let view: FirstDaysView | null = null;
  let told = quiet;
  for (const f of files) {
    view = (await upload(`${base}/file${told ? "?quiet=1" : ""}`, f, {}, share(onProgress, done, f.size, all))).data.data!;
    done += f.size;
    told = true;
  }
  if (link) view = (await api.post<ApiResponse<FirstDaysView>>(`${base}/link${told ? "?quiet=1" : ""}`, { link })).data.data!;
  return view;
}
export const useAddExtra = () =>
  useStep(async ({ title, folder = "", files = [], link, onProgress }: { title: string; folder?: string } & ExtraInput) => {
    // The first file (or the link) makes it and tells their head; the rest are added to it, quietly.
    const total = files.reduce((n, f) => n + f.size, 0) || 1;
    const [first, ...rest] = files;
    const created = first
      ? (await upload("/first-days/mine/extras/file", first, { title, folder }, share(onProgress, 0, first.size, total))).data.data!
      : (await api.post<ApiResponse<FirstDaysView>>("/first-days/mine/extras/link", { title, folder, link })).data.data!;
    const id = (created as FirstDaysView & { createdExtraId?: string }).createdExtraId;
    const more = { files: rest, link: first ? link : undefined };
    if (!id || (!more.files.length && !more.link)) return created;
    return (await sendExtraBatch(id, more, onProgress, true, first?.size ?? 0, total)) ?? created;
  }, "Handed in", "Could not hand it in");
export const useAddToExtra = () =>
  useStep(async ({ extraId, onProgress, ...input }: { extraId: string } & ExtraInput) => (await sendExtraBatch(extraId, input, onProgress))!,
    "Added", "Could not add it");
export const useRemoveFromExtra = () =>
  useStep(async ({ extraId, key, link }: { extraId: string; key?: string; link?: string }) =>
    (await api.post<ApiResponse<FirstDaysView>>(`/first-days/mine/extras/${encodeURIComponent(extraId)}/remove`, { key, link })).data.data!,
    "Removed", "Could not remove it");
export const useMoveExtra = () =>
  useStep(async ({ extraId, folder }: { extraId: string; folder: string }) =>
    (await api.post<ApiResponse<FirstDaysView>>(`/first-days/mine/extras/${encodeURIComponent(extraId)}/folder`, { folder })).data.data!,
    "Moved", "Could not move it");
export const useExtraFeedback = () =>
  useStep(async ({ employeeId, extraId, text }: { employeeId: string; extraId: string; text: string }) =>
    (await api.post<ApiResponse<FirstDaysView>>(`/first-days/${employeeId}/extras/${encodeURIComponent(extraId)}/feedback`, { text })).data.data!,
    "Feedback sent", "Could not send the feedback");

// ── Heads and HR ──
export const useConfirmSessionAsHead = () =>
  useStep(async (employeeId: string) => (await api.post<ApiResponse<FirstDaysView>>(`/first-days/${employeeId}/session`)).data.data!, "Session confirmed", "Could not confirm the session");
/** The videos in the company's Vimeo folder, for heads and HR picking a video homework. */
export const useVimeoVideos = (enabled = true) =>
  useQuery({
    queryKey: [...KEY, "vimeo"],
    queryFn: async () => (await api.get<ApiResponse<{ connected: boolean; videos: VimeoVideo[] }>>("/first-days/vimeo/videos")).data.data!,
    enabled,
    staleTime: 60 * 1000,
    retry: false,
  });

/** Ask Vimeo again now, past the server's short cache — after fixing a video's privacy there. */
export const useRefreshVimeo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.get<ApiResponse<{ connected: boolean; videos: VimeoVideo[] }>>("/first-days/vimeo/videos", { params: { fresh: "1" } })).data.data!,
    onSuccess: (d) => qc.setQueryData([...KEY, "vimeo"], d),
    onError: (e) => toast.error(errMsg(e, "Could not reach Vimeo")),
  });
};

/** What a homework is made of: question documents, one MP4, or a video from Vimeo by its id. */
type Source = { file?: File | null; files?: File[]; vimeoId?: string };

/** A homework for one of the joiner's days: question documents, an uploaded video, or a video from Vimeo. */
export const useAddHomework = () =>
  useStep(async ({ employeeId, title, day, folder = "", file, files, vimeoId, kind, onProgress }: { employeeId: string; title: string; day: string; folder?: string; kind: HomeworkKind; onProgress?: OnProgress } & Source) =>
    vimeoId
      ? (await api.post<ApiResponse<FirstDaysView>>(`/first-days/${employeeId}/homework/vimeo`, { title, day, folder, vimeoId })).data.data!
      : kind === "video"
        ? (await upload(`/first-days/${employeeId}/homework/video`, file ?? null, { title, day, folder }, onProgress)).data.data!
        : (await uploadMany(`/first-days/${employeeId}/homework`, files ?? [], { title, day, folder })).data.data!,
    "Homework sent", "Could not send the homework");
/** More question files for a document homework. */
export const useAddHomeworkFiles = () =>
  useStep(async ({ employeeId, itemId, files }: { employeeId: string; itemId: string; files: File[] }) =>
    (await uploadMany(`/first-days/${employeeId}/homework/${encodeURIComponent(itemId)}/files`, files)).data.data!, "Files added", "Could not add the files");
export const useRemoveHomeworkFile = () =>
  useStep(async ({ employeeId, itemId, key }: { employeeId: string; itemId: string; key: string }) =>
    (await api.post<ApiResponse<FirstDaysView>>(`/first-days/${employeeId}/homework/${encodeURIComponent(itemId)}/files/remove`, { key })).data.data!, "File removed", "Could not remove the file");
/** Put a homework in a folder — "" takes it out. */
export const useMoveHomework = () =>
  useStep(async ({ employeeId, itemId, folder }: { employeeId: string; itemId: string; folder: string }) =>
    (await api.post<ApiResponse<FirstDaysView>>(`/first-days/${employeeId}/homework/${encodeURIComponent(itemId)}/folder`, { folder })).data.data!, "Moved", "Could not move it");
/** Replace a homework's question document or video, or attach a question to an answer kept from before. */
export const useSetHomeworkQuestion = () =>
  useStep(async ({ employeeId, itemId, file, vimeoId, kind }: { employeeId: string; itemId: string; kind: HomeworkKind } & Source) => {
    const base = `/first-days/${employeeId}/homework/${encodeURIComponent(itemId)}`;
    return vimeoId
      ? (await api.post<ApiResponse<FirstDaysView>>(`${base}/vimeo`, { vimeoId })).data.data!
      : (await upload(`${base}/${kind === "video" ? "video" : "question"}`, file ?? null)).data.data!;
  }, "Saved", "Could not save the file");

/** One homework to several joiners, for the same date; resolves with how each went. */
export const useAddHomeworkToMany = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeIds, title, day, folder = "", file, files, vimeoId, kind, onProgress }: { employeeIds: string[]; title: string; day: string; folder?: string; kind: HomeworkKind; onProgress?: OnProgress } & Source) => {
      if (vimeoId) {
        const res = await api.post<ApiResponse<HomeworkSendResult[]>>("/first-days/homework/many/vimeo", { employeeIds, title, day, folder, vimeoId });
        return { results: res.data.data ?? [], message: res.data.message };
      }
      const sending = kind === "video" ? (file ? [file] : []) : files ?? [];
      if (!sending.length) throw new Error("Choose the file");
      const form = new FormData();
      form.append("title", title);
      form.append("day", day);
      form.append("folder", folder);
      form.append("employeeIds", JSON.stringify(employeeIds));
      for (const f of sending) form.append(kind === "video" ? "file" : "files", f);
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
      (await api.post<ApiResponse<{ video: { title: string; url: string; durationSeconds: number; vimeo?: { embedUrl: string } | null }; progress: WatchProgress }>>(`${watchBase(homeworkId)}/start`)).data.data!,
  });
export const useWatchBeat = (homeworkId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (position: number) => (await api.post<ApiResponse<WatchProgress>>(`${watchBase(homeworkId)}/beat`, { position })).data.data!,
    onSuccess: (p) => { if (p.completed) qc.invalidateQueries({ queryKey: KEY }); },
  });
};
