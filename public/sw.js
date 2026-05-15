// LeadHub — Service Worker para Web Push notifications.
// Mantém o mínimo: receber push, mostrar notificação, abrir URL ao clicar.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "LeadHub", body: event.data.text() };
  }

  const title = payload.title || "LeadHub";
  const options = {
    body: payload.body || "",
    // /icon-192.png nao existe no /public — usa favicon como fallback. Em
    // alguns browsers (Brave/Chrome no macOS) icon 404 descarta a notificacao
    // silenciosamente. badge fica fora: browser usa default se omitido.
    icon: payload.icon || "/favicon.ico",
    tag: payload.tag,
    data: { url: payload.url || "/" },
    image: payload.image,
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Se já tem uma aba do LeadHub aberta, foca + navega
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Senão abre nova
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
