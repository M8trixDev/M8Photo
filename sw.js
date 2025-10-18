const CACHE_NAME = "m8photo-shell-v2";
const OFFLINE_DOCUMENT = "/offline.html";
const OFFLINE_IMAGE = "/assets/icons/icon-192.png";

const SHELL_ASSETS = [
  "/",
  "/index.html",
  OFFLINE_DOCUMENT,
  "/manifest.json",
  "/styles/theme.css",
  "/styles/layout.css",
  "/styles/components.css",
  "/scripts/main.js",
  "/scripts/toolbar.js",
  "/scripts/panels.js",
  "/modules/core/store.js",
  "/modules/core/history.js",
  "/modules/core/events.js",
  "/modules/core/canvasEngine.js",
  "/modules/layers/layerManager.js",
  "/modules/layers/thumbnails.js",
  "/modules/layers/blendModes.js",
  "/modules/view/viewport.js",
  "/modules/tools/index.js",
  "/modules/tools/move.js",
  "/modules/tools/brush.js",
  "/modules/tools/eraser.js",
  "/modules/ui/panels/layersPanel.js",
  "/modules/ui/panels/propertiesPanel.js",
  "/modules/dev/harness.js",
  "/modules/persist/indexeddb.js",
  "/modules/persist/autosave.js",
  OFFLINE_IMAGE,
  "/assets/icons/icon-512.png",
  "/assets/icons/favicon-64.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const { request } = event;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);

    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      const copy = response.clone();
      cache.put(request, copy);

      const { pathname } = new URL(request.url);
      if (pathname === "/" || pathname === "/index.html") {
        cache.put("/index.html", response.clone());
      }
    }

    return response;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    if (cached) {
      return cached;
    }

    const offline = await cache.match(OFFLINE_DOCUMENT);
    if (offline) {
      return offline;
    }

    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);

    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    return fallbackResponse(cache, request);
  }
}

async function fallbackResponse(cache, request) {
  const fallback = await (async () => {
    switch (request.destination) {
      case "document": {
        const offlinePage = await cache.match(OFFLINE_DOCUMENT);
        if (offlinePage) {
          return offlinePage;
        }
        return new Response("Offline", {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      case "image": {
        const offlineImage = await cache.match(OFFLINE_IMAGE);
        if (offlineImage) {
          return offlineImage;
        }
        return Response.error();
      }
      case "style":
        return new Response("/* offline */", {
          status: 200,
          headers: { "Content-Type": "text/css; charset=utf-8" },
        });
      case "script":
      case "worker":
        return new Response("// offline", {
          status: 200,
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      default:
        return Response.error();
    }
  })();

  return fallback;
}
