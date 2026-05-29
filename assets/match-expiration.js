/*
 * F115 — match-expiration.js
 *
 * Recordatorio + auto-cierre de partidos activos que ya pasaron su
 * duración esperada (1h partido_3, 2h partido_5).
 *
 * Comportamiento:
 * - En CUALQUIER página (excepto mi-partido.html donde ya estás en el
 *   partido): chequea si el user logueado tiene partidos activos
 *   expirados. Si sí, muestra un banner flotante abajo con "Terminar
 *   ahora" / "Ver partido".
 * - En mi-partido.html ya hay UI propia inline (banner + modal de
 *   auto-cierre); este módulo se auto-desactiva ahí.
 *
 * Requiere: PuntazoAuth + PuntazoMatches (Firebase) cargados antes.
 * Self-installs on DOMContentLoaded.
 */
(function () {
  "use strict";

  if (window.__PZ_MATCH_EXPIRATION_LOADED__) return;
  window.__PZ_MATCH_EXPIRATION_LOADED__ = true;

  // No correr en mi-partido — esa página tiene su propio flujo.
  const path = (window.location.pathname || "").toLowerCase();
  if (/\/mi-partido\.html$/.test(path)) return;

  // Estado del módulo
  let dismissed = {}; // matchId → ts dismiss (no recordar hoy)
  const DISMISS_TTL_MS = 4 * 60 * 60 * 1000; // 4h
  const LS_KEY = "pz.match.exp.dismiss.v1";
  const CHECK_INTERVAL_MS = 60 * 1000; // re-check cada 60s
  let timer = null;

  function loadDismiss() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      const o = JSON.parse(raw);
      const cutoff = Date.now() - DISMISS_TTL_MS;
      const cleaned = {};
      Object.keys(o || {}).forEach(k => { if (o[k] >= cutoff) cleaned[k] = o[k]; });
      return cleaned;
    } catch (_) { return {}; }
  }
  function saveDismiss() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(dismissed)); } catch (_) {}
  }

  function fmtHM(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 60) return m + "min";
    const h = Math.floor(m / 60);
    const r = m - h * 60;
    return h + "h" + (r ? " " + r + "min" : "");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])
    );
  }

  function ensureStyles() {
    if (document.getElementById("pz-mexp-styles")) return;
    const s = document.createElement("style");
    s.id = "pz-mexp-styles";
    s.textContent = `
      .pz-mexp-bar{
        position:fixed; left:50%; bottom:18px; transform:translateX(-50%);
        z-index:9000; max-width:560px; width:calc(100% - 24px);
        background:linear-gradient(180deg, rgba(240,104,69,.20), rgba(2,6,16,.92));
        border:1px solid rgba(240,104,69,.55);
        border-radius:14px; padding:12px 14px;
        box-shadow:0 18px 50px rgba(0,0,0,.45), 0 0 24px rgba(240,104,69,.22);
        backdrop-filter:blur(14px);
        color:#fff; font-family:inherit;
        display:flex; flex-direction:column; gap:10px;
        animation:pzMexpIn .35s cubic-bezier(.2,.8,.2,1);
      }
      @keyframes pzMexpIn{from{opacity:0;transform:translate(-50%,16px);}to{opacity:1;transform:translate(-50%,0);}}
      .pz-mexp-bar.is-warning{
        background:linear-gradient(180deg, rgba(255,200,90,.18), rgba(2,6,16,.92));
        border-color:rgba(255,200,90,.50);
        box-shadow:0 18px 50px rgba(0,0,0,.45), 0 0 24px rgba(255,200,90,.20);
      }
      .pz-mexp-head{display:flex; align-items:flex-start; gap:10px;}
      .pz-mexp-ico{font-size:1.3rem; line-height:1;}
      .pz-mexp-text{flex:1; min-width:0;}
      .pz-mexp-text strong{display:block; font-size:.94rem; font-weight:900; color:#fff; line-height:1.25;}
      .pz-mexp-text .meta{display:block; font-size:.78rem; color:rgba(234,242,255,.72); margin-top:3px; line-height:1.35;}
      .pz-mexp-close{
        background:transparent; border:none; color:rgba(234,242,255,.55);
        font-size:1.1rem; cursor:pointer; padding:0 4px; line-height:1;
        font-family:inherit; font-weight:900;
      }
      .pz-mexp-close:hover{color:#fff;}
      .pz-mexp-actions{display:flex; gap:8px; flex-wrap:wrap;}
      .pz-mexp-btn{
        flex:1; min-width:120px; padding:9px 12px; border-radius:10px;
        border:1px solid rgba(255,255,255,.16);
        background:rgba(255,255,255,.06); color:#fff;
        font-family:inherit; font-weight:800; font-size:.84rem;
        cursor:pointer; text-decoration:none; text-align:center;
        transition:background .15s, border-color .15s;
      }
      .pz-mexp-btn:hover{background:rgba(255,255,255,.12);}
      .pz-mexp-btn.is-primary{
        background:linear-gradient(180deg, rgba(240,104,69,.35), rgba(240,104,69,.18));
        border-color:rgba(240,104,69,.65);
      }
      .pz-mexp-btn.is-primary:hover{
        background:linear-gradient(180deg, rgba(240,104,69,.45), rgba(240,104,69,.25));
      }
      .pz-mexp-btn:disabled{opacity:.55; cursor:wait;}
    `;
    document.head.appendChild(s);
  }

  function renderBar(match, expired, msRemaining) {
    ensureStyles();
    // Solo una barra a la vez — borra existente.
    const old = document.getElementById("pz-mexp-bar");
    if (old) old.remove();

    const bar = document.createElement("div");
    bar.id = "pz-mexp-bar";
    bar.className = "pz-mexp-bar" + (expired ? "" : " is-warning");
    const club = match.loc || "Tu partido";
    const can = match.can || "";
    const title = expired
      ? "Tu partido lleva más tiempo del esperado"
      : "Tu partido está por terminar";
    const meta = expired
      ? `${esc(club)}${can ? " · " + esc(can) : ""} — Lleva ${fmtHM(window.PuntazoMatches.getMatchAgeMs(match) || 0)} activo. ¿Lo cerramos?`
      : `${esc(club)}${can ? " · " + esc(can) : ""} — Te quedan ${fmtHM(msRemaining)} antes del cierre sugerido.`;

    bar.innerHTML =
      '<div class="pz-mexp-head">' +
        '<span class="pz-mexp-ico">' + (expired ? "⏰" : "⏳") + '</span>' +
        '<div class="pz-mexp-text">' +
          '<strong>' + esc(title) + '</strong>' +
          '<span class="meta">' + meta + '</span>' +
        '</div>' +
        '<button class="pz-mexp-close" type="button" aria-label="Cerrar">×</button>' +
      '</div>' +
      '<div class="pz-mexp-actions">' +
        '<a class="pz-mexp-btn" href="/mi-partido.html?matchId=' + encodeURIComponent(match.id) + '">Ver partido</a>' +
        (expired ? '<button class="pz-mexp-btn is-primary" type="button" data-act="end">Terminar ahora</button>' : '') +
      '</div>';

    document.body.appendChild(bar);

    bar.querySelector(".pz-mexp-close").addEventListener("click", () => {
      dismissed[match.id] = Date.now();
      saveDismiss();
      bar.remove();
    });
    const endBtn = bar.querySelector('[data-act="end"]');
    if (endBtn) {
      endBtn.addEventListener("click", async () => {
        endBtn.disabled = true;
        endBtn.textContent = "Cerrando…";
        try {
          await window.PuntazoMatches.end(match.id);
          endBtn.textContent = "✓ Terminado";
          setTimeout(() => bar.remove(), 1200);
          dismissed[match.id] = Date.now();
          saveDismiss();
        } catch (e) {
          console.error("[match-expiration] end falló", e);
          endBtn.disabled = false;
          endBtn.textContent = "Reintentar";
        }
      });
    }
  }

  async function check() {
    try {
      const user = window.PuntazoAuth && window.PuntazoAuth.currentUser;
      if (!user) return;
      if (!window.PuntazoMatches || !window.PuntazoMatches.listByUser) return;

      const items = await window.PuntazoMatches.listByUser(user.uid, {
        status: "active",
        limit: 50,
      });
      if (!items || !items.length) return;

      // Prioridad: el más expirado primero. Si no hay expirados, el más cercano
      // a expirar (siempre que falten menos de 15 min).
      const WARNING_MS = 15 * 60 * 1000;
      let best = null;
      for (const m of items) {
        if (dismissed[m.id]) continue;
        const remaining = window.PuntazoMatches.getMatchTimeRemainingMs(m);
        if (remaining == null) continue;
        if (remaining <= 0) {
          if (!best || (best.remaining > remaining)) best = { match: m, remaining: remaining, expired: true };
        } else if (remaining <= WARNING_MS) {
          if (!best || (!best.expired && best.remaining > remaining)) best = { match: m, remaining: remaining, expired: false };
        }
      }
      if (best) renderBar(best.match, best.expired, best.remaining);
    } catch (e) {
      console.warn("[match-expiration] check error", e);
    }
  }

  function start() {
    dismissed = loadDismiss();
    check();
    if (timer) clearInterval(timer);
    timer = setInterval(check, CHECK_INTERVAL_MS);
  }

  // Bootstrap: esperar auth-ready, luego correr.
  function boot() {
    if (window.PuntazoAuth && window.PuntazoAuth.currentUser) {
      start();
    }
    window.addEventListener("puntazo:auth-ready", start);
    window.addEventListener("puntazo:auth-changed", start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
