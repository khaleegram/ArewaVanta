const BUILD_ID = "__APP_BUILD_ID__";
const OFFLINE_CACHE = `arewavanta-offline-${BUILD_ID}`;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // An unavailable offline page must not prevent an online app update.
    try {
      const response = await fetch("/offline.html", { cache: "no-store" });
      if (response.ok) await (await caches.open(OFFLINE_CACHE)).put("/offline.html", response);
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("arewavanta-") && key !== OFFLINE_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: "AREWAVANTA_RELEASE", buildId: BUILD_ID }));
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || request.mode !== "navigate") return;
  // HTML and API data never come from an old application shell. Vite's hashed
  // assets use the browser's normal HTTP cache, not a second worker cache.
  event.respondWith(fetch(request, { cache: "no-store" }).catch(async () => {
    const offline = await (await caches.open(OFFLINE_CACHE)).match("/offline.html");
    return offline || new Response("You’re offline. Reconnect to open ArewaVanta.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});

self.addEventListener("push", (event) => {
  let data = { title: "ArewaVanta", body: "There is new community activity." };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  const target = new URL(data.url || "/manage/directory", self.location.origin);
  const targetUrl = target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: "/favicon-192.png", badge: "/favicon-48.png",
    ...(data.tag ? { tag: data.tag } : {}), data: { url: targetUrl },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  event.waitUntil(self.clients.openWindow(target.origin === self.location.origin ? target.href : self.location.origin));
});
