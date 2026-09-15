const CACHE = "zhitiao-shell-v1";
const SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/icon.svg", "/fonts/Muyao-Softbrush.ttf"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((res) => res || caches.match("/offline.html"))));
});
self.addEventListener("push", (event) => {
  event.waitUntil(self.registration.showNotification("纸条", { body: "你有一条新消息。", icon: "/icon.svg", badge: "/icon.svg", data: { url: "/" } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((client) => "focus" in client);
    return open ? open.focus() : clients.openWindow(event.notification.data?.url || "/");
  }));
});
