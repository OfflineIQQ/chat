self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const key = e.notification.data && e.notification.data.key;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    if (list.length) {
      const c = list[0];
      if (key) c.postMessage({ open: key });
      return c.focus();
    }
    return self.clients.openWindow("./");
  }));
});
