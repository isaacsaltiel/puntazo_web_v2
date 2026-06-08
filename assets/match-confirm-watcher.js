/*
 * F4 — match-confirm-watcher.js
 *
 * Avisa al RIVAL (y a cualquier jugador con cuenta) cuando tiene un partido
 * registrado por alguien más, pendiente de SU confirmación. Banner azul flotante
 * abajo, mismo patrón visual que pending-pulse-watcher.js (clip listo).
 *
 * Lógica:
 * - Tras auth-ready: query matches where playerUids array-contains miUid (limit 50).
 *   array-contains solo → NO requiere índice compuesto.
 * - Filtra los que: status == pending_confirmation, no vencidos, registrados por
 *   OTRO (userId != yo) y que yo aún NO he aceptado (scoreAcceptedBy[mi] != true).
 * - Si hay ≥1 no descartado → banner "Tienes N partido(s) por confirmar →
 *   Confirmar" que abre confirmar.html?id=<el más reciente>.
 * - "Después" / cerrar → snooze ese match (localStorage) para no fastidiar.
 * - Re-chequea cada 60s.
 *
 * NO corre en /confirmar.html (ya estás confirmando) ni /registrar*.html.
 * Requiere: PuntazoAuth + PuntazoFirebase (Firestore compat).
 */
(function () {
  "use strict";
  if (window.__PZ_MATCH_CONFIRM_WATCHER__) return;
  window.__PZ_MATCH_CONFIRM_WATCHER__ = true;

  var path = (window.location.pathname || "").toLowerCase();
  if (/\/(confirmar|registrar|registrar-min)\.html$/.test(path)) return;

  var CHECK_INTERVAL_MS = 60 * 1000;
  var LS_SNOOZE = "pz.matchConfirm.snoozed.v1"; // { matchId: untilMs }
  var QUERY_LIMIT = 50;
  var timer = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }
  function firstName(n) { return String(n || "").trim().split(/\s+/)[0] || n; }

  function loadSnooze() {
    try { return JSON.parse(localStorage.getItem(LS_SNOOZE) || "{}") || {}; } catch (_) { return {}; }
  }
  function snooze(matchId) {
    try {
      var s = loadSnooze();
      s[matchId] = Date.now() + 12 * 60 * 60 * 1000; // 12h
      localStorage.setItem(LS_SNOOZE, JSON.stringify(s));
    } catch (_) {}
  }
  function isSnoozed(matchId) {
    var s = loadSnooze();
    return s[matchId] && Date.now() < s[matchId];
  }

  function ensureStyles() {
    if (document.getElementById("pz-mcw-styles")) return;
    var s = document.createElement("style");
    s.id = "pz-mcw-styles";
    s.textContent =
      ".pz-mcw-bar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9000;" +
      "max-width:560px;width:calc(100% - 24px);background:linear-gradient(180deg,rgba(11,124,255,.22),rgba(2,6,16,.93));" +
      "border:1px solid rgba(11,124,255,.55);border-radius:14px;padding:12px 14px;" +
      "box-shadow:0 18px 50px rgba(0,0,0,.45),0 0 26px rgba(11,124,255,.22);backdrop-filter:blur(14px);" +
      "color:#fff;font-family:inherit;display:flex;flex-direction:column;gap:10px;animation:pzMcwIn .35s cubic-bezier(.2,.8,.2,1);}" +
      "@keyframes pzMcwIn{from{opacity:0;transform:translate(-50%,16px);}to{opacity:1;transform:translate(-50%,0);}}" +
      ".pz-mcw-head{display:flex;align-items:flex-start;gap:10px;}" +
      ".pz-mcw-ico{font-size:1.5rem;line-height:1;flex-shrink:0;filter:drop-shadow(0 0 10px rgba(11,124,255,.55));}" +
      ".pz-mcw-text{flex:1;min-width:0;}" +
      ".pz-mcw-text strong{display:block;font-size:.96rem;font-weight:900;color:#fff;line-height:1.25;}" +
      ".pz-mcw-text .meta{display:block;font-size:.80rem;color:rgba(234,242,255,.78);margin-top:3px;line-height:1.35;}" +
      ".pz-mcw-close{background:transparent;border:none;color:rgba(234,242,255,.55);font-size:1.1rem;cursor:pointer;padding:0 4px;line-height:1;font-weight:900;}" +
      ".pz-mcw-close:hover{color:#fff;}" +
      ".pz-mcw-actions{display:flex;gap:8px;flex-wrap:wrap;}" +
      ".pz-mcw-btn{flex:1;min-width:120px;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);" +
      "background:rgba(255,255,255,.06);color:#fff;font-family:inherit;font-weight:800;font-size:.84rem;cursor:pointer;" +
      "text-decoration:none;text-align:center;transition:background .15s,border-color .15s;}" +
      ".pz-mcw-btn:hover{background:rgba(255,255,255,.12);}" +
      ".pz-mcw-btn.is-primary{background:linear-gradient(180deg,rgba(11,124,255,.45),rgba(11,124,255,.22));border-color:rgba(11,124,255,.65);}" +
      ".pz-mcw-btn.is-primary:hover{background:linear-gradient(180deg,rgba(11,124,255,.55),rgba(11,124,255,.3));}";
    document.head.appendChild(s);
  }

  function renderBanner(pending) {
    // EN1: la campana del header ya consolida "partidos por confirmar".
    // Si está activa, no pintamos el banner flotante (evita duplicar).
    if (window.PuntazoNotifications && window.PuntazoNotifications.active) return;
    if (document.getElementById("pz-mexp-bar") || document.getElementById("pz-ppw-bar")) return; // una a la vez
    ensureStyles();
    var old = document.getElementById("pz-mcw-bar");
    if (old) old.remove();

    var first = pending[0];
    var n = pending.length;
    var title = n === 1 ? "Tienes un partido por confirmar" : (n + " partidos por confirmar");
    var meta = n === 1
      ? (esc(first.regName) + " registró un partido contigo. Confírmalo para que cuente en el ranking.")
      : "Varios rivales registraron partidos contigo. Confírmalos para que cuenten en el ranking.";

    var bar = document.createElement("div");
    bar.id = "pz-mcw-bar"; bar.className = "pz-mcw-bar";
    bar.innerHTML =
      '<div class="pz-mcw-head">' +
        '<span class="pz-mcw-ico">🎾</span>' +
        '<div class="pz-mcw-text"><strong>' + esc(title) + '</strong><span class="meta">' + meta + '</span></div>' +
        '<button class="pz-mcw-close" type="button" aria-label="Cerrar">×</button>' +
      '</div>' +
      '<div class="pz-mcw-actions">' +
        '<a class="pz-mcw-btn is-primary" href="/confirmar.html?id=' + encodeURIComponent(first.id) + '">Confirmar' + (n > 1 ? " (1 de " + n + ")" : "") + '</a>' +
        '<button class="pz-mcw-btn" type="button" data-act="later">Después</button>' +
      '</div>';
    document.body.appendChild(bar);

    bar.querySelector(".pz-mcw-close").addEventListener("click", function () { snooze(first.id); bar.remove(); });
    bar.querySelector('[data-act="later"]').addEventListener("click", function () { snooze(first.id); bar.remove(); });
  }

  function isExpired(m) {
    var exp = m.confirmation && m.confirmation.expiresAtMs;
    return typeof exp === "number" && Date.now() > exp;
  }

  async function check() {
    try {
      var user = window.PuntazoAuth && window.PuntazoAuth.currentUser;
      if (!user) return;
      var fb = window.PuntazoFirebase;
      if (!fb || typeof fb.db !== "function") return;
      var db = fb.db();
      if (!db || !db.collection) return;

      var snap = await db.collection("matches")
        .where("playerUids", "array-contains", user.uid)
        .limit(QUERY_LIMIT)
        .get();

      var pending = [];
      snap.forEach(function (doc) {
        var m = doc.data() || {};
        if (m.status !== "pending_confirmation") return;
        if (m.userId === user.uid) return;                 // yo lo registré, no me toca confirmar
        if (m.scoreAcceptedBy && m.scoreAcceptedBy[user.uid]) return; // ya acepté
        if (isExpired(m)) return;
        if (isSnoozed(doc.id)) return;
        var js = Array.isArray(m.jugadores) ? m.jugadores : [];
        var reg = js.find(function (j) { return j && j.uid === m.userId; });
        pending.push({ id: doc.id, regName: reg ? firstName(reg.nombre) : "Alguien", createdAt: m.createdAt });
      });

      if (pending.length) renderBanner(pending);
      else { var b = document.getElementById("pz-mcw-bar"); if (b) b.remove(); }
    } catch (e) {
      console.warn("[match-confirm-watcher]", e && e.message ? e.message : e);
    }
  }

  function start() { check(); if (timer) clearInterval(timer); timer = setInterval(check, CHECK_INTERVAL_MS); }
  function boot() {
    if (window.PuntazoAuth && window.PuntazoAuth.currentUser) start();
    window.addEventListener("puntazo:auth-ready", start);
    window.addEventListener("puntazo:auth-changed", start);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
