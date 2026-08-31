"use client";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

/**
 * Keeps the tablet by the door on the tablet screen.
 *
 * Hiding the menu is not a lock — the pages are still a typed URL away, and a
 * device left unattended in a reception area is exactly where somebody will
 * try one. So an account whose only permission is the kiosk is sent back to it
 * from anywhere else in the app.
 *
 * This is the second of two fences, not the only one. Every endpoint still
 * checks the permission itself, so the account would be refused the data even
 * if this never ran; what this prevents is a half-rendered admin page sitting
 * open on a screen in the lobby.
 */
export function KioskLock() {
  const { isKioskOnly, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading || !isKioskOnly) return;
    if (pathname === "/kiosk" || pathname.startsWith("/kiosk/")) return;
    router.replace("/kiosk");
  }, [isKioskOnly, isLoading, pathname, router]);

  return null;
}
