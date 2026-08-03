"use client";
import { useEffect, useState } from "react";

/**
 * Returns true when the viewport is narrower than the `sm` breakpoint (640px).
 * Uses a matchMedia listener so it stays in sync with resize.
 */
export function useIsMobile(breakpoint = 640): boolean {
  // Lazily read the real value on the client's first render instead of always
  // starting at `false` — otherwise a dialog opened before this hook's effect
  // has run renders the desktop layout even on a mobile viewport (no scroll
  // container, unreachable buttons) until a later re-render corrects it.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    setIsMobile(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
}
