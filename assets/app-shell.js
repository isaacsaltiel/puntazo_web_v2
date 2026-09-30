/* ══════════════════════════════════════════════════════════════
   PUNTAZO — app-shell.js  (2026-09-28, rediseño app shell)
   Navegación de app, compartida por todas las páginas "de app":
     - Barra inferior (móvil/tablet) = barra lateral (desktop): misma DOM,
       el CSS (app-shell.css) decide la forma.
     - Chip "Club · Cancha ▾" en el header → selector (hoja/popover).
     - Menú de cuenta (avatar o ícono de persona).
   Depende de app-context.js (PuntazoContext) y clubs-catalog.js
   (PuntazoClubs); header.js carga ambos antes que este archivo.
   Páginas sin header (boton.html) lo incluyen directo y solo obtienen la
   barra de navegación y el selector.

   API en window.PuntazoAppShell:
     openLocation()   → abre el selector de club/cancha
     openAccount()    → abre el menú de cuenta
     renderAuth(user) → header.js lo llama al cambiar la sesión
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoAppShell) return;

  var Ctx = window.PuntazoContext;
  if (!Ctx) { console.warn("[app-shell] falta app-context.js"); return; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function track(name, params) { try { if (window.gtag) gtag("event", name, params || {}); } catch (e) {} }

  var ICON = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg>',
    clips: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor"/></svg>',
    saved: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z"/></svg>',
    recover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    caret: '<svg class="pz-ctx-caret" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    chev: '<svg class="pz-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    google: '<svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>'
  };

  // ── Qué pestaña está activa (por ruta) ──
  function activeTab() {
    var p = (location.pathname || "").toLowerCase();
    if (/inicio\.html/.test(p)) return "inicio";
    if (/lado\.html|clip\.html|cancha\.html|feed\.html/.test(p)) return "clips";
    if (/boton\.html/.test(p)) return "puntazo";
    if (/guardados\.html|mis-clips\.html/.test(p)) return "guardados";
    if (/recuperar\.html/.test(p)) return "recuperar";
    if (/entrada\.html/.test(p)) {
      var m = (new URLSearchParams(location.search).get("modo") || "").toLowerCase();
      return m === "boton" ? "puntazo" : (m === "clips" || m === "canchas") ? "clips" : "inicio";
    }
    return "";
  }

  // (2026-09-28) Inicio (y el selector de club) son por CLUB: ahí el chip
  // muestra solo el club y abre la lista de clubes. En el resto de la app el
  // chip es "Club · Cancha" y abre las canchas.
  function clubLevelPage() {
    var p = (location.pathname || "").toLowerCase();
    // (2026-09-30) Si la pantalla YA está preguntando la cancha (selector a
    // pantalla completa), el chip muestra solo el club: no repetir la pregunta.
    if (document.body && document.body.dataset.pzSelector === "cancha") return true;
    if (/inicio\.html|vivo\.html|herramientas\.html/.test(p)) return true;
    if (/feed\.html/.test(p)) return !new URLSearchParams(location.search).get("can");
    return /entrada\.html/.test(p) && activeTab() === "inicio";
  }

  // (2026-09-30) Enlaces que dependen de lo que el club tiene (data-cap="vivo"):
  // nacen ocultos y se muestran solo si PuntazoContext.capacidades lo confirma.
  function aplicarCaps(root) {
    var els = (root || document).querySelectorAll("[data-cap]");
    if (!els.length || !Ctx.capacidades) return;
    Ctx.capacidades(Ctx.club()).then(function (cap) {
      els.forEach(function (el) { el.hidden = !cap[el.dataset.cap]; });
    });
  }

  // ── Barra de navegación ──
  function tabsHTML() {
    var cur = activeTab();
    function tab(key, href, label, icon, extra) {
      return '<a class="pz-tab' + (extra || "") + (cur === key ? " is-active" : "") + '" data-tab="' + key + '" href="' + esc(href) + '"' +
        (cur === key ? ' aria-current="page"' : "") + ">" + icon + '<span class="pz-tab-lbl">' + label + "</span></a>";
    }
    return (
      tab("inicio", Ctx.url("inicio"), "Inicio", ICON.home) +
      tab("clips", Ctx.url("clips"), "Clips", ICON.clips) +
      tab("puntazo", Ctx.url("boton"), "Puntazo", '<span class="pz-tab-p" aria-hidden="true"></span>', " pz-tab--puntazo") +
      tab("guardados", "/guardados.html", "Guardados", ICON.saved) +
      tab("recuperar", Ctx.url("recuperar"), "Recuperar", ICON.recover) +
      '<div class="pz-side-foot">' +
        '<a href="/vivo.html' + (Ctx.club() ? "?club=" + encodeURIComponent(Ctx.club()) : "") + '" data-cap="vivo" hidden>Transmisión en vivo</a>' +
        '<a href="' + esc(toolsUrl()) + '">Herramientas de juego</a>' +
        '<a href="/preguntas-frecuentes/">Ayuda</a>' +
        '<a href="/privacidad.html">Privacidad</a>' +
      "</div>"
    );
  }
  function toolsUrl() {
    var c = Ctx.get();
    if (!c) return "/herramientas.html";
    return "/herramientas.html?loc=" + encodeURIComponent(c.loc) + (c.can ? "&can=" + encodeURIComponent(c.can) : "");
  }

  var $bar = null;
  function mountTabbar() {
    if (document.querySelector(".pz-tabbar")) { $bar = document.querySelector(".pz-tabbar"); $bar.innerHTML = tabsHTML(); return; }
    $bar = document.createElement("div");
    $bar.className = "pz-tabbar";
    $bar.setAttribute("role", "navigation"); // <nav> no: estilo.css fija todo <nav> arriba
    $bar.setAttribute("aria-label", "Navegación principal");
    $bar.innerHTML = tabsHTML();
    document.body.appendChild($bar);
    document.body.classList.add("pz-app");
    // Páginas sin header de app (boton.html): la barra lateral sube hasta arriba.
    if (!document.querySelector(".site-header")) document.body.classList.add("pz-no-hdr");
    aplicarCaps($bar);
    $bar.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a.pz-tab");
      if (a) track("app_tab_click", { tab: a.dataset.tab });
    });
  }

  // ── Chip de contexto en el header ──
  function chipHTML(c, clubOnly, n) {
    if (!c) return '<span class="pz-ctx-dot"></span><span class="pz-ctx-txt">Elige tu club</span>' + ICON.caret;
    // El club se recorta con "…" si no cabe; la cancha siempre se ve completa.
    return '<span class="pz-ctx-dot"></span><span class="pz-ctx-txt">' + esc(n.club) + "</span>" +
      (clubOnly ? "" : '<span class="pz-ctx-sep">·</span><span class="pz-ctx-can">' + esc(c.can ? n.cancha : "Elige cancha") + "</span>") + ICON.caret;
  }
  function paintChips(chips, c, clubOnly, n) {
    var html = chipHTML(c, clubOnly, n);
    chips.forEach(function (ch) {
      ch.innerHTML = html;
      ch.classList.toggle("is-empty", !c || (!clubOnly && !c.can));
      ch.setAttribute("aria-label", clubOnly ? "Cambiar de club" : "Cambiar club o cancha");
      if (!ch.__pzBound) {
        ch.__pzBound = true;
        ch.addEventListener("click", function (e) { e.preventDefault(); openLocation(); });
      }
    });
  }
  async function renderChip() {
    var chips = document.querySelectorAll("[data-ctx-chip]");
    if (!chips.length) return;
    // (2026-09-30) Pantalla que ya pregunta el club (selector a pantalla
    // completa): el chip no repite "Elige tu club".
    var oculto = !!(document.body && document.body.dataset.pzSelector === "club");
    chips.forEach(function (ch) { ch.style.visibility = oculto ? "hidden" : ""; });
    if (oculto) return;
    var c = Ctx.get();
    var clubOnly = clubLevelPage();
    if (!c) { paintChips(chips, null, clubOnly, null); return; }
    // Primer pintado inmediato con el id; luego el nombre bonito del catálogo.
    paintChips(chips, c, clubOnly, { club: c.loc.replace(/-/g, " "), cancha: c.can ? Ctx.canchaLabel(c.can) : "" });
    paintChips(chips, c, clubOnly, await Ctx.names(c));
  }

  // ── Hoja / popover genérico ──
  var $backdrop = null, $sheet = null, _onClose = null;
  function ensureSheet() {
    if ($sheet) return;
    $backdrop = document.createElement("div");
    $backdrop.className = "pz-sheet-backdrop";
    $backdrop.addEventListener("click", closeSheet);
    $sheet = document.createElement("div");
    $sheet.className = "pz-sheet";
    $sheet.setAttribute("role", "dialog");
    $sheet.setAttribute("aria-modal", "true");
    document.body.appendChild($backdrop);
    document.body.appendChild($sheet);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  }
  function openSheet(kind, html) {
    ensureSheet();
    $sheet.dataset.kind = kind;
    $sheet.innerHTML = '<div class="pz-sheet-grab"></div>' + html;
    requestAnimationFrame(function () {
      $backdrop.classList.add("is-open");
      $sheet.classList.add("is-open");
    });
  }
  function closeSheet() {
    if (!$sheet || !$sheet.classList.contains("is-open")) return;
    $sheet.classList.remove("is-open");
    $backdrop.classList.remove("is-open");
    document.querySelectorAll("[data-ctx-chip]").forEach(function (c) { c.setAttribute("aria-expanded", "false"); });
    if (_onClose) { var f = _onClose; _onClose = null; f(); }
  }

  // ── Selector de club / cancha ──
  function sheetHead(title, sub, withBack) {
    return '<div class="pz-sheet-head">' +
      (withBack ? '<button type="button" class="pz-sheet-back" data-sheet-back aria-label="Volver">' + ICON.back + "</button>" : "") +
      '<div style="flex:1;min-width:0"><div class="pz-sheet-title">' + esc(title) + "</div>" +
      (sub ? '<div class="pz-sheet-sub">' + esc(sub) + "</div>" : "") + "</div>" +
      '<button type="button" class="pz-sheet-x" data-sheet-x aria-label="Cerrar">' + ICON.x + "</button></div>";
  }

  async function openLocation(startClubId) {
    document.querySelectorAll("[data-ctx-chip]").forEach(function (c) { c.setAttribute("aria-expanded", "true"); });
    var cat = { clubs: [] };
    try { cat = await PuntazoClubs.getCatalog(); } catch (e) {}
    var cur = Ctx.get();
    var clubs = (cat.clubs || []).filter(function (c) { return c.status === "active"; });

    var clubOnly = clubLevelPage();
    function showClubs() {
      if (!clubs.length) {
        openSheet("ctx", sheetHead("¿Dónde jugaste?", "") +
          '<div class="pz-sheet-sub" style="text-align:center;padding:18px 0">No pudimos cargar los clubes.</div>' +
          '<button type="button" class="pz-acct-login" data-retry>Reintentar</button>');
        bindSheet();
        $sheet.querySelector("[data-retry]").addEventListener("click", function () {
          try { PuntazoClubs.clearCache(); } catch (e) {}
          openLocation(startClubId);
        });
        return;
      }
      var rows = clubs.map(function (c) {
        var logo = c.logoUrl
          ? '<img class="pz-club-logo" src="' + esc(c.logoUrl) + '" alt="">'
          : '<span class="pz-club-logo">' + esc(c.emoji || "🎾") + "</span>";
        var n = (c.canchas || []).length;
        return '<button type="button" class="pz-club-row' + (cur && cur.loc === c.id ? " is-current" : "") + '" data-club="' + esc(c.id) + '">' +
          logo + '<span><span class="pz-club-name">' + esc(c.nombre) + '</span><br><span class="pz-club-meta">' + n + (n === 1 ? " cancha" : " canchas") + "</span></span>" + ICON.chev + "</button>";
      }).join("");
      openSheet("ctx", sheetHead("¿Dónde jugaste?", "Elige tu club") + '<div class="pz-club-list">' + rows + "</div>");
      bindSheet();
      $sheet.querySelectorAll("[data-club]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (clubOnly) return chooseClub(b.dataset.club);
          showCourts(b.dataset.club);
        });
      });
    }

    function showCourts(clubId) {
      var club = clubs.find(function (c) { return c.id === clubId; });
      if (!club) return showClubs();
      var btns = (club.canchas || []).map(function (can) {
        var isCur = cur && cur.loc === club.id && cur.can === can.id;
        var ic = (window.PuntazoClubs && PuntazoClubs.courtIconUrls) ? PuntazoClubs.courtIconUrls(club.id, can.id) : null;
        var img = ic ? '<img class="pz-court-ico" src="' + esc(ic.clubUrl) + '" data-fallback="' + esc(ic.globalUrl) + '" alt="">' : "";
        return '<button type="button" class="pz-court-btn' + (isCur ? " is-current" : "") + '" data-can="' + esc(can.id) + '">' + img +
          "<span>" + esc(can.nombre || Ctx.canchaLabel(can.id)) + "</span></button>";
      }).join("");
      openSheet("ctx", sheetHead(club.nombre, "Elige tu cancha", true) + '<div class="pz-court-grid">' + btns + "</div>");
      bindSheet(showClubs);
      // Ícono propio del club si existe; si no, el global.
      $sheet.querySelectorAll("img.pz-court-ico").forEach(function (im) {
        im.addEventListener("error", function () { if (im.dataset.fallback && im.src.indexOf(im.dataset.fallback) < 0) im.src = im.dataset.fallback; }, { once: true });
      });
      $sheet.querySelectorAll("[data-can]").forEach(function (b) {
        b.addEventListener("click", function () { choose(club, b.dataset.can); });
      });
    }

    if (clubOnly) showClubs();
    else if (startClubId) showCourts(startClubId);
    else if (cur && clubs.some(function (c) { return c.id === cur.loc; })) showCourts(cur.loc);
    else showClubs();
  }

  function bindSheet(onBack) {
    var x = $sheet.querySelector("[data-sheet-x]");
    if (x) x.addEventListener("click", closeSheet);
    var b = $sheet.querySelector("[data-sheet-back]");
    if (b && onBack) b.addEventListener("click", onBack);
  }

  // Club preferido (Inicio): se guarda en este teléfono y se recarga Inicio.
  // (Clubes con contraseña, ej. Scorpion: la galería de clips pide la clave.)
  function chooseClub(clubId) {
    track("app_club_change", { club: clubId });
    Ctx.setClub(clubId);
    closeSheet();
    var p = (location.pathname || "").toLowerCase();
    if (/vivo\.html/.test(p)) { location.href = "/vivo.html?club=" + encodeURIComponent(clubId); return; }
    if (/herramientas\.html/.test(p)) { location.href = toolsUrl(); return; }
    go("inicio");
  }

  function choose(club, canId) {
    var cancha = (club.canchas || []).find(function (c) { return c.id === canId; }) || {};
    var lado = (cancha.lados && cancha.lados[0] && cancha.lados[0].id) || "LadoA";
    track("app_context_change", { club: club.id, cancha: canId });
    Ctx.set(club.id, canId, lado);
    closeSheet();
    // Las páginas que dependen de la cancha se recargan en la nueva; el resto
    // solo actualiza el chip y la navegación.
    var t = activeTab();
    var p = (location.pathname || "").toLowerCase();
    if (t === "clips") return go("clips");
    if (t === "puntazo") return go("boton");
    if (t === "recuperar") return go("recuperar");
    if (/inicio\.html|entrada\.html/.test(p)) return go("inicio");
    if (/herramientas\.html/.test(p)) { location.href = toolsUrl(); return; }
    if (/vivo\.html/.test(p)) { location.href = "/vivo.html?club=" + encodeURIComponent(club.id); return; }
    refresh();
  }
  function go(dest) { location.href = Ctx.url(dest); }

  // ── Menú de cuenta ──
  var _user = null;
  function initials(u) {
    var parts = String((u && (u.displayName || u.email)) || "").trim().split(/\s+/).filter(Boolean);
    return parts.length ? parts.slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join("") : "P";
  }
  function avatarHTML(u, cls) {
    return u.photoURL
      ? '<img class="' + cls + '" src="' + esc(u.photoURL) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="' + cls + ' pz-acct-ini">' + esc(initials(u)) + "</span>";
  }

  function renderAuth(user) {
    _user = user || null;
    var slot = document.querySelector(".site-header--app [data-auth-slot]");
    if (!slot) return;
    slot.innerHTML = _user
      ? '<button type="button" class="pz-auth-avatar-btn" data-acct-open aria-label="Mi cuenta">' + avatarHTML(_user, "pz-auth-avatar") + "</button>"
      : '<button type="button" class="pz-acct-btn" data-acct-open aria-label="Mi cuenta">' + ICON.user + "</button>";
    slot.querySelector("[data-acct-open]").addEventListener("click", function (e) { e.stopPropagation(); openAccount(); });
  }

  function openAccount() {
    var u = _user;
    var c = Ctx.get();
    var isAdmin = !!(u && window.PuntazoFirebase && PuntazoFirebase.isAdminEmail && PuntazoFirebase.isAdminEmail(u.email));
    var head = u
      ? '<div class="pz-acct-head">' + avatarHTML(u, "") + '<div style="min-width:0"><div class="pz-acct-name">' + esc(u.displayName || "Mi cuenta") + '</div><div class="pz-acct-mail">' + esc(u.email || "") + "</div></div></div>"
      : '<div class="pz-acct-head"><span class="pz-acct-ini">' + ICON.user + '</span><div><div class="pz-acct-name">Invitado</div><div class="pz-acct-mail">Guarda tus clips y encuéntralos después.</div></div></div>' +
        '<button type="button" class="pz-acct-login" data-acct-login>' + ICON.google + "Iniciar sesión / crear cuenta</button>";
    var items = [
      u ? '<a href="/guardados.html"><span class="pz-ico"><span class="pz-i pz-i--mis-clips" aria-hidden="true"></span></span>Mis clips</a>' : "",
      u ? '<a href="/mis-clips.html"><span class="pz-ico"><span class="pz-i pz-i--solicitudes" aria-hidden="true"></span></span>Mis solicitudes del botón</a>' : "",
      '<button type="button" data-acct-ctx><span class="pz-ico"><span class="pz-i pz-i--club-cancha" aria-hidden="true"></span></span>Mi club y cancha' + (c ? "" : "") + "</button>",
      '<a href="' + esc(toolsUrl()) + '"><span class="pz-ico"><span class="pz-i pz-i--marcador" aria-hidden="true"></span></span>Herramientas de juego</a>',
      '<a href="/vivo.html' + (c ? "?club=" + encodeURIComponent(c.loc) : "") + '" data-cap="vivo" hidden><span class="pz-ico"><span class="pz-i pz-i--vivo" aria-hidden="true"></span></span>Transmisión en vivo</a>',
      '<div class="pz-acct-sep"></div>',
      '<a class="pz-muted" href="/preguntas-frecuentes/"><span class="pz-ico"><span class="pz-i pz-i--ayuda" aria-hidden="true"></span></span>Ayuda</a>',
      '<a class="pz-muted" href="/privacidad.html"><span class="pz-ico"><span class="pz-i pz-i--privacidad" aria-hidden="true"></span></span>Privacidad</a>',
      '<a class="pz-muted" href="/para-clubes/"><span class="pz-ico"><span class="pz-i pz-i--para-clubes" aria-hidden="true"></span></span>Para clubes</a>',
      isAdmin ? '<a class="pz-muted" href="/admin.html"><span class="pz-ico"><span class="pz-i pz-i--para-clubes" aria-hidden="true"></span></span>Dashboard admin</a>' : "",
      u ? '<div class="pz-acct-sep"></div><button type="button" data-acct-logout><span class="pz-ico"><span class="pz-i pz-i--cerrar-sesion" aria-hidden="true"></span></span>Cerrar sesión</button>' : ""
    ].join("");
    openSheet("acct", sheetHead(u ? "Mi cuenta" : "Cuenta", "") + head + '<div class="pz-acct-list">' + items + "</div>");
    aplicarCaps($sheet);
    bindSheet();
    var login = $sheet.querySelector("[data-acct-login]");
    if (login) login.addEventListener("click", function () {
      closeSheet();
      if (window.PuntazoAuth && PuntazoAuth.signIn) PuntazoAuth.signIn();
    });
    var out = $sheet.querySelector("[data-acct-logout]");
    if (out) out.addEventListener("click", async function () {
      closeSheet();
      if (window.PuntazoAuth && PuntazoAuth.signOut) await PuntazoAuth.signOut();
    });
    var cb = $sheet.querySelector("[data-acct-ctx]");
    if (cb) cb.addEventListener("click", function () { closeSheet(); setTimeout(function () { openLocation(); }, 60); });
  }

  function refresh() {
    renderChip();
    if ($bar) $bar.innerHTML = tabsHTML();
    if ($bar) aplicarCaps($bar);
  }

  function boot() {
    mountTabbar();
    renderChip();
    var u = window.PuntazoAuth && PuntazoAuth.currentUser;
    if (document.querySelector(".site-header--app")) renderAuth(u || null);
  }

  window.addEventListener("puntazo:context-changed", refresh);
  window.addEventListener("puntazo:header-rendered", function () { renderChip(); renderAuth(_user || (window.PuntazoAuth && PuntazoAuth.currentUser) || null); });
  window.addEventListener("puntazo:auth-changed", function (e) {
    if (document.querySelector(".site-header--app")) renderAuth((e && e.detail && e.detail.user) || null);
  });

  window.PuntazoAppShell = { openLocation: openLocation, openAccount: openAccount, renderAuth: renderAuth, refresh: refresh, closeSheet: closeSheet };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
