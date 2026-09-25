"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/axios";
import type { ApiResponse } from "@/types";

// The VAPID key travels as base64url; the browser wants a Uint8Array. Skipping
// this conversion is the most common reason subscribe() throws.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

/**
 * A notification that arrives with the app fully closed — a phone screen off,
 * a laptop shut — which the in-app bell cannot do, since that is a database
 * row a page has to be open to poll for.
 *
 * Never call `requestPermission` on page load: browsers penalise it and
 * people reflexively deny it. It belongs behind a button the person presses
 * having already seen why they'd want this — the bell, here.
 */
export function usePushNotification() {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const swRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PushPermission);

    // The PWA's own service worker, already registered for offline caching —
    // this reuses that registration rather than adding a second one.
    navigator.serviceWorker.ready
      .then(async (reg) => {
        swRef.current = reg;
        setIsSubscribed(!!(await reg.pushManager.getSubscription()));
      })
      .catch(() => null);
  }, []);

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    setIsLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PushPermission);
      if (result !== "granted") return;

      const reg = swRef.current ?? (await navigator.serviceWorker.ready);
      swRef.current = reg;

      const { data } = await api.get<ApiResponse<{ publicKey: string }>>("/push/vapid-public-key");
      const publicKey = data.data?.publicKey;
      if (!publicKey) return; // Web Push isn't configured on this server yet

      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true, // mandatory in Chrome — a silent push is not allowed
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });

      const sub = subscription.toJSON();
      await api.post("/push/subscribe", { endpoint: sub.endpoint, keys: sub.keys });
      setIsSubscribed(true);
    } catch (err) {
      console.error("Push subscription failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const reg = swRef.current;
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setIsSubscribed(false); return; }

      const { endpoint } = sub.toJSON();
      await sub.unsubscribe();
      await api.delete("/push/unsubscribe", { data: { endpoint } });
      setIsSubscribed(false);
    } catch (err) {
      console.error("Unsubscribe failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { permission, isSubscribed, isLoading, requestPermission, unsubscribe };
}
