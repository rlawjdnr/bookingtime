self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title = payload.title || "김한의원";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: {
        url: payload.url || "/?view=myBookings",
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/?view=myBookings", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("navigate" in client && "focus" in client) {
          return client.navigate(targetUrl).then((navigatedClient) => (navigatedClient || client).focus());
        }
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});

function readPushPayload(event) {
  try {
    return event.data?.json() || {};
  } catch {
    return {};
  }
}
