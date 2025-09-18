// service-worker.js
// ⇨ Sube este número en cada deploy para invalidar caché viejo.
const APP_VERSION = '2025.09.1.4';
const PREFIX     = 'gestion-compras-cache-';
const CACHE_NAME = `${PREFIX}${APP_VERSION}`;

// App Shell básico (no incluimos módulos /apps/*.app.js a propósito)
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/fallback.html',
  '/app_extraccion.html',
  '/app_pedidos_movil.html',
  '/app_historial_transferencias.html',
  '/analizador_cotizaciones.html',
  '/state.js',
  '/app_loader.js',
  '/firebase-init.js',
];

// -------- Estrategias --------
async function networkFirst(req, fallbackUrl) {
  try {
    const fresh = await fetch(req, { cache: 'no-store' });
    // Cacheamos solo respuestas del mismo origen y OK
    if (fresh && fresh.ok && new URL(req.url).origin === self.location.origin) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    if (fallbackUrl) {
      const fb = await cache.match(fallbackUrl);
      if (fb) return fb;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh && fresh.ok && new URL(req.url).origin === self.location.origin) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
  }
  return fresh;
}

// -------- Ciclo de vida --------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
  self.skipWaiting(); // activar de una
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => (k.startsWith(PREFIX) && k !== CACHE_NAME) ? caches.delete(k) : null)
    );
    await self.clients.claim(); // tomar control inmediato
  })());
});

// -------- Interceptor --------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) No interceptar nada que no sea GET (deja pasar POST: BigQuery, etc.)
  if (req.method !== 'GET') {
    event.respondWith(fetch(req));
    return;
  }

  // 2) No interceptar orígenes externos (CDNs, Google APIs, etc.)
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(req));
    return;
  }

  // 3) BYPASS absoluto para módulos / scripts (evita fallback HTML → error de MIME)
  //    - Cualquier request con destination 'script'
  //    - Rutas tipo /apps/*.app.js (dynamic import)
  if (
    req.destination === 'script' ||
    /\.app\.js($|\?)/.test(url.pathname) ||
    (url.pathname.startsWith('/apps/') && url.pathname.endsWith('.js'))
  ) {
    event.respondWith(fetch(req)); // sin cache ni fallback
    return;
  }

  // 4) HTML (navegaciones/documentos) → network-first con fallback a index
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirst(req, '/index.html'));
    return;
  }

  // 5) CSS y Workers → network-first (mantener lo más nuevo)
  if (req.destination === 'style' || req.destination === 'worker') {
    event.respondWith(networkFirst(req));
    return;
  }

  // 6) Imágenes/fuentes/otros estáticos → cache-first (rendimiento)
  event.respondWith(cacheFirst(req));
});

// (Opcional) para flujos de “Aplicar actualización” desde la app
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
