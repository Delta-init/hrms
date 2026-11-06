"use client";
import { useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowRight, Sprout } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMyFirstDays } from "@/hooks/useFirstDays";

/** The joiner's guide, asked only by a real signed-in person — never the kiosk tablet. */
function useMine() {
  const { status } = useSession();
  const { isKioskOnly } = useAuth();
  return useMyFirstDays(status === "authenticated" && !isKioskOnly);
}

/**
 * Turns the whole portal red for a new joiner's first fifteen days.
 *
 * An attribute on <html>, not a theme of its own: light and dark mode carry on
 * underneath, and only the brand colours change (globals.css). Taken off the
 * moment the window closes, or this unmounts.
 */
export function FirstDaysTheme() {
  const { data, isSuccess } = useMine();
  const { user } = useAuth();
  const red = !!data?.redActive;
  // Remembered per login in this browser, so a full page load starts red
  // rather than flashing blue until the guide has loaded. The server's answer
  // replaces it as soon as it arrives.
  const remembered = user?._id ? `first-days-red:${user._id}` : null;

  useLayoutEffect(() => {
    if (!remembered) return;
    try { if (localStorage.getItem(remembered) === "1") document.documentElement.dataset.accent = "red"; } catch { /* private mode */ }
  }, [remembered]);

  useEffect(() => {
    if (!isSuccess) return;
    const el = document.documentElement;
    if (red) el.dataset.accent = "red";
    else delete el.dataset.accent;
    try {
      if (remembered && red) localStorage.setItem(remembered, "1");
      else if (remembered) localStorage.removeItem(remembered);
    } catch { /* private mode */ }
  }, [red, isSuccess, remembered]);

  useEffect(() => () => { delete document.documentElement.dataset.accent; }, []);
  return null;
}

/** "Day 4 of 15" on every page, linking to the guide — the reason the portal is red, said. */
export function FirstDaysBanner() {
  const { data } = useMine();
  if (!data?.redActive) return null;
  return (
    <Link
      href="/first-days"
      className="mt-2 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-primary transition-colors hover:bg-primary/15"
    >
      <Sprout className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>Day {data.day} of {data.of}</strong> — your first-days guide
        <span className="text-primary/80"> · {data.doneCount} of {data.totalCount} steps done</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0" />
    </Link>
  );
}
