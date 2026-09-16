/* Offline cache for the Chaos Gacha web apps. App shell + data bundle;
 * player saves live in localStorage and need no network at all. */
const CACHE = "chaos-gacha-web-v2";
const ASSETS = [
  "./",
  "index.html",
  "tree.html",
  "gacha.html",
  "docs.html",
  "manifest.webmanifest",
  "favicon.svg",
  "css/app.css",
  "data/entries.js",
  "js/rng.js",
  "js/generator.js",
  "js/engine.js",
  "js/gacha.js",
  "js/tree-app.js",
  "js/gacha-app.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "social/social.png",
  "social/social-tree.png",
  "social/social-gacha.png"
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (ev) => {
  if (ev.request.method !== "GET") return;
  ev.respondWith(
    caches.match(ev.request, { ignoreSearch: true }).then((hit) => hit || fetch(ev.request))
  );
});
