const CACHE = "printdesk-shell-v2";
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon.svg"]))));
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()),
));
self.addEventListener("fetch", (event) => {
  if (event.request.method === "GET" && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  }
});
