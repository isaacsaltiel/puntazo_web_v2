// Carga centralizada de analítica: GA4 + Microsoft Clarity.
// La inyecta header.js en todas las páginas con header; las páginas
// jugador-facing sin header (boton, marcador, king, americano, sortear,
// tablero) la cargan con <script> propio.
// Regla: solo mide en el dominio real — localhost / file:// quedan fuera.
(function () {
  "use strict";

  if (window.__PZ_ANALYTICS_LOADED__) return;
  window.__PZ_ANALYTICS_LOADED__ = true;

  var GA_ID = "G-7HTMSTJ035";
  // Pegar aquí el Project ID de clarity.microsoft.com para activar Clarity.
  // Vacío = Clarity apagado (el resto sigue funcionando igual).
  var CLARITY_ID = "";

  var host = (location.hostname || "").toLowerCase();
  var esProduccion = host === "puntazoclips.com" || host.slice(-16) === ".puntazoclips.com";
  if (!esProduccion) return;

  // GA4 — index.html y lado.html ya traen el snippet inline en el <head>;
  // en ese caso no duplicamos config (doble page_view).
  var yaTieneGtag = !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]');
  if (!yaTieneGtag) {
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID);
  }

  // Microsoft Clarity — mapas de calor y grabaciones de sesión.
  if (CLARITY_ID) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
      y = l.getElementsByTagName(r)[0];
      if (y && y.parentNode) { y.parentNode.insertBefore(t, y); } else { l.head.appendChild(t); }
    })(window, document, "clarity", "script", CLARITY_ID);
  }
})();
