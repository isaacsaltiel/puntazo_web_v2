/*
 * EN2b — notifications.js  (centro de notificaciones · campana 🔔 · v2)
 *
 * Consolida en UN SOLO lugar (la campana del header) las señales que el
 * SERVIDOR ya escribe en notifications/{uid}/items (solicitudes de amistad,
 * partidos por confirmar, clips listos). Lee en TIEMPO REAL con un onSnapshot;
 * el "leído" vive en el documento (read/readAt), no en localStorage, así que
 * persiste entre dispositivos.
 *
 * CLIENTE PURO — no toca backend, functions ni reglas. Reglas LIVE: el dueño
 * LEE sus items y puede UPDATE solo ['read','readAt']; create/delete son
 * server-only. El cliente marca leído; no crea ni borra.
 *
 * Schema del item (doc.id = notifId determinístico type+"__"+refId):
 *   { type, refId, icon, title, subtitle, href, createdAt, read, readAt }
 *   refId de friend_request = friendshipId (para el botón "Aceptar").
 *
 * La campana:
 *  - Se inserta en .pz-nav-right--internal ANTES de .pz-auth-slot (solo variant
 *    internal, solo con sesión). Es HERMANO del slot, así sobrevive al re-render
 *    de window.updateNavUI (que solo reescribe [data-auth-slot]). Idempotente.
 *  - Se monta en puntazo:header-rendered, puntazo:auth-ready y auth-changed.
 *  - Setea window.PuntazoNotifications.active = true al montar, para que los
 *    vigías jubilen su banner flotante (la campana ya los muestra).
 *
 * Requiere: PuntazoAuth, PuntazoFirebase. Para "Aceptar" carga friends.js
 * (e identity.js) perezosamente best-effort.
 */
(function () {
  "use strict";

  if (window.PuntazoNotifications) return;

  var ITEMS_LIMIT = 30;

  var unsub = null;          // función para desuscribir el onSnapshot activo
  var panelOpen = false;
  var state = { items: [] };
  var outsideHandlersBound = false;

  // ── Utilidades ───────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function currentUser() {
    return (window.PuntazoAuth && window.PuntazoAuth.currentUser) || null;
  }
  function getDb() {
    try {
      var fb = window.PuntazoFirebase;
      if (!fb || typeof fb.db !== "function") return null;
      var db = fb.db();
      return (db && db.collection) ? db : null;
    } catch (_) { return null; }
  }
  function serverTs() {
    try { return firebase.firestore.FieldValue.serverTimestamp(); }
    catch (_) { return null; }
  }

  // notifications/{uid}/items
  function itemsRef(db, uid) {
    return db.collection("notifications").doc(uid).collection("items");
  }

  // ── No leído = read !== true (server-side, sin localStorage) ──
  function unseenCount() {
    return state.items.filter(function (it) { return it.read !== true; }).length;
  }
  var loadError = false;       // distinguir "error de red/permiso" de "vacío"
  var prevUnseen = 0;          // para animar el badge cuando SUBE

  // Fecha relativa humana desde un Timestamp de Firestore (o ms). "" si no hay.
  function tsToDate(ts) {
    try {
      if (!ts) return null;
      if (typeof ts.toDate === "function") return ts.toDate();
      if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
      if (typeof ts === "number") return new Date(ts);
    } catch (_) {}
    return null;
  }
  function fmtRel(ts) {
    var d = tsToDate(ts);
    if (!d) return "";
    var min = Math.floor((Date.now() - d.getTime()) / 60000);
    if (min < 1) return "ahora";
    if (min < 60) return "hace " + min + " min";
    var h = Math.floor(min / 60);
    if (h < 24) return "hace " + h + " h";
    var days = Math.floor(h / 24);
    if (days < 7) return "hace " + days + " d";
    var M = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return d.getDate() + " " + M[d.getMonth()];
  }

  // Marca UN item como leído (al tocarlo) — solo read/readAt (lo permite la regla).
  function markOneRead(id) {
    var db = getDb();
    var user = currentUser();
    if (!db || !user || !id) return;
    var it = state.items.find(function (x) { return x.id === id; });
    if (!it || it.read === true) return;
    it.read = true;
    renderBadge();
    try { itemsRef(db, user.uid).doc(id).update({ read: true, readAt: serverTs() }).catch(function () {}); }
    catch (_) {}
  }

  // ── Carga perezosa de dependencias (best-effort, solo "Aceptar") ─
  function ensureScript(src, ready) {
    return new Promise(function (resolve) {
      try {
        if (typeof ready === "function" && ready()) { resolve(); return; }
        var existing = Array.prototype.slice.call(document.scripts).find(function (s) {
          return s.src && s.src.indexOf(src) !== -1;
        });
        var done = false;
        function poll(start) {
          if (done) return;
          if (!ready || ready()) { done = true; resolve(); return; }
          if (Date.now() - start > 8000) { done = true; resolve(); return; } // degradar, no romper
          setTimeout(function () { poll(start); }, 100);
        }
        if (existing) { poll(Date.now()); return; }
        var sc = document.createElement("script");
        sc.src = src; sc.async = true;
        sc.onload = function () { poll(Date.now()); };
        sc.onerror = function () { resolve(); }; // si falla, seguimos sin esa fuente
        document.head.appendChild(sc);
      } catch (_) { resolve(); }
    });
  }
  async function ensureFriendsDeps() {
    // identity.js primero (algunas rutas de friends.js lo usan para hidratar)
    await ensureScript("/assets/identity.js", function () { return !!window.PuntazoIdentity; });
    await ensureScript("/assets/friends.js", function () { return !!window.PuntazoFriends; });
  }

  // ── Fuente: onSnapshot de notifications/{uid}/items ──────────
  function startListener(user) {
    if (unsub) return;                 // idempotente: no dupliques listeners
    var db = getDb();
    if (!db || !user) return;
    try {
      unsub = itemsRef(db, user.uid)
        .orderBy("createdAt", "desc")
        .limit(ITEMS_LIMIT)
        .onSnapshot(onSnap, onSnapError);
    } catch (_) {
      // Si la suscripción ni siquiera arranca, degradamos a panel vacío.
      state.items = [];
      renderBadge();
      if (panelOpen) renderPanel();
    }
  }
  function stopListener() {
    if (unsub) { try { unsub(); } catch (_) {} unsub = null; }
  }
  function onSnap(snap) {
    var items = [];
    snap.forEach(function (doc) {
      items.push(Object.assign({ id: doc.id }, doc.data()));
    });
    loadError = false;
    state.items = items;
    renderBadge();
    if (panelOpen) renderPanel();
  }
  function onSnapError(_err) {
    // Permiso/red: marcar error (distinto de "vacío") sin romper el header.
    loadError = true;
    state.items = [];
    renderBadge();
    if (panelOpen) renderPanel();
  }

  // ── Marcar leído en el servidor (solo read/readAt) ───────────
  function markAllRead() {
    var db = getDb();
    var user = currentUser();
    if (!db || !user) return;
    var unread = state.items.filter(function (it) { return it.read !== true; });
    if (!unread.length) return;
    var ref = itemsRef(db, user.uid);
    var ts = serverTs();
    // Optimista: bajamos el badge ya; el snapshot confirmará read=true.
    unread.forEach(function (it) { it.read = true; });
    renderBadge();
    unread.forEach(function (it) {
      try { ref.doc(it.id).update({ read: true, readAt: ts }).catch(function () {}); }
      catch (_) {}
    });
  }

  // ── Estilos ──────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById("pz-notif-styles")) return;
    var s = document.createElement("style");
    s.id = "pz-notif-styles";
    s.textContent =
      ".pz-notif-wrap{position:relative;display:flex;align-items:center;}" +
      ".pz-notif-btn{appearance:none;border:none;cursor:pointer;background:transparent;padding:0;" +
      "width:38px;height:38px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;" +
      "color:#eaf2ff;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);" +
      "box-shadow:0 8px 24px rgba(0,0,0,.28);transition:all .18s ease;position:relative;}" +
      ".pz-notif-btn:hover{transform:translateY(-1px);border-color:rgba(11,124,255,.38);background:rgba(0,79,200,.12);}" +
      ".pz-notif-btn svg{display:block;}" +
      ".pz-notif-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;" +
      "border-radius:999px;background:#ff3b5c;color:#fff;font-size:.66rem;font-weight:900;line-height:18px;" +
      "text-align:center;box-shadow:0 0 0 2px rgba(8,14,28,.9),0 4px 10px rgba(255,59,92,.45);display:none;}" +
      ".pz-notif-badge.is-on{display:block;}" +
      ".pz-notif-badge.is-pop{animation:pzNotifPop .42s cubic-bezier(.2,1.4,.4,1);}" +
      "@keyframes pzNotifPop{0%{transform:scale(.4);}60%{transform:scale(1.25);}100%{transform:scale(1);}}" +
      ".pz-notif-panel{position:absolute;top:calc(100% + 10px);right:0;width:330px;max-width:calc(100vw - 24px);" +
      "max-height:min(70vh,460px);overflow-y:auto;background:rgba(8,14,28,.94);border:1px solid rgba(255,255,255,.10);" +
      "border-radius:16px;box-shadow:0 22px 46px rgba(0,0,0,.44);backdrop-filter:blur(18px);overflow-x:hidden;" +
      "display:none;z-index:1200;}" +
      ".pz-notif-panel.is-open{display:block;}" +
      ".pz-notif-head{display:flex;align-items:center;justify-content:space-between;gap:10px;" +
      "padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08);color:#fff;font-size:.9rem;font-weight:800;}" +
      ".pz-notif-markall{appearance:none;border:none;background:transparent;color:#6fb2ff;font:inherit;" +
      "font-size:.74rem;font-weight:800;cursor:pointer;padding:0;}" +
      ".pz-notif-markall:hover{text-decoration:underline;}" +
      ".pz-notif-empty{padding:22px 16px;color:rgba(234,242,255,.58);font-size:.85rem;text-align:center;}" +
      ".pz-notif-err{padding:20px 16px;color:#ffb1a3;font-size:.84rem;text-align:center;}" +
      ".pz-notif-err button{display:block;margin:10px auto 0;border:1px solid rgba(255,255,255,.18);" +
      "background:rgba(255,255,255,.06);color:#eaf2ff;border-radius:8px;padding:6px 14px;font:inherit;" +
      "font-size:.78rem;font-weight:800;cursor:pointer;}" +
      ".pz-notif-item{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;text-decoration:none;" +
      "border-bottom:1px solid rgba(255,255,255,.05);transition:background .15s;position:relative;}" +
      ".pz-notif-item:last-child{border-bottom:none;}" +
      ".pz-notif-item:hover{background:rgba(255,255,255,.06);}" +
      ".pz-notif-item.is-unread{background:rgba(11,124,255,.10);}" +
      ".pz-notif-item.is-unread:hover{background:rgba(11,124,255,.16);}" +
      ".pz-notif-item.is-unread::before{content:'';position:absolute;left:5px;top:50%;transform:translateY(-50%);" +
      "width:6px;height:6px;border-radius:50%;background:#0B7CFF;box-shadow:0 0 6px rgba(11,124,255,.8);}" +
      ".pz-notif-ico{font-size:1.25rem;line-height:1.3;flex-shrink:0;}" +
      ".pz-notif-body{flex:1;min-width:0;}" +
      ".pz-notif-toprow{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}" +
      ".pz-notif-title{display:block;color:#fff;font-size:.85rem;font-weight:800;line-height:1.3;}" +
      ".pz-notif-time{flex-shrink:0;color:rgba(234,242,255,.45);font-size:.68rem;font-weight:700;white-space:nowrap;}" +
      ".pz-notif-sub{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:rgba(234,242,255,.72);" +
      "font-size:.78rem;margin-top:3px;line-height:1.35;overflow:hidden;}" +
      ".pz-notif-accept{margin-top:7px;display:inline-block;border:1px solid rgba(11,124,255,.55);" +
      "background:rgba(11,124,255,.18);color:#eaf2ff;border-radius:8px;padding:5px 10px;font:inherit;" +
      "font-size:.76rem;font-weight:800;cursor:pointer;}" +
      ".pz-notif-accept:hover{background:rgba(11,124,255,.3);}" +
      ".pz-notif-accept[disabled]{opacity:.55;cursor:default;}" +
      "@media(max-width:860px){.pz-notif-panel{right:-8px;width:300px;}" +
      ".pz-notif-btn{width:44px;height:44px;}}";
    document.head.appendChild(s);
  }

  function bellSVG() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M13.7 21a2 2 0 0 1-3.4 0" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // ── Render ───────────────────────────────────────────────────
  function renderBadge() {
    var badge = document.getElementById("pz-notif-badge");
    if (!badge) return;
    var n = unseenCount();
    if (n > 0) {
      badge.textContent = n > 9 ? "9+" : String(n);
      badge.classList.add("is-on");
      // Pop solo cuando SUBE el conteo (algo nuevo llegó), no en cada render.
      if (n > prevUnseen) {
        badge.classList.remove("is-pop");
        void badge.offsetWidth; // reinicia la animación
        badge.classList.add("is-pop");
      }
    } else {
      badge.classList.remove("is-on");
    }
    // aria: anuncia el conteo a lectores de pantalla.
    var btn = document.querySelector("[data-notif-btn]");
    if (btn) btn.setAttribute("aria-label", n > 0 ? ("Notificaciones, " + n + " sin leer") : "Notificaciones");
    prevUnseen = n;
  }

  function renderPanel() {
    var panel = document.getElementById("pz-notif-panel");
    if (!panel) return;
    var unread = unseenCount();
    var head =
      '<div class="pz-notif-head"><span>Notificaciones</span>' +
        (unread > 0 ? '<button type="button" class="pz-notif-markall" data-markall>Marcar todas como leídas</button>' : "") +
      '</div>';

    var body;
    if (loadError) {
      body = '<div class="pz-notif-err">No pudimos cargar tus notificaciones.' +
             '<button type="button" data-notif-retry>Reintentar</button></div>';
    } else if (!state.items.length) {
      body = '<div class="pz-notif-empty">Estás al día — no tienes notificaciones.</div>';
    } else {
      body = state.items.map(function (it) {
        var acceptBtn = (it.type === "friend_request" && it.refId)
          ? '<button type="button" class="pz-notif-accept" data-accept="' + esc(it.refId) + '">Aceptar</button>'
          : "";
        var when = fmtRel(it.createdAt);
        var unreadCls = (it.read !== true) ? " is-unread" : "";
        return '<a class="pz-notif-item' + unreadCls + '" href="' + esc(it.href) + '" data-read-id="' + esc(it.id) + '">' +
            '<span class="pz-notif-ico">' + esc(it.icon) + '</span>' +
            '<span class="pz-notif-body">' +
              '<span class="pz-notif-toprow">' +
                '<span class="pz-notif-title">' + esc(it.title) + '</span>' +
                (when ? '<span class="pz-notif-time">' + esc(when) + '</span>' : "") +
              '</span>' +
              '<span class="pz-notif-sub">' + esc(it.subtitle) + '</span>' +
              acceptBtn +
            '</span>' +
          '</a>';
      }).join("");
    }
    panel.innerHTML = head + body;

    // "Marcar todas como leídas" — control explícito para bajar el badge sin
    // tener que abrir cada notificación (el abrir ya NO marca todo leído).
    var markAllBtn = panel.querySelector("[data-markall]");
    if (markAllBtn) markAllBtn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation(); markAllRead(); renderPanel();
    });

    // Reintentar tras error de red/permiso.
    var retryBtn = panel.querySelector("[data-notif-retry]");
    if (retryBtn) retryBtn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      loadError = false; stopListener(); startListener(currentUser()); renderPanel();
    });

    // Tocar un ítem lo marca leído (read = "interactuado", patrón estándar) y
    // deja que la navegación del <a> proceda. No preventDefault.
    panel.querySelectorAll("[data-read-id]").forEach(function (a) {
      a.addEventListener("click", function () { markOneRead(a.getAttribute("data-read-id")); });
    });

    // Botón "Aceptar" inline (best-effort). Marca leído y, tras aceptar, el
    // trigger del servidor borra el notif → el onSnapshot lo quita solo.
    panel.querySelectorAll("[data-accept]").forEach(function (btn) {
      btn.addEventListener("click", async function (e) {
        e.preventDefault(); e.stopPropagation();
        var fid = btn.getAttribute("data-accept");
        var card = btn.closest("[data-read-id]");
        if (card) markOneRead(card.getAttribute("data-read-id"));
        btn.disabled = true; btn.textContent = "Aceptando…";
        try {
          await ensureFriendsDeps();
          if (window.PuntazoFriends && typeof window.PuntazoFriends.acceptFriendRequest === "function") {
            await window.PuntazoFriends.acceptFriendRequest(fid);
          }
        } catch (_) {
          btn.disabled = false; btn.textContent = "Aceptar";
        }
      });
    });
  }

  // ── Abrir / cerrar ───────────────────────────────────────────
  function openPanel() {
    var panel = document.getElementById("pz-notif-panel");
    if (!panel) return;
    panelOpen = true;
    renderPanel();
    panel.classList.add("is-open");
    // NO marcamos todo leído al abrir: el badge persiste hasta que tocas una
    // notificación o usas "Marcar todas". Patrón estándar (leído = interactuado).
    var btn = document.querySelector("[data-notif-btn]");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }
  function closePanel() {
    var panel = document.getElementById("pz-notif-panel");
    panelOpen = false;
    if (panel) panel.classList.remove("is-open");
    var btn = document.querySelector("[data-notif-btn]");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function togglePanel() { panelOpen ? closePanel() : openPanel(); }

  function bindOutside() {
    if (outsideHandlersBound) return;
    outsideHandlersBound = true;
    document.addEventListener("click", function (e) {
      if (!panelOpen) return;
      var wrap = document.getElementById("pz-notif-bell");
      if (wrap && !wrap.contains(e.target)) closePanel();
    });
    // Cerrar con Esc (accesibilidad). NO cerramos por scroll (molesto en mobile:
    // el gesto de leer/scrollear dentro o fuera del panel lo cerraba de golpe).
    document.addEventListener("keydown", function (e) {
      if (panelOpen && (e.key === "Escape" || e.key === "Esc")) closePanel();
    });
  }

  // ── Montaje / desmontaje (sobrevive a updateNavUI) ───────────
  function mountBell() {
    var container = document.querySelector(".pz-nav-right--internal");
    if (!container) return;            // solo variant internal
    var user = currentUser();
    if (!user) { unmountBell(); return; } // sin sesión: no campana
    if (document.getElementById("pz-notif-bell")) {
      // Ya montada: asegúrate de que el listener esté vivo (idempotente).
      startListener(user);
      return;
    }

    ensureStyles();
    var wrap = document.createElement("div");
    wrap.id = "pz-notif-bell";
    wrap.className = "pz-notif-wrap";
    wrap.innerHTML =
      '<button type="button" class="pz-notif-btn" data-notif-btn aria-label="Notificaciones" aria-haspopup="true" aria-expanded="false">' +
        bellSVG() +
        '<span class="pz-notif-badge" id="pz-notif-badge"></span>' +
      '</button>' +
      '<div class="pz-notif-panel" id="pz-notif-panel"></div>';

    var slot = container.querySelector(".pz-auth-slot");
    if (slot) container.insertBefore(wrap, slot); else container.appendChild(wrap);

    var btn = wrap.querySelector("[data-notif-btn]");
    if (btn) btn.addEventListener("click", function (e) { e.stopPropagation(); togglePanel(); });
    bindOutside();

    PuntazoNotifications.active = true;
    // Cierra la ventana de carrera: si un vigía alcanzó a pintar su banner
    // flotante (confirmar/clip) antes de que montara la campana, lo retiramos
    // (la campana ya los consolida). El banner verde de "partido en curso"
    // (#pz-active-banner) NO se toca.
    ["pz-mcw-bar", "pz-ppw-bar"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) { try { b.remove(); } catch (_) {} }
    });
    renderBadge();
    startListener(user);
  }
  function unmountBell() {
    stopListener();
    var wrap = document.getElementById("pz-notif-bell");
    if (wrap) { try { wrap.remove(); } catch (_) {} }
    panelOpen = false;
    state.items = [];
  }

  // ── API pública ──────────────────────────────────────────────
  window.PuntazoNotifications = {
    active: false,
    mount: mountBell,
    // Re-render desde el estado en memoria (el onSnapshot es la fuente real).
    refresh: function () { renderBadge(); if (panelOpen) renderPanel(); },
    _state: state,
  };

  // ── Boot ─────────────────────────────────────────────────────
  function onAuthChanged(ev) {
    var user = (ev && ev.detail && ev.detail.user) || currentUser();
    if (user) mountBell(); else unmountBell();
  }
  window.addEventListener("puntazo:header-rendered", mountBell);
  window.addEventListener("puntazo:auth-ready", mountBell);
  window.addEventListener("puntazo:auth-changed", onAuthChanged);
  // Si auth ya estaba listo cuando este script cargó (header lo carga tras auth):
  if (currentUser()) mountBell();
})();
