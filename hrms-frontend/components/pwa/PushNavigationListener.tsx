"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Where a push notification's click lands when the app is already open in a
 * tab. The service worker (worker/index.js) focuses that tab and posts the
 * destination here rather than opening a second window on top of it; without
 * this listener that message arrived and nobody was navigated anywhere.
 *
 * Only ever navigates to our own paths. A message claiming any other URL is
 * ignored rather than followed — a service worker message is not something
 * this page is in a position to fully trust the origin of.
 */
export function PushNavigationListener() {
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const url = event.data?.url;
      if (event.data?.type === "NAVIGATE" && typeof url === "string" && url.startsWith("/")) {
        router.push(url);
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
