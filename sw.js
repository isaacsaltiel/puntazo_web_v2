// Service worker: instalabilidad + caché de los assets inmutables.
//
// Regla de oro (no cambiar sin pensarlo): el HTML y los JSON de datos NUNCA
// se cachean aquí. El riesgo de servir una versión vieja del sitio no lo vale
// y GitHub Pages ya maneja el caché HTTP de esos.
//
// Lo que SÍ se cachea es solo /assets/lib/**: el SDK de Firebase y las fuentes.
// Esos archivos llevan la versión en la ruta (.../firebase-9.23.0/...), así que
// no pueden quedar viejos: si algún día se sube de versión, cambia la ruta y
// el navegador pide la nueva. A cambio, el usuario que vuelve se ahorra ~600 KB
// y, más importante, la página arranca aunque la red esté pésima.
const CACHE = "puntazo-lib-v1";
const CACHEABLE = "/assets/lib/";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n !== CACHE;
            })
            .map(function (n) {
              return caches.delete(n);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Solo mismo origen y solo la carpeta de assets versionados.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(CACHEABLE) !== 0) return;

  // Cache-first: si ya lo tenemos, ni tocamos la red.
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) {
            c.put(req, copy);
          });
        }
        return res;
      });
    })
  );
});
