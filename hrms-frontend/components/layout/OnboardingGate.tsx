"use client";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMyAgreements } from "@/hooks/useAgreements";

/**
 * Holds a new joiner at onboarding until they are actually onboarded.
 *
 * Two gates in sequence: the profile wizard, then the induction and
 * agreements. Skipped while impersonating so admins never get stuck.
 *
 * The second gate is deliberately timid. It redirects only on a definite
 * "required, and not signed" — never because the answer could not be worked
 * out. A missing template or an unclassified employee is an administrative
 * gap, and turning that into a company-wide lockout would be a far worse
 * failure than someone reaching their dashboard a day early.
 */
export function OnboardingGate() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const impersonating = !!session?.impersonatedBy;
  const profileDone = (session?.user as { profileCompleted?: boolean } | undefined)?.profileCompleted;

  // Only asked once the profile is done, so a brand-new account is not making
  // two redirect decisions at once.
  const { data: agreements } = useMyAgreements({
    enabled: status === "authenticated" && !impersonating && profileDone === true && !pathname.startsWith("/onboarding"),
  });

  useEffect(() => {
    if (status !== "authenticated" || impersonating) return;
    if (profileDone === false) { router.replace("/onboarding"); return; }
    if (agreements?.required && agreements.cleared === false && !pathname.startsWith("/onboarding")) {
      router.replace("/onboarding/agreements");
    }
  }, [status, impersonating, profileDone, agreements, pathname, router]);

  return null;
}
