"use client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import api from "@/lib/axios";

/**
 * The filled joining form — the caller's own, or (with an employeeId)
 * someone else's, for HR viewing an employee's profile.
 *
 * A download rather than a query: this isn't data to hold in a cache and
 * re-render, it's a generated file, requested once and handed to the browser
 * to save. `responseType: "blob"` is what makes axios treat the PDF bytes as
 * a file instead of trying to parse them as JSON.
 */
function errMsg(e: unknown, f: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f;
}

export const useDownloadOnboardingForm = (employeeId?: string) => {
  const path = employeeId ? `/employees/${employeeId}/onboarding-form` : "/auth/onboarding-form";
  return useMutation({
    mutationFn: async () => {
      const res = await api.get(path, { responseType: "blob" });
      const disposition = res.headers["content-disposition"] as string | undefined;
      const fileName = disposition?.match(/filename="([^"]+)"/)?.[1] ?? "onboarding-form.pdf";
      return { blob: res.data as Blob, fileName };
    },
    onSuccess: ({ blob, fileName }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast.error(errMsg(e, "Could not generate the onboarding form")),
  });
};
