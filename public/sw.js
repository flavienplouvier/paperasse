// Service worker de Paperasse : l'application reste utilisable hors ligne.
// Stratégie : réseau d'abord pour la page (mises à jour rapides),
// réseau d'abord pour les index (.json), cache d'abord pour les fichiers
// versionnés (JS, CSS, polices, CMaps) et pour les polices du catalogue libre
// Google Fonts (adresses liées à une version figée du dépôt, donc immuables).
const CACHE = "paperasse-v2";
const FONT_CACHE = "paperasse-catalogue-polices";
const CATALOG_FONTS = "https://raw.githubusercontent.com/google/fonts/";

function cacheFirst(req, cacheName) {
  return caches.match(req).then(
    (hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(cacheName).then((c) => c.put(req, copy));
        }
        return res;
      }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.url.startsWith(CATALOG_FONTS)) {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith(".json")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(cacheFirst(req, CACHE));
});
