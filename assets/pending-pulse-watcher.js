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
  const LS_KEY_PREFIX = "pz.pendingPulse.readyCount.v1.";
  const QUERY_LIMIT = 100;
  let timer = null;
  let lastShownAtMs = 0;
  const SHOW_COOLDOWN_MS = 30 * 1000; // no re-mostrar el banner antes de 30s tras dismiss.

  function storageKey(uid) { return LS_KEY_PREFIX + uid; }
  function loadCount(uid) {
    try {
      const v = localStorage.getItem(storageKey(uid));
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    } catch (_) { return null; }
  }
  function saveCount(uid, n) {
    try { localStorage.setItem(storageKey(uid), String(n)); } catch (_) {}
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

  function renderBanner(uid, newReadyCount, currentReadyCount) {
    // Si match-expiration ya tiene un banner activo, esperamos para no
    // apilar dos (una sola notificación visible a la vez).
    if (document.getElementById("pz-mexp-bar")) return;
    // Cooldown post-dismiss
    if (Date.now() - lastShownAtMs < SHOW_COOLDOWN_MS) return;

    ensureStyles();
    const old = document.getElementById("pz-ppw-bar");
    if (old) old.remove();

    const bar = document.createElement("div");
    bar.id = "pz-ppw-bar";
    bar.className = "pz-ppw-bar";
    const titleText = newReadyCount === 1
      ? "Tu puntazo ya está listo"
      : `${newReadyCount} puntazos tuyos ya están listos`;
    const metaText = newReadyCount === 1
      ? "El clip que pediste ya se procesó. Velo en tu perfil."
      : "Los clips que pediste ya se procesaron. Revísalos en tu perfil.";

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
        '<a class="pz-ppw-btn is-primary" href="/perfil.html#mis-puntazos">Ver mis puntazos</a>' +
      '</div>';

    document.body.appendChild(bar);

    function dismiss() {
      // Al cerrar/clickear: sincronizamos el snapshot al count actual,
      // así no vuelve a aparecer hasta que SUBA otra vez.
      saveCount(uid, currentReadyCount);
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

      let readyCount = 0;
      snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (d.consumed_at && !d.error_reason) readyCount++;
      });

      const prev = loadCount(user.uid);
      if (prev == null) {
        // Primera visita registrada: solo guardamos baseline. No mostramos
        // banner para no confundir al usuario con "tienes N listos" la
        // primera vez (esos clips probablemente ya los vio).
        saveCount(user.uid, readyCount);
        return;
      }
      if (readyCount > prev) {
        const diff = readyCount - prev;
        if (suppressBanner) {
          // En perfil/boton/recuperar no mostramos banner pero sí
          // sincronizamos: el user ya vio los pulsos directamente ahí
          // o está en flujo activo de pedir más.
          saveCount(user.uid, readyCount);
        } else {
          renderBanner(user.uid, diff, readyCount);
          // NOTA: NO actualizamos saveCount aquí; lo hacemos solo
          // cuando el user dismisses/click. Eso garantiza que si
          // recarga sin verlo, el banner vuelve a aparecer.
        }
      } else if (readyCount < prev) {
        // El count bajó (probablemente porque pulsos viejos consumidos
        // se filtraron del query por antigüedad o por purge). Re-sync.
        saveCount(user.uid, readyCount);
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
