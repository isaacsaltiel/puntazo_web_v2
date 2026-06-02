/*
 * F125-H1 — resumen-overlay.js
 *
 * Componente reusable que abre la foto del resumen del partido en un
 * overlay full-screen, cargando resumen.html?matchId=X&embed=1 dentro
 * de un iframe.
 *
 * El embed mode de resumen.html (línea de body) oculta su header global
 * y el page-bg, así el overlay sale limpio: solo el card del resumen
 * + los botones (descargar / compartir / subir foto).
 *
 * API:
 *   PuntazoResumenOverlay.open(matchId, opts?)
 *     opts.title  — opcional, default "Foto del resumen"
 *     opts.onClose — opcional, callback al cerrar
 *
 * UX:
 *   - Backdrop oscuro con blur. Click fuera del frame → cerrar.
 *   - X arriba derecha del frame.
 *   - Tecla Escape también cierra.
 *   - Animación fade-in 250ms.
 *   - Body queda con overflow:hidden mientras está abierto.
 *
 * Botón estándar para inyectar en match-cards:
 *   PuntazoResumenOverlay.buildButton(matchId, opts?)  → <button> listo
 *     opts.label  — default "📸 Ver foto del resumen"
 *     opts.className — default "pz-res-btn"
 */
(function () {
  "use strict";

  if (window.PuntazoResumenOverlay) return;

  let _activeEl = null;
  let _scrollLock = null;
  let _escHandler = null;

  function ensureStyles() {
    if (document.getElementById("pz-res-overlay-styles")) return;
    const s = document.createElement("style");
    s.id = "pz-res-overlay-styles";
    s.textContent = `
      .pz-res-overlay-backdrop {
        position: fixed; inset: 0; z-index: 9500;
        background: rgba(2, 6, 16, 0.78);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex; align-items: center; justify-content: center;
        padding: 12px;
        opacity: 0;
        animation: pzResFadeIn .25s ease forwards;
      }
      @keyframes pzResFadeIn { to { opacity: 1; } }
      .pz-res-overlay-frame-wrap {
        position: relative;
        width: 100%;
        max-width: 600px;
        height: 100%;
        max-height: 96vh;
        border-radius: 22px;
        overflow: hidden;
        box-shadow: 0 26px 70px rgba(0, 0, 0, 0.55);
        background: rgba(8, 14, 28, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.08);
        animation: pzResScaleIn .28s cubic-bezier(.22,.9,.27,1) forwards;
        transform: scale(0.96);
        opacity: 0;
      }
      @keyframes pzResScaleIn { to { transform: scale(1); opacity: 1; } }
      .pz-res-overlay-frame-wrap iframe {
        width: 100%; height: 100%;
        border: 0;
        display: block;
        background: transparent;
      }
      .pz-res-overlay-close {
        position: absolute; top: 10px; right: 10px; z-index: 2;
        appearance: none;
        width: 38px; height: 38px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(8, 14, 28, 0.78);
        color: #fff;
        font-family: inherit; font-size: 1.2rem; font-weight: 900;
        cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        backdrop-filter: blur(8px);
        transition: background .14s, border-color .14s, transform .12s;
      }
      .pz-res-overlay-close:hover {
        background: rgba(11, 124, 255, 0.20);
        border-color: rgba(11, 124, 255, 0.50);
      }
      .pz-res-overlay-close:active { transform: scale(0.92); }
      .pz-res-overlay-loading {
        position: absolute; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 14px;
        color: rgba(234, 242, 255, 0.75);
        font-family: inherit; font-size: .92rem;
        pointer-events: none;
      }
      .pz-res-overlay-loading .spin {
        width: 32px; height: 32px;
        border: 3px solid rgba(11, 124, 255, 0.18);
        border-top-color: rgba(11, 124, 255, 0.85);
        border-radius: 50%;
        animation: pzResSpin .85s linear infinite;
      }
      @keyframes pzResSpin { to { transform: rotate(360deg); } }

      /* Botón estándar para inyectar en match-cards */
      .pz-res-btn {
        appearance: none;
        display: inline-flex; align-items: center; justify-content: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 999px;
        border: 1px solid rgba(11, 124, 255, 0.32);
        background: rgba(11, 124, 255, 0.10);
        color: #cfe2ff;
        font-family: inherit; font-size: .82rem; font-weight: 800;
        cursor: pointer; text-decoration: none;
        transition: background .14s, border-color .14s, transform .12s;
        white-space: nowrap;
      }
      .pz-res-btn:hover {
        background: rgba(11, 124, 255, 0.22);
        border-color: rgba(11, 124, 255, 0.55);
        transform: translateY(-1px);
      }
      .pz-res-btn:active { transform: translateY(0) scale(0.97); }

      @media (max-width: 480px) {
        .pz-res-overlay-backdrop { padding: 0; }
        .pz-res-overlay-frame-wrap {
          max-width: 100%;
          max-height: 100vh;
          border-radius: 0;
          height: 100vh;
        }
        .pz-res-overlay-close { top: 14px; right: 14px; width: 40px; height: 40px; }
      }
    `;
    document.head.appendChild(s);
  }

  function lockScroll() {
    _scrollLock = {
      bodyOverflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
    };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }
  function unlockScroll() {
    if (!_scrollLock) return;
    document.body.style.overflow = _scrollLock.bodyOverflow;
    document.documentElement.style.overflow = _scrollLock.htmlOverflow;
    _scrollLock = null;
  }

  function close(opts) {
    if (!_activeEl) return;
    try { _activeEl.remove(); } catch (_) {}
    _activeEl = null;
    unlockScroll();
    if (_escHandler) {
      document.removeEventListener("keydown", _escHandler);
      _escHandler = null;
    }
    if (opts && typeof opts.onClose === "function") {
      try { opts.onClose(); } catch (_) {}
    }
  }

  function open(matchId, opts) {
    opts = opts || {};
    if (!matchId) {
      console.warn("[resumen-overlay] open() requires matchId");
      return;
    }
    ensureStyles();
    close({}); // por si quedó uno abierto

    const backdrop = document.createElement("div");
    backdrop.className = "pz-res-overlay-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", opts.title || "Foto del resumen del partido");

    const wrap = document.createElement("div");
    wrap.className = "pz-res-overlay-frame-wrap";

    // Loading state que vive DETRÁS del iframe — cuando el iframe pinte
    // (background:transparent en embed mode), el spinner queda oculto
    // por encima del contenido. Cubre el caso de redes lentas.
    const loading = document.createElement("div");
    loading.className = "pz-res-overlay-loading";
    loading.innerHTML = '<div class="spin"></div><div>Generando foto…</div>';
    wrap.appendChild(loading);

    const iframe = document.createElement("iframe");
    iframe.src = "/resumen.html?matchId=" + encodeURIComponent(matchId) + "&embed=1";
    iframe.setAttribute("loading", "eager");
    iframe.setAttribute("title", opts.title || "Foto del resumen del partido");
    iframe.addEventListener("load", function () {
      // pequeño delay para que la primera pintada del card esté lista
      setTimeout(function () {
        if (loading && loading.parentNode) loading.style.opacity = "0";
        setTimeout(function () { if (loading && loading.parentNode) loading.remove(); }, 200);
      }, 150);
    });
    wrap.appendChild(iframe);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pz-res-overlay-close";
    closeBtn.setAttribute("aria-label", "Cerrar");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", function () { close(opts); });
    wrap.appendChild(closeBtn);

    backdrop.appendChild(wrap);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close(opts);
    });

    document.body.appendChild(backdrop);
    _activeEl = backdrop;
    lockScroll();

    _escHandler = function (e) {
      if (e.key === "Escape" || e.key === "Esc") close(opts);
    };
    document.addEventListener("keydown", _escHandler);

    try {
      if (window.gtag) gtag("event", "resumen_overlay_open", {
        event_category: "resumen",
        event_label: matchId,
      });
    } catch (_) {}
  }

  function buildButton(matchId, opts) {
    opts = opts || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = opts.className || "pz-res-btn";
    btn.textContent = opts.label || "📸 Ver foto del resumen";
    if (matchId) btn.setAttribute("data-match-id", matchId);
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      open(matchId, opts);
    });
    return btn;
  }

  window.PuntazoResumenOverlay = {
    open: open,
    close: close,
    buildButton: buildButton,
  };
})();
