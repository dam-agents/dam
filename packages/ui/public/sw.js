// UNIT_BOUNDARY_DESCRIPTION: replaces the vite-plugin-pwa worker browsers still have registered: clears its caches and unregisters. Delete in 2027.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" }))
        client.navigate(client.url);
    })(),
  );
});
