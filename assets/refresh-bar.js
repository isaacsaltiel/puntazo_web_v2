/*
 * F126 — refresh-bar.js
 *
 * Píldora chica con "Actualizado hace X" + botón "Actualizar" que la
 * página huésped puede insertar arriba de cualquier sección que liste
 * cosas que llegan async (clips, pulsos, matches, etc.).
 *
 * Por qué existe:
 * - En lado.html, perfil.html, mi-partido.html, detalle.html y resumen.html
 *   el user espera que aparezcan clips/pulsos nuevos. El pull-to-refresh
 *   nativo del browser está bloqueado por los handlers de touch del sitio
 *   y no hay polling agresivo (sería caro). Resultado: el user tiene que
 *   recargar la página completa y pierde estado.
 *
 * - Esta barra centraliza el patrón: "refresca SOLO el estado real
 *   (re-fetch lo necesario) sin recargar la página, y dime cuándo lo
 *   hicimos por última vez".
 *
 * - Opcionalmente expone un panel desplegable con los pulsos pendientes
 *   del user en ese contexto (loc+can+lado o matchId) para que mientras
 *   "actualiza" vea cómo va cambiando el estado de SU clip.
 *
 * API:
 *   const bar = PuntazoRefreshBar.attach(containerEl, {
 *     onRefresh: async () => { ... refresca lo que sea ... },
 *     label: "Actualizado",                 // default
 *     auto: 60_000,                          // ms entre auto-refresh, 0/null = solo manual
 *     showPending: true,                     // mostrar panel pulsos pendientes (default false)
 *     context: { loc, can, lado, matchId },  // para filtrar pending_pulses del user
 *   });
 *
 *   bar.markRefreshed();   // marca lastRefresh = ahora (lo hace solo al volver de onRefresh)
 *   bar.refreshNow();      // dispara onRefresh programáticamente
 *   bar.destroy();
 *
 *   PuntazoRefreshBar.relativeTime(ms) → "justo ahora" / "hace 2 min" / ...
 */
(function () {
  "use strict";

  if (window.PuntazoRefreshBar) return;

  function relativeTime(ms) {
    if (!ms) return "—";
    const diff = Math.max(0, Date.now() - ms);
    if (diff < 10000) return "justo ahora";
    if (diff < 60000) return "hace " + Math.floor(diff / 1000) + " s";
    if (diff < 3600000) {
      const m = Math.floor(diff / 60000);
      return m === 1 ? "hace 1 min" : "hace " + m + " min";
    }
    if (diff < 86400000) {
      const h = Math.floor(diff / 3600000);
      return h === 1 ? "hace 1 h" : "hace " + h + " h";
    }
    const d = Math.floor(diff / 86400000);
    return d === 1 ? "hace 1 día" : "hace " + d + " días";
  }

  function ensureStyles() {
    if (document.getElementById("pz-refresh-bar-styles")) return;
    const s = document.createElement("style");
    s.id = "pz-refresh-bar-styles";
    s.textContent = `
      .pz-rb {
        display: flex; align-items: center; flex-wrap: wrap;
        gap: 8px;
        padding: 8px 12px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 18px;
        font-family: inherit; font-size: 0.78rem;
        color: rgba(234,242,255,0.70);
        margin: 4px 0 12px;
        line-height: 1.2;
        box-sizing: border-box; max-width: 100%;
      }
      .pz-rb-label {
        display: inline-flex; align-items: center; gap: 6px;
        flex: 1 1 auto; min-width: 0;
      }
      .pz-rb-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: rgba(11,124,255,0.55);
        flex-shrink: 0;
      }
      .pz-rb-dot.is-busy {
        background: rgba(255, 200, 90, 0.85);
        animation: pzRbPulse 1.2s ease-in-out infinite;
      }
      @keyframes pzRbPulse {
        0%, 100% { opacity: 0.5; transform: scale(1); }
        50%      { opacity: 1;   transform: scale(1.3); }
      }
      .pz-rb-time { font-variant-numeric: tabular-nums; }
      .pz-rb-btn {
        appearance: none;
        display: inline-flex; align-items: center; gap: 4px;
        padding: 5px 11px;
        border-radius: 999px;
        border: 1px solid rgba(11,124,255,0.32);
        background: rgba(11,124,255,0.10);
        color: #cfe2ff;
        font-family: inherit; font-weight: 800; font-size: 0.74rem;
        cursor: pointer; flex-shrink: 0;
        white-space: nowrap; box-sizing: border-box; max-width: 100%;
        transition: background .12s, border-color .12s, transform .1s;
      }
      .pz-rb-btn:hover {
        background: rgba(11,124,255,0.20);
        border-color: rgba(11,124,255,0.55);
      }
      .pz-rb-btn:active { transform: scale(0.95); }
      .pz-rb-btn[disabled] { opacity: 0.5; cursor: wait; }
      .pz-rb-pending-btn {
        appearance: none;
        display: inline-flex; align-items: center; gap: 5px;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 200, 90, 0.35);
        background: rgba(255, 200, 90, 0.10);
        color: #ffd497;
        font-family: inherit; font-weight: 800; font-size: 0.72rem;
        cursor: pointer; flex-shrink: 0;
        white-space: nowrap; box-sizing: border-box; max-width: 100%;
        transition: background .12s;
      }
      .pz-rb-pending-btn:hover { background: rgba(255, 200, 90, 0.20); }
      .pz-rb-pending-btn .caret {
        font-size: 0.62rem;
        transition: transform .15s;
        display: inline-block;
      }
      .pz-rb-pending-btn.is-open .caret { transform: rotate(180deg); }
      .pz-rb-pending-btn.is-hidden { display: none; }

      .pz-rb-panel {
        width: 100%;
        box-sizing: border-box;
        margin-top: 8px;
        border-radius: 14px;
        border: 1px solid rgba(255, 200, 90, 0.25);
        background: rgba(20, 14, 6, 0.55);
        backdrop-filter: blur(10px);
        padding: 0 12px;
        max-height: 0;
        overflow: hidden;
        opacity: 0;
        transition: max-height .25s ease, opacity .2s ease, padding .2s ease;
      }
      .pz-rb-panel.is-open {
        max-height: 60vh;
        opacity: 1;
        overflow-y: auto;
        padding: 10px 12px;
      }
      .pz-rb-panel-empty {
        font-size: 0.76rem;
        color: rgba(234,242,255,0.55);
        text-align: center;
        padding: 8px 4px;
      }
      .pz-rb-pi {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 6px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        font-size: 0.76rem;
        color: #eaf2ff;
      }
      .pz-rb-pi:last-child { border-bottom: 0; }
      .pz-rb-pi-emoji { font-size: 1rem; flex-shrink: 0; }
      .pz-rb-pi-text { flex: 1; min-width: 0; }
      .pz-rb-pi-text strong {
        display: block; font-weight: 800; font-size: 0.80rem;
        color: #fff;
      }
      .pz-rb-pi-text .meta {
        font-size: 0.70rem;
        color: rgba(234,242,255,0.55);
      }
      .pz-rb-pi-action {
        padding: 4px 9px;
        border-radius: 999px;
        background: rgba(34,197,94,0.20);
        border: 1px solid rgba(34,197,94,0.45);
        color: #9af2c0;
        font-size: 0.68rem; font-weight: 800;
        text-decoration: none;
        flex-shrink: 0;
      }
      .pz-rb-pi-action:hover { background: rgba(34,197,94,0.30); }
    `;
    document.head.appendChild(s);
  }

  // ── Pending pulses helpers ─────────────────────────────────────
  // Cache local de pulsos por uid+contexto. TTL chico para no spammear
  // Firestore mientras el user pulsa "Actualizar" muchas veces.
  const _pendingCache = new Map();
  const PENDING_TTL_MS = 8 * 1000;

  // F126-B: cache de los JSON videos_recientes por loc|can|lado, para que
  // si el panel tiene 3 pulsos de la misma cancha no se haga 3 fetches.
  const _jsonCache = new Map();
  const JSON_TTL_MS = 30 * 1000;

  async function _loadVideosForLado(loc, can, lado) {
    if (!loc || !can || !lado) return null;
    const key = loc + "|" + can + "|" + lado;
    const cached = _jsonCache.get(key);
    if (cached && Date.now() - cached.ts < JSON_TTL_MS) return cached.json;
    let url = null;
    try {
      if (window.PuntazoMatches && window.PuntazoMatches.findJsonUrl) {
        url = await window.PuntazoMatches.findJsonUrl(loc, can, lado);
      }
    } catch (_) {}
    if (!url) return null;
    try {
      // cache-bust para que un Actualizar manual SI traiga el JSON fresco
      // del CDN (GitHub Pages cachea agresivo en edge).
      const resp = await fetch(url + (url.indexOf("?") >= 0 ? "&" : "?") + "_cb=" + Date.now(), { cache: "no-store" });
      if (!resp.ok) return null;
      const json = await resp.json();
      _jsonCache.set(key, { ts: Date.now(), json: json });
      return json;
    } catch (_) {
      return null;
    }
  }

  // F126-B: para cada pulso consumed_at != null, busca su clip
  // correspondiente en videos_recientes.json del lado y, si existe,
  // marca doc._matchedClipUrl. Esto permite que el panel del refresh-bar
  // distinga "ya está listo" vs "todavía procesando", y filtre los
  // ya-listos del listado de pendientes (no son pendientes anymore).
  async function _annotatePulsesWithClips(docs) {
    const groups = new Map();
    docs.forEach(function (d) {
      if (!d.club || !d.cancha) return;
      const lado = d.lado || "LadoA";
      const canStr = /^\d+$/.test(String(d.cancha)) ? "Cancha" + d.cancha : String(d.cancha);
      const key = d.club + "|" + canStr + "|" + lado;
      if (!groups.has(key)) groups.set(key, { loc: d.club, can: canStr, lado: lado, docs: [] });
      groups.get(key).docs.push(d);
    });

    const matchWindowMs = 90 * 1000;
    for (const grp of groups.values()) {
      const json = await _loadVideosForLado(grp.loc, grp.can, grp.lado);
      if (!json || !Array.isArray(json.videos)) continue;
      const parsed = [];
      for (const v of json.videos) {
        let p = null;
        try {
          if (window.PuntazoMatches && window.PuntazoMatches.parseClipName) {
            p = window.PuntazoMatches.parseClipName(v.nombre);
          }
        } catch (_) {}
        if (p && p.date) parsed.push({ url: v.url, nombre: v.nombre, ts: p.date.getTime() });
      }
      for (const doc of grp.docs) {
        let anchorMs = 0;
        if (doc.consumed_at && doc.consumed_at.toMillis) anchorMs = doc.consumed_at.toMillis();
        if (!anchorMs && doc.created_at && doc.created_at.toMillis) anchorMs = doc.created_at.toMillis();
        if (!anchorMs) continue;
        const hit = parsed.find(function (x) { return Math.abs(x.ts - anchorMs) <= matchWindowMs; });
        if (hit) {
          doc._matchedClipUrl = hit.url;
          doc._matchedClipNombre = hit.nombre;
        }
      }
    }
  }

  async function fetchUserPending(uid, ctx) {
    const fb = window.PuntazoFirebase;
    if (!fb || typeof fb.db !== "function") return [];
    const db = fb.db();
    if (!db) return [];

    const key = uid + "|" + (ctx.loc || "") + "|" + (ctx.cancha || ctx.can || "") + "|" + (ctx.lado || "") + "|" + (ctx.matchId || "");
    const cached = _pendingCache.get(key);
    if (cached && Date.now() - cached.ts < PENDING_TTL_MS) return cached.docs;

    try {
      let q = db.collection("pending_pulses").where("uid_creator", "==", uid);
      // Filtros adicionales se aplican client-side (evita índices compuestos).
      const snap = await q.limit(50).get();
      const out = [];
      snap.forEach(function (d) {
        const o = d.data() || {};
        // Filtrado contextual: si vienen loc/can/lado o matchId, filtramos.
        if (ctx.loc && o.club && o.club !== ctx.loc) return;
        if (ctx.cancha && o.cancha) {
          // cancha puede venir como "Cancha1" o "1" según la fuente.
          const cExp = String(ctx.cancha).replace(/^\D+/, "");
          const cAct = String(o.cancha).replace(/^\D+/, "");
          if (cExp && cAct && cExp !== cAct) return;
        }
        if (ctx.lado && o.lado && o.lado !== ctx.lado) return;
        if (ctx.matchId && o.match_id && o.match_id !== ctx.matchId) return;
        // Excluir muy viejos consumidos (>24h) para no saturar el panel.
        if (o.consumed_at) {
          const consumedMs = o.consumed_at.toMillis ? o.consumed_at.toMillis() : (o.consumed_at.seconds ? o.consumed_at.seconds * 1000 : 0);
          if (consumedMs && Date.now() - consumedMs > 24 * 60 * 60 * 1000) return;
        }
        out.push({ id: d.id, ...o });
      });
      out.sort(function (a, b) {
        const aMs = a.created_at && a.created_at.toMillis ? a.created_at.toMillis() : 0;
        const bMs = b.created_at && b.created_at.toMillis ? b.created_at.toMillis() : 0;
        return bMs - aMs;
      });

      // F126-B + F133: anota los pulsos consumed_at con su clip URL si
      // existe en videos_recientes.json. Después filtra del panel:
      //   - Los que tienen _matchedClipUrl (ya están listos con link).
      //   - Los que ya tienen consumed_at > 15 min sin match. Asunción
      //     conservadora: si la NUC consumió hace rato, su video YA
      //     existe en Dropbox aunque el JSON estático del cliente ya
      //     no lo indexe (videos_recientes solo guarda 24h,
      //     videos_vitrina solo top-5). El panel "pendientes" debe
      //     mostrar solo lo que de verdad está en cola o procesándose
      //     ahora — no pulsos viejos huérfanos del índice JSON.
      try { await _annotatePulsesWithClips(out); } catch (_) {}
      const STALE_CONSUMED_MS = 15 * 60 * 1000;
      const trulyPending = out.filter(function (d) {
        if (d._matchedClipUrl) return false;
        if (d.consumed_at) {
          var consumedMs = d.consumed_at.toMillis ? d.consumed_at.toMillis() : 0;
          if (consumedMs && (Date.now() - consumedMs) > STALE_CONSUMED_MS) {
            return false; // procesado hace rato, asumimos OK
          }
        }
        return true;
      });

      _pendingCache.set(key, { ts: Date.now(), docs: trulyPending });
      return trulyPending;
    } catch (e) {
      console.warn("[refresh-bar] fetchUserPending falló:", e && e.message);
      return [];
    }
  }

  function pendingStateInfo(doc) {
    if (doc.error_reason) {
      // F129: mapear reason crudo a texto amigable si el heartbeat-watcher
      // está cargado. Si no, fallback al string crudo (mejor que vacío).
      var human = doc.error_reason;
      try {
        if (window.PuntazoHeartbeatWatcher && window.PuntazoHeartbeatWatcher.errorReasonText) {
          human = window.PuntazoHeartbeatWatcher.errorReasonText(doc.error_reason) || human;
        }
      } catch (_) {}
      return { emoji: "⚠️", label: "Con problema", note: human };
    }
    if (!doc.consumed_at) {
      return { emoji: "🟡", label: "En cola", note: "Esperando ser procesado" };
    }
    if (doc._matchedClipUrl) {
      return { emoji: "✅", label: "Listo", note: "Tu clip está disponible", url: doc._matchedClipUrl };
    }
    // consumed_at != null sin URL — está procesándose.
    const consumedMs = doc.consumed_at.toMillis ? doc.consumed_at.toMillis() : 0;
    const ageMin = consumedMs ? Math.floor((Date.now() - consumedMs) / 60000) : 0;
    if (ageMin > 15) {
      return { emoji: "⚠️", label: "Tardando más de lo normal", note: "Procesado hace " + ageMin + " min" };
    }
    return { emoji: "🟠", label: "Procesando", note: "Tu clip se está procesando" };
  }

  function fmtHM(ts) {
    let ms = 0;
    if (ts && ts.toMillis) ms = ts.toMillis();
    else if (ts && ts.seconds) ms = ts.seconds * 1000;
    else if (typeof ts === "number") ms = ts;
    if (!ms) return "—";
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  // ── attach() ────────────────────────────────────────────────────
  function attach(container, opts) {
    if (!container) return null;
    opts = opts || {};
    ensureStyles();

    const wrap = document.createElement("div");
    wrap.className = "pz-rb";
    wrap.innerHTML =
      '<span class="pz-rb-label">' +
        '<span class="pz-rb-dot" data-dot></span>' +
        '<span data-label>' + (opts.label || "Actualizado") + '</span>' +
        ' <span class="pz-rb-time" data-time>—</span>' +
      '</span>' +
      '<button type="button" class="pz-rb-btn" data-refresh>↻ Actualizar</button>' +
      (opts.showPending
        ? '<button type="button" class="pz-rb-pending-btn is-hidden" data-pending-btn>' +
          '<span data-pending-count>0 pendientes</span>' +
          '<span class="caret">▾</span>' +
          '</button>' +
          '<div class="pz-rb-panel" data-panel></div>'
        : '');

    const panel = document.createElement("div");
    panel.style.display = "contents";
    panel.appendChild(wrap);
    container.appendChild(panel);

    const $time = wrap.querySelector("[data-time]");
    const $btn = wrap.querySelector("[data-refresh]");
    const $dot = wrap.querySelector("[data-dot]");
    const $pendingBtn = wrap.querySelector("[data-pending-btn]");
    const $pendingCount = wrap.querySelector("[data-pending-count]");
    const $pendingPanel = wrap.querySelector("[data-panel]");

    let lastRefreshMs = Date.now();
    let busy = false;
    let tickTimer = null;
    let autoTimer = null;
    let pendingDocs = [];

    function renderTime() {
      if ($time) $time.textContent = PuntazoRefreshBar.relativeTime(lastRefreshMs);
    }
    function renderPending() {
      if (!opts.showPending || !$pendingBtn) return;
      const n = pendingDocs.length;
      $pendingBtn.classList.toggle("is-hidden", n === 0);
      if (n === 0) {
        $pendingPanel.classList.remove("is-open");
        $pendingBtn.classList.remove("is-open");
        return;
      }
      $pendingCount.textContent = n === 1 ? "1 pendiente" : n + " pendientes";

      $pendingPanel.innerHTML = "";
      pendingDocs.forEach(function (doc) {
        const info = pendingStateInfo(doc);
        const row = document.createElement("div");
        row.className = "pz-rb-pi";
        const hm = fmtHM(doc.created_at);
        row.innerHTML =
          '<span class="pz-rb-pi-emoji">' + info.emoji + '</span>' +
          '<span class="pz-rb-pi-text">' +
            '<strong>' + info.label + '</strong>' +
            '<span class="meta">' + hm + (info.note ? ' · ' + info.note : '') + '</span>' +
          '</span>';
        if (info.url) {
          const a = document.createElement("a");
          a.className = "pz-rb-pi-action";
          a.href = info.url;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = "Ver clip";
          row.appendChild(a);
        }
        $pendingPanel.appendChild(row);
      });
    }

    async function doRefresh() {
      if (busy) return;
      busy = true;
      $btn.disabled = true;
      const prevText = $btn.textContent;
      $btn.textContent = "Actualizando…";
      $dot.classList.add("is-busy");

      try {
        if (typeof opts.onRefresh === "function") {
          await opts.onRefresh();
        }
        lastRefreshMs = Date.now();
      } catch (e) {
        console.warn("[refresh-bar] onRefresh falló:", e && e.message);
      }

      // Refrescar también el panel de pendientes si aplica.
      if (opts.showPending && window.PuntazoAuth && window.PuntazoAuth.currentUser) {
        try {
          pendingDocs = await fetchUserPending(window.PuntazoAuth.currentUser.uid, opts.context || {});
        } catch (_) { pendingDocs = []; }
      }

      busy = false;
      $btn.disabled = false;
      $btn.textContent = prevText;
      $dot.classList.remove("is-busy");
      renderTime();
      renderPending();
    }

    function startTicker() {
      stopTicker();
      // Tick cada 15s para mantener actualizado el "hace X" sin spamear.
      tickTimer = setInterval(renderTime, 15000);
    }
    function stopTicker() {
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    }
    function startAuto() {
      stopAuto();
      if (!opts.auto || opts.auto < 5000) return;
      autoTimer = setInterval(function () {
        if (document.visibilityState !== "visible") return;
        doRefresh();
      }, opts.auto);
    }
    function stopAuto() {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    }

    // Eventos
    $btn.addEventListener("click", doRefresh);
    if ($pendingBtn) {
      $pendingBtn.addEventListener("click", function () {
        const open = !$pendingPanel.classList.contains("is-open");
        $pendingPanel.classList.toggle("is-open", open);
        $pendingBtn.classList.toggle("is-open", open);
      });
    }

    // Pausa tickers cuando la pestaña no está visible (ahorra batería).
    function onVis() {
      if (document.visibilityState === "visible") {
        renderTime();
        startTicker();
        startAuto();
      } else {
        stopTicker();
        stopAuto();
      }
    }
    document.addEventListener("visibilitychange", onVis);

    // Init: si onRefresh existe, dispara la primera carga.
    renderTime();
    startTicker();
    startAuto();
    if (opts.refreshOnInit !== false) {
      doRefresh();
    }

    return {
      markRefreshed: function () { lastRefreshMs = Date.now(); renderTime(); },
      refreshNow: doRefresh,
      destroy: function () {
        stopTicker();
        stopAuto();
        document.removeEventListener("visibilitychange", onVis);
        try { wrap.remove(); } catch (_) {}
      },
    };
  }

  window.PuntazoRefreshBar = {
    attach: attach,
    relativeTime: relativeTime,
    _fetchUserPending: fetchUserPending,
  };
})();
