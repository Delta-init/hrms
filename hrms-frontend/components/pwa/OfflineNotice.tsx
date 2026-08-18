"use client";
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Say when the connection has gone, because nothing else will.
 *
 * This app deliberately caches none of its data — attendance, leave and payroll
 * have to be current, so the service worker has no runtime caching at all. The
 * cost of that choice is that losing signal looks exactly like the app being
 * broken: spinners that never resolve and saves that quietly fail.
 *
 * Installed to a home screen there is no browser chrome to explain it either,
 * which is precisely when this matters most.
 */
export function OfflineNotice() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="mt-2 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>
        You are offline. Nothing will load or save until the connection is back — anything you were
        typing is still here.
      </span>
    </div>
  );
}
