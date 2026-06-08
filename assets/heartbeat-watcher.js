/*
 * F129 — heartbeat-watcher.js
 *
 * Banner pasivo que avisa al user "el sistema del club está temporalmente
 * fuera de línea — tu pulso/clip se procesará cuando vuelva" cuando el
 * doc nuc_heartbeat/{clubId} no se ha actualizado en los últimos 5 min.
 *
 * También expone un helper para mapear error_reason de pending_pulses a
 * mensajes amigables para el usuario.
 *
 * IMPORTANTE PARA EL USUARIO: nunca decimos "NUC" en la UI. El user no
 * sabe ni le importa qué es eso. Decimos "el sistema del club" o "las
 * cámaras". Si la NUC está caída, decimos "las cámaras están temporalmente
 * fuera de línea" — más cercano a su mental model.
 *
 * API:
 *   PuntazoHeartbeatWatcher.watch(clubId, containerEl, opts?)
 *     opts.onStateChange — callback(state) cuando offline/online cambia
 *
 *   PuntazoHeartbeatWatcher.errorReasonText(reason) → string user-friendly
 *
 * Self-installs el banner DOM dentro del containerEl. Si el sistema vuelve
 * a estar online, el banner se oculta.
 */
(function () {
  "use strict";

  if (window.PuntazoHeartbeatWatcher) return;

  const STALE_THRESHOLD_MS = 5 * 60 * 1000;
  const POLL_INTERVAL_MS = 60 * 1000;

  function ensureStyles() {
    if (document.getElementById("pz-hb-styles")) return;
    const s = document.createElement("style");
    s.id = "pz-hb-styles";
    s.textContent = `
      .pz-hb-banner {
        display: none;
        margin: 8px 0;
        padding: 11px 14px;
        border-radius: 12px;
        background: linear-gradient(180deg, rgba(255, 170, 60, 0.14), rgba(255, 170, 60, 0.04));
        border: 1px solid rgba(255, 170, 60, 0.42);
        color: #ffe3b8;
        font-family: inherit; font-size: 0.84rem; line-height: 1.35;
        animation: pzHbIn .3s ease;
      }
      .pz-hb-banner.is-active { display: flex; align-items: flex-start; gap: 10px; }
      @keyframes pzHbIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      .pz-hb-banner .ico { font-size: 1.15rem; line-height: 1; flex-shrink: 0; padding-top: 1px; }
      .pz-hb-banner .body { flex: 1; min-width: 0; }
      .pz-hb-banner strong { display: block; color: #fff; font-weight: 900; font-size: 0.88rem; margin-bottom: 2px; }
      .pz-hb-banner .since { font-size: 0.72rem; opacity: 0.75; margin-top: 3px; display: block; }

      /* F145: pill de estado positivo (siempre visible cuando hay señal). */
      .pz-hb-pill {
        display: none;
        align-items: center;
        gap: 7px;
        padding: 5px 11px;
        border-radius: 999px;
        font-family: inherit;
        font-size: 0.74rem;
        font-weight: 700;
        line-height: 1;
        border: 1px solid transparent;
        width: fit-content;
      }
      .pz-hb-pill .dot {
        width: 8px; height: 8px; border-radius: 50%;
        flex-shrink: 0;
      }
      .pz-hb-pill.is-online {
        display: inline-flex;
        background: rgba(34, 197, 94, 0.12);
        border-color: rgba(34, 197, 94, 0.40);
        color: #9af2c0;
      }
      .pz-hb-pill.is-online .dot {
        background: #22c55e;
        box-shadow: 0 0 8px rgba(34, 197, 94, 0.85);
        animation: pzHbPulse 1.8s infinite;
      }
      .pz-hb-pill.is-offline {
        display: inline-flex;
        background: rgba(255, 170, 60, 0.12);
        border-color: rgba(255, 170, 60, 0.42);
        color: #ffe3b8;
      }
      .pz-hb-pill.is-offline .dot { background: #ffaa3c; }
      @keyframes pzHbPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
    `;
    document.head.appendChild(s);
  }

  function tsToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts === "number") return ts;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
    return 0;
  }

  function relSince(ms) {
    if (!ms) return "";
    const diff = Math.max(0, Date.now() - ms);
    if (diff < 60000) return "hace menos de 1 min";
    if (diff < 3600000) return "hace " + Math.floor(diff / 60000) + " min";
    if (diff < 86400000) return "hace " + Math.floor(diff / 3600000) + " h";
    return "hace " + Math.floor(diff / 86400000) + " días";
  }

  // ── Error reason mapping ─────────────────────────────────────────
  // Mapea error_reason del NUC (campo en pending_pulses) a copy
  // amigable. El user nunca ve la jerga interna ("nvr_window_exceeded",
  // "rtsp_404"); ve el motivo en palabras humanas.
  function errorReasonText(reason) {
    if (!reason) return "";
    const r = String(reason).toLowerCase();
    if (r === "nvr_window_exceeded" || r === "nvr_window_exceeded_late") {
      return "Ese video ya no está disponible — pasó más tiempo del que el sistema guarda.";
    }
    if (r === "already_processed") {
      return "Este puntazo ya se procesó antes.";
    }
    if (r === "match_not_found") {
      return "No encontramos el partido asociado a este puntazo.";
    }
    if (r === "base64_decode_failed" || r === "dropbox_upload_failed" || r === "match_update_failed") {
      return "Hubo un problema técnico al guardar. Intenta de nuevo en un rato.";
    }
    if (r === "payload_too_large") {
      return "La foto era demasiado pesada. Prueba con una más chica.";
    }
    // Default: mensaje genérico — nunca exponer el reason crudo.
    return "Hubo un problema al procesar este puntazo.";
  }

  // ── Heartbeat watcher ────────────────────────────────────────────
  function watch(clubId, container, opts) {
    if (!clubId || !container) return null;
    opts = opts || {};
    ensureStyles();

    const banner = document.createElement("div");
    banner.className = "pz-hb-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML =
      '<span class="ico">⚡</span>' +
      '<div class="body">' +
        '<strong>Las cámaras del club están temporalmente fuera de línea.</strong>' +
        'Tu puntazo se va a procesar en cuanto vuelvan. No tienes que hacer nada.' +
        '<span class="since" data-since></span>' +
      '</div>';
    container.appendChild(banner);

    const $since = banner.querySelector("[data-since]");
    let currentState = "unknown"; // "online" | "offline" | "unknown"
    let unsub = null;
    let timer = null;
    let lastSeenAtMs = 0;

    function evaluate() {
      const stale = lastSeenAtMs && (Date.now() - lastSeenAtMs > STALE_THRESHOLD_MS);
      const newState = lastSeenAtMs ? (stale ? "offline" : "online") : "unknown";
      if (newState !== currentState) {
        currentState = newState;
        if (typeof opts.onStateChange === "function") {
          try { opts.onStateChange(newState); } catch (_) {}
        }
      }
      if (currentState === "offline" && $since) {
        $since.textContent = "Última señal: " + relSince(lastSeenAtMs) + ".";
      }
      banner.classList.toggle("is-active", currentState === "offline");
    }

    function subscribe() {
      const fb = window.PuntazoFirebase;
      if (!fb || typeof fb.db !== "function") return;
      const db = fb.db();
      if (!db) return;
      try {
        unsub = db.collection("nuc_heartbeat").doc(clubId).onSnapshot(function (snap) {
          if (!snap.exists) {
            lastSeenAtMs = 0;
          } else {
            const d = snap.data() || {};
            lastSeenAtMs = tsToMillis(d.lastSeenAt) || tsToMillis(d.updatedAt) || 0;
          }
          evaluate();
        }, function (err) {
          // Si la rule no está deployada, el read falla. Falla graceful:
          // simplemente no mostramos banner (mejor no decir nada que
          // mentir).
          console.warn("[heartbeat-watcher] read denied o falló:", err && err.code);
        });
      } catch (e) {
        console.warn("[heartbeat-watcher] subscribe falló:", e && e.message);
      }
    }

    function destroy() {
      if (timer) { clearInterval(timer); timer = null; }
      if (typeof unsub === "function") { try { unsub(); } catch (_) {} unsub = null; }
      try { banner.remove(); } catch (_) {}
    }

    subscribe();
    // Re-evaluar cada minuto para que el "Última señal: hace X" se actualice
    // y el state online → offline se detecte aunque Firestore no haya emitido
    // un snapshot nuevo (caso típico: el watcher recibió 1 snapshot y luego
    // la NUC dejó de escribir).
    timer = setInterval(evaluate, POLL_INTERVAL_MS);

    return { destroy: destroy, evaluate: evaluate };
  }

  // ── Status pill (positivo) ───────────────────────────────────────
  // A diferencia de watch() (que solo avisa cuando hay avería), esta pill
  // es SIEMPRE visible cuando hay señal: verde "en línea" si el heartbeat
  // es fresco, ámbar "fuera de línea" si está stale. Si nunca hubo señal
  // (doc inexistente o read denegado), no se muestra — no inventamos estado.
  function statusPill(clubId, container, opts) {
    if (!clubId || !container) return null;
    opts = opts || {};
    ensureStyles();

    const pill = document.createElement("div");
    pill.className = "pz-hb-pill";
    pill.setAttribute("role", "status");
    pill.innerHTML = '<span class="dot"></span><span class="txt"></span>';
    container.appendChild(pill);
    const $txt = pill.querySelector(".txt");

    let lastSeenAtMs = 0;
    let unsub = null;
    let timer = null;

    function render() {
      if (!lastSeenAtMs) { pill.className = "pz-hb-pill"; return; } // unknown
      const fresh = (Date.now() - lastSeenAtMs) <= STALE_THRESHOLD_MS;
      pill.classList.toggle("is-online", fresh);
      pill.classList.toggle("is-offline", !fresh);
      $txt.textContent = fresh
        ? (opts.onlineText || "Cámaras del club en línea")
        : (opts.offlineText || "Cámaras del club fuera de línea");
    }

    function subscribe() {
      const fb = window.PuntazoFirebase;
      if (!fb || typeof fb.db !== "function") return;
      const db = fb.db();
      if (!db) return;
      try {
        unsub = db.collection("nuc_heartbeat").doc(clubId).onSnapshot(function (snap) {
          if (!snap.exists) { lastSeenAtMs = 0; }
          else {
            const d = snap.data() || {};
            lastSeenAtMs = tsToMillis(d.lastSeenAt) || tsToMillis(d.updatedAt) || 0;
          }
          render();
        }, function (err) {
          console.warn("[heartbeat-pill] read denied o falló:", err && err.code);
        });
      } catch (e) {
        console.warn("[heartbeat-pill] subscribe falló:", e && e.message);
      }
    }

    subscribe();
    timer = setInterval(render, POLL_INTERVAL_MS); // refresca online→offline aunque no llegue snapshot

    return {
      destroy: function () {
        if (timer) { clearInterval(timer); timer = null; }
        if (typeof unsub === "function") { try { unsub(); } catch (_) {} unsub = null; }
        try { pill.remove(); } catch (_) {}
      },
    };
  }

  window.PuntazoHeartbeatWatcher = {
    watch: watch,
    statusPill: statusPill,
    errorReasonText: errorReasonText,
    STALE_THRESHOLD_MS: STALE_THRESHOLD_MS,
  };
})();
