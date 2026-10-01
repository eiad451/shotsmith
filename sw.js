/**
 * Offline shell.
 *
 * Only the static shell is cached. Provider requests (api.microlink.io,
 * image.thum.io) are deliberately never cached: the response IS the product
 * here, the bytes are megabytes, and microlink serves repeated identical
 * requests from its own cache anyway — caching them again would burn the user's
 * device storage for nothing.
 */

const VERSION = "shotsmith-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/css/app.css",
  "./assets/js/app.js",
  "./assets/js/capture-engine.js",
  "./assets/js/command-bar.js",
  "./assets/js/device-presets.js",
  "./assets/js/dom.js",
  "./assets/js/exporter.js",
  "./assets/js/qr-encoder.js",
  "./assets/js/qr-tables.js",
  "./assets/js/session-store.js",
  "./assets/js/share-link.js",
  "./assets/js/target-guard.js",
  "./assets/js/theme-boot.js",
  "./assets/js/viewer.js",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // Individually, so one missing optional file cannot fail the install.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Providers and fonts stay on the network. This also means capture bytes are
  // never cached: they arrive cross-origin from microlink / thum.io.
  if (url.origin !== self.location.origin) return;

  // Navigations: cache-first so a reload works offline, refreshed in the
  // background when the network is available.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) caches.open(VERSION).then((c) => c.put("./index.html", response.clone()));
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});