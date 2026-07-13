// Service worker mínimo: existe solo para que el sitio sea instalable
// (Agregar a pantalla de inicio). NO cachea nada — todo pasa directo a la
// red; GitHub Pages ya maneja el caché HTTP. Si algún día queremos offline,
// este es el lugar, pero hoy el riesgo de servir HTML viejo no lo vale.
self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", function () {
  // Sin respondWith: el navegador resuelve normal contra la red.
});
