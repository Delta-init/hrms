"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

/**
 * Redirects users who haven't completed their mandatory profile to the
 * onboarding wizard. Skipped while impersonating so admins never get stuck.
 */
export function OnboardingGate() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "authenticated") return;
    if (session?.impersonatedBy) return;
    const completed = (session?.user as { profileCompleted?: boolean } | undefined)?.profileCompleted;
    if (completed === false) router.replace("/onboarding");
  }, [session, status, router]);

  return null;
}
