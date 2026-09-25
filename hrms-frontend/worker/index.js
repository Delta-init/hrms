// Web Push handling, merged into the PWA's own generated service worker by
// @ducanh2912/next-pwa (customWorkerSrc: "worker" — its default, unchanged).
// Plain JS on purpose: this runs inside the worker's build, not the app's.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Delta HRMS", body: event.data.text() };
  }

  const title = payload.title ?? "Delta HRMS";
  const options = {
    body: payload.body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag,
    data: { url: payload.url ?? "/dashboard", ...(payload.data ?? {}) },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url ?? "/dashboard";
  const origin = self.location.origin;
  const fullUrl = url.startsWith("http") ? url : origin + url;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // The app is already open somewhere — focus it and tell it where to
      // go, rather than opening a second window on top of the first.
      for (const client of clientList) {
        if (client.url.startsWith(origin) && "focus" in client) {
          client.postMessage({ type: "NAVIGATE", url });
          return client.focus();
        }
      }
      return self.clients.openWindow(fullUrl);
    })
  );
});
