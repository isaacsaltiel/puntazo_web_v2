/*
 * F122 — pending-pulse-watcher.js
 *
 * Avisa al usuario cuando uno o varios de sus pulsos pendientes pasaron
 * a estado "listo" desde la última vez que visitó el sitio.
 *
 * Comportamiento:
 * - En cualquier página interna (excepto boton/recuperar/perfil donde
 *   el contexto es distinto): tras puntazo:auth-ready, query
 *   pending_pulses where uid_creator == user.uid, cuenta los "ready"
 *   (consumed_at != null && !error_reason) y compara con el snapshot
 *   guardado en localStorage. Si subió, aparece banner verde flotante
 *   abajo: "✅ N puntazo(s) listo(s) — Ver mis puntazos".
 * - El banner replica el patrón visual de match-expiration.js (mismo
 *   layout, animación pzMexpIn, mismo close button) pero con paleta
 *   verde-azul.
 * - Una sola interacción la silencia: al cerrar el modal o seguir el
 *   CTA, el snapshot se actualiza al count actual y no reaparece.
 * - Re-chequea cada 60s mientras estás en la página (útil si el clip
 *   se procesa mientras navegas).
 *
 * NO corre en:
 * - /boton.html → user está pidiendo más pulsos, no debe interrumpirse.
 * - /recuperar.html → idem, flujo de recovery activo.
 * - /perfil.html → ya muestra "Mis puntazos pendientes" embedded.
 *
 * Requiere: PuntazoAuth + PuntazoFirebase (Firestore compat) cargados.
 * Self-installs on DOMContentLoaded.
 */
(function () {
  "use strict";

  if (window.__PZ_PENDING_WATCHER_LOADED__) return;
  window.__PZ_PENDING_WATCHER_LOADED__ = true;

  // Páginas donde NO se renderiza el banner (pero sí se sincroniza el
  // snapshot LS, para que cuando el user vuelva a páginas normales el
  // contador esté actualizado y no le salga banner stale).
  const path = (window.location.pathname || "").toLowerCase();
  const SUPPRESS_RE = /\/(boton|recuperar|perfil)\.html$/;
  const suppressBanner = SUPPRESS_RE.test(path);

  const CHECK_INTERVAL_MS = 60 * 1000;
  const LS_KEY_PREFIX = "pz.pendingPulse.readyIds.v2."; // v2: ahora guardamos IDS, no un count
  const QUERY_LIMIT = 100;
  let timer = null;
  let lastShownAtMs = 0;
  const SHOW_COOLDOWN_MS = 30 * 1000; // no re-mostrar el banner antes de 30s tras dismiss.

  function storageKey(uid) { return LS_KEY_PREFIX + uid; }
  function loadReadyIds(uid) {
    try { return JSON.parse(localStorage.getItem(storageKey(uid)) || "null"); } catch (_) { return null; }
  }
  function saveReadyIds(uid, ids) {
    try { localStorage.setItem(storageKey(uid), JSON.stringify(ids || [])); } catch (_) {}
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])
    );
  }

  function ensureStyles() {
    if (document.getElementById("pz-ppw-styles")) return;
    const s = document.createElement("style");
    s.id = "pz-ppw-styles";
    s.textContent = `
      .pz-ppw-bar{
        position:fixed; left:50%; bottom:18px; transform:translateX(-50%);
        z-index:9000; max-width:560px; width:calc(100% - 24px);
        background:linear-gradient(180deg, rgba(34,197,94,.22), rgba(2,6,16,.93));
        border:1px solid rgba(34,197,94,.55);
        border-radius:14px; padding:12px 14px;
        box-shadow:0 18px 50px rgba(0,0,0,.45), 0 0 26px rgba(34,197,94,.22);
        backdrop-filter:blur(14px);
        color:#fff; font-family:inherit;
        display:flex; flex-direction:column; gap:10px;
        animation:pzPpwIn .35s cubic-bezier(.2,.8,.2,1);
      }
      @keyframes pzPpwIn{from{opacity:0;transform:translate(-50%,16px);}to{opacity:1;transform:translate(-50%,0);}}
      .pz-ppw-head{display:flex; align-items:flex-start; gap:10px;}
      .pz-ppw-ico{
        font-size:1.5rem; line-height:1; flex-shrink:0;
        filter:drop-shadow(0 0 10px rgba(34,197,94,.55));
      }
      .pz-ppw-text{flex:1; min-width:0;}
      .pz-ppw-text strong{display:block; font-size:.96rem; font-weight:900; color:#fff; line-height:1.25;}
      .pz-ppw-text .meta{display:block; font-size:.80rem; color:rgba(234,242,255,.78); margin-top:3px; line-height:1.35;}
      .pz-ppw-close{
        background:transparent; border:none; color:rgba(234,242,255,.55);
        font-size:1.1rem; cursor:pointer; padding:0 4px; line-height:1;
        font-family:inherit; font-weight:900;
      }
      .pz-ppw-close:hover{color:#fff;}
      .pz-ppw-actions{display:flex; gap:8px; flex-wrap:wrap;}
      .pz-ppw-btn{
        flex:1; min-width:120px; padding:9px 12px; border-radius:10px;
        border:1px solid rgba(255,255,255,.16);
        background:rgba(255,255,255,.06); color:#fff;
        font-family:inherit; font-weight:800; font-size:.84rem;
        cursor:pointer; text-decoration:none; text-align:center;
        transition:background .15s, border-color .15s;
      }
      .pz-ppw-btn:hover{background:rgba(255,255,255,.12);}
      .pz-ppw-btn.is-primary{
        background:linear-gradient(180deg, rgba(34,197,94,.40), rgba(34,197,94,.20));
        border-color:rgba(34,197,94,.65);
      }
      .pz-ppw-btn.is-primary:hover{
        background:linear-gradient(180deg, rgba(34,197,94,.50), rgba(34,197,94,.28));
      }
    `;
    document.head.appendChild(s);
  }

  function renderBanner(uid, newIds, currentIds) {
    // EN1: la campana del header ya consolida "clips listos". Si está
    // activa, no pintamos el banner flotante (evita duplicar). El estado
    // "sin leer" lo lleva la campana en su propio localStorage.
    if (window.PuntazoNotifications && window.PuntazoNotifications.active) return;
    // Si match-expiration ya tiene un banner activo, esperamos para no
    // apilar dos (una sola notificación visible a la vez).
    if (document.getElementById("pz-mexp-bar")) return;
    // Cooldown post-dismiss
    if (Date.now() - lastShownAtMs < SHOW_COOLDOWN_MS) return;

    ensureStyles();
    const old = document.getElementById("pz-ppw-bar");
    if (old) old.remove();

    const n = newIds.length;
    const bar = document.createElement("div");
    bar.id = "pz-ppw-bar";
    bar.className = "pz-ppw-bar";
    const titleText = n === 1
      ? "Tu puntazo ya está listo"
      : `${n} puntazos tuyos ya están listos`;
    const metaText = n === 1
      ? "El clip que pediste ya se procesó. Tócalo para verlo."
      : "Los clips que pediste ya se procesaron. Revísalos en tu perfil.";
    // Un solo clip nuevo → aterriza en ESE puntazo (se resalta al llegar).
    const href = (n === 1)
      ? "/perfil.html?pulse=" + encodeURIComponent(newIds[0]) + "#mis-puntazos"
      : "/perfil.html#mis-puntazos";

    bar.innerHTML =
      '<div class="pz-ppw-head">' +
        '<span class="pz-ppw-ico">✅</span>' +
        '<div class="pz-ppw-text">' +
          '<strong>' + esc(titleText) + '</strong>' +
          '<span class="meta">' + esc(metaText) + '</span>' +
        '</div>' +
        '<button class="pz-ppw-close" type="button" aria-label="Cerrar">×</button>' +
      '</div>' +
      '<div class="pz-ppw-actions">' +
        '<a class="pz-ppw-btn is-primary" href="' + href + '">' + (n === 1 ? "Ver mi puntazo" : "Ver mis puntazos") + '</a>' +
      '</div>';

    document.body.appendChild(bar);

    function dismiss() {
      // Al cerrar/clickear: el snapshot pasa a TODOS los ready actuales,
      // así no vuelve a aparecer hasta que llegue uno NUEVO.
      saveReadyIds(uid, currentIds);
      lastShownAtMs = Date.now();
      bar.remove();
    }
    bar.querySelector(".pz-ppw-close").addEventListener("click", dismiss);
    bar.querySelector(".pz-ppw-btn.is-primary").addEventListener("click", dismiss);
  }

  async function check() {
    try {
      const user = window.PuntazoAuth && window.PuntazoAuth.currentUser;
      if (!user) return;
      const fb = window.PuntazoFirebase;
      if (!fb || typeof fb.db !== "function") return;
      const db = fb.db();
      if (!db || !db.collection) return;

      // Query simple sin orderBy/limit compuestos para evitar requerir
      // un índice nuevo en Firestore. Limit 100 cubre cualquier user
      // razonable (los muy heavy users tendrán recent N pendientes, ok).
      const snap = await db.collection("pending_pulses")
        .where("uid_creator", "==", user.uid)
        .limit(QUERY_LIMIT)
        .get();

      const readyIds = [];
      snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (d.consumed_at && !d.error_reason) readyIds.push(doc.id);
      });

      const prev = loadReadyIds(user.uid);
      if (prev == null || !Array.isArray(prev)) {
        // Primera visita registrada: solo guardamos baseline. No mostramos
        // banner para no confundir con "tienes N listos" la primera vez.
        saveReadyIds(user.uid, readyIds);
        return;
      }
      const prevSet = {};
      prev.forEach(function (id) { prevSet[id] = 1; });
      const newIds = readyIds.filter(function (id) { return !prevSet[id]; });
      if (newIds.length) {
        if (suppressBanner) {
          // En perfil/boton/recuperar no mostramos banner pero sí sincronizamos.
          saveReadyIds(user.uid, readyIds);
        } else {
          renderBanner(user.uid, newIds, readyIds);
          // NOTA: NO guardamos aquí; solo en dismiss/click, para que si
          // recarga sin verlo, el banner reaparezca.
        }
      } else if (readyIds.length < prev.length) {
        // Algunos ready viejos se purgaron del query → resync.
        saveReadyIds(user.uid, readyIds);
      }
    } catch (e) {
      // Silencioso: el watcher es best-effort, no crítico.
      console.warn("[pending-pulse-watcher] check error", e && e.message ? e.message : e);
    }
  }

  function start() {
    check();
    if (timer) clearInterval(timer);
    timer = setInterval(check, CHECK_INTERVAL_MS);
  }

  function boot() {
    if (window.PuntazoAuth && window.PuntazoAuth.currentUser) start();
    window.addEventListener("puntazo:auth-ready", start);
    window.addEventListener("puntazo:auth-changed", start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
