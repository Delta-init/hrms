"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";
import type { ApiResponse, BackupRun, RestorePreview } from "@/types";

const KEY = ["backups"] as const;

function errMsg(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

export const useBackups = (enabled = true) =>
  useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<ApiResponse<BackupRun[]>>("/backups")).data.data ?? [],
    enabled,
  });

/**
 * Run one now.
 *
 * No optimistic anything: it reads every collection and takes a few seconds,
 * and a row that appears before the archive exists would invite somebody to
 * download nothing.
 */
export const useCreateBackup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<ApiResponse<BackupRun>>("/backups")).data,
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: KEY }); toast.success(res.message ?? "Backup complete"); },
    onError: (e) => toast.error(errMsg(e, "The backup did not finish")),
  });
};

/** What restoring a collection would do. Reads only. */
export const useRestorePreview = (backupId: string | null, collection: string | null) =>
  useQuery({
    queryKey: [...KEY, "preview", backupId, collection],
    queryFn: async () =>
      (await api.get<ApiResponse<RestorePreview>>(`/backups/${backupId}/preview`, { params: { collection } })).data.data!,
    enabled: !!backupId && !!collection,
  });

export const useRestoreCollection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, collection }: { id: string; collection: string }) =>
      (await api.post<ApiResponse<{ restored: number }>>(`/backups/${id}/restore`, { collection })).data,
    onSuccess: (res) => {
      // Everything, not just the backups list: a restore can have changed any
      // collection in the application, so nothing cached is trustworthy after it.
      qc.invalidateQueries();
      toast.success(res.message ?? "Restored");
    },
    onError: (e) => toast.error(errMsg(e, "The restore did not run")),
  });
};

/**
 * Download an archive.
 *
 * Fetched through the same client as everything else so the auth header goes
 * with it — a plain link would arrive unauthenticated and be refused.
 */
export async function downloadBackup(id: string, filename: string) {
  const res = await api.get(`/backups/${id}/download`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "backup.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
