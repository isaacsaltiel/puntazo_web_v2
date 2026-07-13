// PWA: hace el sitio instalable y ofrece "Agregar a pantalla de inicio".
// - Android/Chrome: captura beforeinstallprompt y muestra botón propio
//   ("Instalar" = un tap, sin instructivo).
// - iPhone/iPad: Apple no expone API; mostramos mini-instructivo visual
//   (Compartir → Agregar a pantalla de inicio).
// La inyecta header.js; páginas sin header la cargan con <script> propio.
(function () {
  "use strict";

  if (window.__PZ_PWA_LOADED__) return;
  window.__PZ_PWA_LOADED__ = true;

  var SNOOZE_KEY = "pz_pwa_snooze_hasta";
  var SNOOZE_DIAS = 30;

  // 1) Garantizar manifest + apple-touch-icon en el <head> (la mayoría de
  //    las 42 páginas no los traen estáticos; Chrome acepta inyección).
  try {
    if (!document.querySelector('link[rel="manifest"]')) {
      var lm = document.createElement("link");
      lm.rel = "manifest";
      lm.href = "/manifest.json";
      document.head.appendChild(lm);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      var la = document.createElement("link");
      la.rel = "apple-touch-icon";
      la.setAttribute("sizes", "180x180");
      la.href = "/assets/icons/apple-icon-180x180.png";
      document.head.appendChild(la);
    }
  } catch (e) {}

  // 2) Service worker (requisito del prompt de instalación en Android).
  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  // 3) Si ya corre instalada (standalone), no molestar.
  var standalone = false;
  try {
    standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
                 window.navigator.standalone === true;
  } catch (e) {}
  if (standalone) return;

  // Snooze: si el usuario cerró el banner, no insistir por 30 días.
  var snoozed = false;
  try {
    var hasta = parseInt(localStorage.getItem(SNOOZE_KEY) || "0", 10);
    snoozed = !!hasta && Date.now() < hasta;
  } catch (e) {}

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DIAS * 24 * 60 * 60 * 1000));
    } catch (e) {}
  }

  function track(nombre, params) {
    try { if (window.gtag) window.gtag("event", nombre, params || {}); } catch (e) {}
  }

  // iPadOS 13+ se reporta como Mac, se distingue por touch.
  var esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  var deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();          // guardamos el prompt para nuestro botón
    deferredPrompt = e;
    if (!snoozed) cuandoHayaBody(function () { mostrarBanner("android"); });
  });

  window.addEventListener("appinstalled", function () {
    track("pwa_installed");
    ocultarBanner();
    snooze();
  });

  if (esIOS && !snoozed) {
    // Safari nunca dispara beforeinstallprompt: mostrar tras una pausa.
    setTimeout(function () { cuandoHayaBody(function () { mostrarBanner("ios"); }); }, 3500);
  }

  function cuandoHayaBody(fn) {
    if (document.body) { fn(); return; }
    document.addEventListener("DOMContentLoaded", fn);
  }

  // ── UI ─────────────────────────────────────────────────────────
  var banner = null;
  var overlay = null;

  function injectStyles() {
    if (document.getElementById("pz-pwa-styles")) return;
    var st = document.createElement("style");
    st.id = "pz-pwa-styles";
    st.textContent = [
      "#pz-pwa-banner{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:1300;",
      "display:flex;align-items:center;gap:0.75rem;width:min(430px,calc(100vw - 24px));padding:0.7rem 0.8rem;",
      "background:rgba(8,14,28,.95);border:1px solid rgba(255,255,255,.12);border-radius:18px;",
      "box-shadow:0 22px 46px rgba(0,0,0,.5);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);",
      "font-family:'Montserrat',system-ui,sans-serif;color:#eaf2ff;animation:pzPwaUp .35s ease;}",
      "@keyframes pzPwaUp{from{opacity:0;transform:translate(-50%,16px);}to{opacity:1;transform:translate(-50%,0);}}",
      "#pz-pwa-banner img{width:44px;height:44px;border-radius:12px;flex:0 0 auto;}",
      "#pz-pwa-banner .pz-pwa-txt{flex:1 1 auto;min-width:0;}",
      "#pz-pwa-banner .pz-pwa-txt b{display:block;font-size:0.86rem;font-weight:800;line-height:1.25;}",
      "#pz-pwa-banner .pz-pwa-txt span{display:block;font-size:0.72rem;opacity:.75;line-height:1.3;}",
      "#pz-pwa-banner .pz-pwa-cta{flex:0 0 auto;appearance:none;border:none;cursor:pointer;border-radius:999px;",
      "padding:0.6rem 1rem;font-family:inherit;font-size:0.8rem;font-weight:800;color:#fff;",
      "background:linear-gradient(135deg,#004FC8,#0B7CFF);box-shadow:0 8px 22px rgba(0,79,200,.45);}",
      "#pz-pwa-banner .pz-pwa-x{flex:0 0 auto;appearance:none;border:none;background:transparent;cursor:pointer;",
      "color:#eaf2ff;opacity:.55;font-size:1rem;line-height:1;padding:0.35rem;}",
      "#pz-pwa-overlay{position:fixed;inset:0;z-index:1400;background:rgba(2,5,12,.72);backdrop-filter:blur(6px);",
      "-webkit-backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;}",
      "#pz-pwa-overlay .pz-pwa-card{width:min(460px,100vw);max-height:80vh;overflow:auto;",
      "background:rgba(8,14,28,.98);border:1px solid rgba(255,255,255,.12);border-radius:22px 22px 0 0;",
      "padding:1.3rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom,0px));",
      "font-family:'Montserrat',system-ui,sans-serif;color:#eaf2ff;animation:pzPwaUp2 .3s ease;}",
      "@keyframes pzPwaUp2{from{opacity:0;transform:translateY(40px);}to{opacity:1;transform:translateY(0);}}",
      "#pz-pwa-overlay h3{margin:0 0 0.9rem;font-size:1.02rem;font-weight:900;display:flex;align-items:center;gap:0.6rem;}",
      "#pz-pwa-overlay h3 img{width:34px;height:34px;border-radius:9px;}",
      "#pz-pwa-overlay ol{margin:0 0 1.1rem;padding:0;list-style:none;display:flex;flex-direction:column;gap:0.75rem;}",
      "#pz-pwa-overlay li{display:flex;align-items:center;gap:0.7rem;font-size:0.84rem;line-height:1.4;}",
      "#pz-pwa-overlay li .pz-n{flex:0 0 26px;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;",
      "justify-content:center;font-size:0.75rem;font-weight:800;background:rgba(11,124,255,.18);color:#7db6ff;",
      "border:1px solid rgba(11,124,255,.35);}",
      "#pz-pwa-overlay li svg{flex:0 0 auto;vertical-align:-3px;}",
      "#pz-pwa-overlay .pz-pwa-ok{width:100%;appearance:none;border:none;cursor:pointer;border-radius:999px;",
      "padding:0.85rem 1rem;font-family:inherit;font-size:0.9rem;font-weight:800;color:#fff;",
      "background:linear-gradient(135deg,#004FC8,#0B7CFF);box-shadow:0 8px 22px rgba(0,79,200,.45);}"
    ].join("");
    document.head.appendChild(st);
  }

  function mostrarBanner(modo) {
    if (banner || document.getElementById("pz-pwa-banner")) return;
    injectStyles();
    banner = document.createElement("div");
    banner.id = "pz-pwa-banner";
    banner.innerHTML =
      '<img src="/assets/icons/icon-192.png" alt="" />' +
      '<div class="pz-pwa-txt"><b>Instala Puntazo en tu teléfono</b>' +
      "<span>Tus clips a un toque, en pantalla completa.</span></div>" +
      '<button type="button" class="pz-pwa-cta">' + (modo === "android" ? "Instalar" : "Ver cómo") + "</button>" +
      '<button type="button" class="pz-pwa-x" aria-label="Cerrar">✕</button>';
    document.body.appendChild(banner);
    track("pwa_banner_shown", { platform: modo });

    banner.querySelector(".pz-pwa-x").addEventListener("click", function () {
      track("pwa_banner_dismiss", { platform: modo });
      snooze();
      ocultarBanner();
    });

    banner.querySelector(".pz-pwa-cta").addEventListener("click", function () {
      if (modo === "android" && deferredPrompt) {
        var p = deferredPrompt;
        deferredPrompt = null;
        p.prompt();
        p.userChoice.then(function (ch) {
          track("pwa_prompt_result", { outcome: ch && ch.outcome });
          if (!ch || ch.outcome !== "accepted") snooze();
          ocultarBanner();
        }).catch(function () { ocultarBanner(); });
      } else {
        abrirInstructivoIOS();
      }
    });
  }

  function ocultarBanner() {
    if (banner) { try { banner.remove(); } catch (e) {} }
    banner = null;
  }

  var SVG_SHARE =
    '<svg width="20" height="24" viewBox="0 0 20 24" fill="none" stroke="#7db6ff" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M10 14V2.5"/><path d="M6 6l4-4 4 4"/>' +
    '<path d="M4 10H3v11h14V10h-1"/></svg>';
  var SVG_PLUS =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#7db6ff" stroke-width="1.6">' +
    '<rect x="1.5" y="1.5" width="17" height="17" rx="4"/><path d="M10 6v8M6 10h8" stroke-linecap="round"/></svg>';

  function abrirInstructivoIOS() {
    if (overlay) return;
    injectStyles();
    track("pwa_ios_howto_open");
    overlay = document.createElement("div");
    overlay.id = "pz-pwa-overlay";
    overlay.innerHTML =
      '<div class="pz-pwa-card">' +
      '<h3><img src="/assets/icons/icon-192.png" alt="" /> Agrega Puntazo a tu inicio</h3>' +
      "<ol>" +
      '<li><span class="pz-n">1</span>Toca el botón <b>&nbsp;Compartir&nbsp;</b>' + SVG_SHARE + " en la barra del navegador.</li>" +
      '<li><span class="pz-n">2</span>Baja en el menú y elige ' + SVG_PLUS + '<b>&nbsp;Agregar a pantalla de inicio</b>.</li>' +
      '<li><span class="pz-n">3</span>Toca <b>Agregar</b> — listo, Puntazo queda como app.</li>' +
      "</ol>" +
      '<button type="button" class="pz-pwa-ok">Entendido</button>' +
      "</div>";
    document.body.appendChild(overlay);

    function cerrar() {
      try { overlay.remove(); } catch (e) {}
      overlay = null;
      snooze();
      ocultarBanner();
    }
    overlay.querySelector(".pz-pwa-ok").addEventListener("click", cerrar);
    overlay.addEventListener("click", function (ev) { if (ev.target === overlay) cerrar(); });
  }
})();
