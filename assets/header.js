(function () {
  "use strict";

  if (window.__PZ_HEADER_LOADED__) return;
  window.__PZ_HEADER_LOADED__ = true;

  // F101: si header.js se carga en <head> antes de que exista #nav-root
  // en el body, diferimos hasta DOMContentLoaded. Sin esto, las páginas
  // nuevas (grupos, amigos, mi-nivel, detalle, etc) cargaban sin header.
  if (!document.getElementById("nav-root") && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootHeader);
    return;
  }
  bootHeader();

  function bootHeader() {
  const root = document.getElementById("nav-root");
  if (!root) { console.warn("[Puntazo Header] No existe #nav-root"); return; }

  // Limpiar nav estático heredado en páginas específicas
  try {
    const pagePath = (window.location.pathname || "").toLowerCase();
    if (pagePath.endsWith("/explorar.html") || pagePath.endsWith("explorar.html")) {
      document.querySelectorAll("nav, header.site-header").forEach(function (n) {
        if (n.id === "nav-root") return;
        if (!n.contains(root) && !root.contains(n)) {
          try { n.remove(); } catch (e) {}
        }
      });
    }
  } catch (e) {}

  root.style.display = "contents";

  const path    = (window.location.pathname || "").toLowerCase();
  const variant = root.dataset.navVariant || (
    path.endsWith("/landing.html") || path === "/" ? "landing" : "internal"
  );

  injectHeaderStyles();
  renderHeader();
  setupMenuToggle();
  setupCloseMenuHelper();
  setupDropdownOutsideClose();
  bootstrapAuth();

  // ── Estilos ──────────────────────────────────────────────────
  function injectHeaderStyles() {
    if (document.getElementById("pz-header-auth-styles")) return;
    const style = document.createElement("style");
    style.id = "pz-header-auth-styles";
    style.textContent = `
      .pz-auth-slot{display:flex;align-items:center;justify-content:flex-end;min-height:40px;}
      .pz-auth-login-btn{appearance:none;border:none;cursor:pointer;border-radius:999px;padding:0.62rem 1rem;font-family:inherit;font-size:0.82rem;font-weight:800;line-height:1;color:#eaf2ff;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);backdrop-filter:blur(16px);box-shadow:0 8px 24px rgba(0,0,0,.28);transition:all .18s ease;white-space:nowrap;}
      .pz-auth-login-btn:hover{transform:translateY(-1px);border-color:rgba(11,124,255,.38);background:rgba(0,79,200,.12);}
      .pz-auth-menu-wrap{position:relative;display:flex;align-items:center;}
      .pz-auth-avatar-btn{appearance:none;border:none;background:transparent;padding:0;cursor:pointer;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;}
      .pz-auth-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.16);box-shadow:0 8px 24px rgba(0,0,0,.28);background:rgba(255,255,255,.06);}
      .pz-auth-dropdown{position:absolute;top:calc(100% + 10px);right:0;min-width:220px;background:rgba(8,14,28,.94);border:1px solid rgba(255,255,255,.10);border-radius:16px;box-shadow:0 22px 46px rgba(0,0,0,.44);backdrop-filter:blur(18px);overflow:hidden;display:none;z-index:1200;}
      .pz-auth-dropdown.is-open{display:block;}
      .pz-auth-dropdown-head{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08);}
      .pz-auth-dropdown-name{color:#fff;font-size:0.9rem;font-weight:800;line-height:1.35;}
      .pz-auth-dropdown-email{color:rgba(234,242,255,.58);font-size:0.78rem;margin-top:3px;line-height:1.4;word-break:break-word;}
      .pz-auth-dropdown a,.pz-auth-dropdown button{width:100%;border:none;background:transparent;color:#eaf2ff;text-decoration:none;text-align:left;padding:12px 14px;font:inherit;font-size:0.88rem;font-weight:700;cursor:pointer;display:block;}
      .pz-auth-dropdown a:hover,.pz-auth-dropdown button:hover{background:rgba(255,255,255,.06);}
      .pz-auth-slot--landing{margin-left:6px;}

      /* ── Nav derecho (internal) ── */
      .pz-nav-right--internal{position:absolute;right:56px;top:50%;transform:translateY(-50%);z-index:20;display:flex;align-items:center;gap:.6rem;}

      /* ── CTA: Encuentra tus clips (azul) ── */
      .pz-clips-cta{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:.6rem 1rem;border-radius:999px;text-decoration:none;font-weight:800;font-size:.82rem;line-height:1;color:#fff;white-space:nowrap;background:linear-gradient(135deg,#0B7CFF,#004FC8);border:1px solid rgba(11,124,255,.55);box-shadow:0 0 20px rgba(0,79,200,.25),0 6px 18px rgba(0,0,0,.18);transition:all .18s ease;}
      .pz-clips-cta:hover{transform:translateY(-1px);box-shadow:0 0 28px rgba(11,124,255,.35),0 8px 22px rgba(0,0,0,.22);}

      /* ── Phone CTA ── */
      .pz-phone-cta{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:.62rem 1rem;border-radius:999px;text-decoration:none;font-weight:800;font-size:.82rem;line-height:1;color:#fff;white-space:nowrap;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 24px rgba(0,0,0,.16);transition:transform .18s ease,background .18s ease,border-color .18s ease;}
      .pz-phone-cta:hover{transform:translateY(-1px);background:rgba(0,79,200,.14);border-color:rgba(11,124,255,.40);}

      .pz-nav-right{display:flex;align-items:center;gap:.6rem;}
      .site-header{position:relative;}

      /* ── F121: variant "embedded" para modos de juego inmersivos
         (torneo5, king, americano). Mismo logo + auth pero SIN
         nav links/CTAs. Back button explícito con destino dinámico. ── */
      .site-header--embedded{
        padding:0.7rem 16px;
        min-height:52px;
        gap:10px;
        z-index:4500; /* debajo del FAB Puntazo (z-index 5000) */
      }
      .site-header--embedded .logo-link img{height:26px;}
      .pz-back-btn{
        appearance:none;border:none;background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.10);
        width:38px;height:38px;border-radius:999px;cursor:pointer;
        display:inline-flex;align-items:center;justify-content:center;
        color:#eaf2ff;text-decoration:none;flex-shrink:0;
        transition:background .15s, border-color .15s, transform .12s;
      }
      .pz-back-btn:hover{background:rgba(11,124,255,0.18);border-color:rgba(11,124,255,0.45);}
      .pz-back-btn:active{transform:scale(0.94);}
      .pz-back-btn svg{display:block;}
      .pz-nav-right--embedded{display:flex;align-items:center;gap:.6rem;}

      @media(max-width:860px){
        .pz-nav-right--internal{right:52px;}
        .pz-auth-login-btn{padding:0.55rem 0.85rem;font-size:0.76rem;}
        .pz-auth-avatar{width:34px;height:34px;}
        .pz-auth-dropdown{right:-8px;min-width:210px;}
        .pz-phone-cta,.pz-clips-cta{font-size:.78rem;padding:.58rem .88rem;}
        .site-header--embedded{padding:0.62rem 12px;}
        .pz-back-btn{width:36px;height:36px;}
      }
      @media(max-width:640px){
        .pz-phone-cta{display:none;}
      }
      @media(max-width:480px){
        .pz-clips-cta .cta-label{display:none;}
      }
    `;
    document.head.appendChild(style);
  }

  // ── CTAs compartidos ─────────────────────────────────────────
  function getPhoneButtonCTA() {
    // Mostrar en todas las páginas internas (antes solo en explorar)
    if (variant !== "internal" && variant !== "landing") return "";
    return `
      <a href="/entrada.html?modo=boton" target="_blank" rel="noopener"
         class="pz-phone-cta"
         onclick="try{gtag('event','registrar_puntazo_vivo_click',{event_category:'CTA',event_label:'header_phone_button'});}catch(e){}">
        📲 Solo registrar puntazos
      </a>`;
  }

  function getClipsCTA() {
    return `
      <a href="/entrada.html" class="pz-clips-cta"
         onclick="try{gtag('event','encuentra_tus_clips_click',{event_category:'CTA',event_label:'header_jugar'});}catch(e){}">
        ▶ <span class="cta-label">Jugar</span>
      </a>`;
  }

  // ── Render ───────────────────────────────────────────────────
  // Toggle del burger: definido como global ANTES de renderizar, así el
  // onclick="window.toggleNavMenu()" del botón burger funciona desde el
  // primer click sin esperar listeners attachados async.
  window.toggleNavMenu = function (ev) {
    if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
    const nav = document.getElementById("nav-menu")
              || document.querySelector(".nav-links")
              || document.querySelector(".navbar");
    if (!nav) return;
    nav.classList.toggle("show");
  };

  function renderHeader() {
    if (variant === "landing") {
      root.innerHTML = `
        <nav>
          <a href="/" class="nav-logo">
            <img src="/assets/img/P_blanca_transparente.png" alt="Puntazo" onerror="this.style.display='none'">
          </a>
          <ul class="nav-links" id="nav-menu">
            <li><a href="/#producto"    onclick="closeMenu()">Producto</a></li>
            <li><a href="/#vision"      onclick="closeMenu()">Visión</a></li>
            <li><a href="/#clubs"       onclick="closeMenu()">Para clubs</a></li>
            <li><a href="/#locaciones"  onclick="closeMenu()">Locaciones</a></li>
          </ul>
          <div class="pz-nav-right">
            ${getPhoneButtonCTA()}
            ${getClipsCTA()}
            <div class="pz-auth-slot pz-auth-slot--landing" data-auth-slot></div>
            <button class="menu-toggle" id="menu-toggle" type="button" aria-label="Abrir menú" onclick="window.toggleNavMenu(event)">☰</button>
          </div>
        </nav>`;
      try { window.dispatchEvent(new CustomEvent("puntazo:header-rendered")); } catch {}
      return;
    }

    // F121: variant "embedded" — para modos de juego inmersivos
    // (torneo5, futuros king/americano cloud-sync). Misma identidad
    // visual (logo + auth + glassmorphism) pero sin nav links/CTAs
    // que distraigan del modo de juego. Back button explícito con
    // destino dinámico via data-back-to.
    if (variant === "embedded") {
      const backTo = root.dataset.backTo || "/herramientas.html";
      root.innerHTML = `
        <header class="site-header site-header--embedded">
          <a href="${escapeHTML(backTo)}" class="pz-back-btn" data-back aria-label="Salir">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
          <a href="/" class="logo-link">
            <img src="/assets/img/P_blanca_transparente.png" alt="Puntazo" onerror="this.style.display='none'">
          </a>
          <div class="pz-nav-right pz-nav-right--embedded">
            <div class="pz-auth-slot" data-auth-slot></div>
          </div>
        </header>`;
      // Back button: emite evento cancelable antes de navegar para que la
      // página (ej. torneo5) pueda confirmar "¿salir?" si hay progreso.
      const backBtn = root.querySelector("[data-back]");
      if (backBtn) {
        backBtn.addEventListener("click", function (e) {
          const target = backBtn.getAttribute("href");
          const evt = new CustomEvent("puntazo:before-back", {
            cancelable: true,
            detail: { to: target },
          });
          const proceed = window.dispatchEvent(evt);
          if (!proceed) { e.preventDefault(); return; }
          // Default: dejar que el browser navegue.
        });
      }
      try { window.dispatchEvent(new CustomEvent("puntazo:header-rendered")); } catch {}
      return;
    }

    // Internal
    root.innerHTML = `
      <header class="site-header">
        <a href="/" class="logo-link">
          <img src="/assets/img/P_blanca_transparente.png" alt="Puntazo" onerror="this.style.display='none'">
        </a>
        <button id="menu-toggle" class="menu-toggle" type="button" aria-label="Abrir menú" onclick="window.toggleNavMenu(event)">☰</button>
        <nav class="navbar" id="nav-menu">
          <a href="/">Inicio</a>
          <a href="/#clubs">Para clubs</a>
        </nav>
        <div class="pz-nav-right pz-nav-right--internal">
          ${getPhoneButtonCTA()}
          ${getClipsCTA()}
          <div class="pz-auth-slot" data-auth-slot></div>
        </div>
      </header>`;
    try { window.dispatchEvent(new CustomEvent("puntazo:header-rendered")); } catch {}
  }

  function setupCloseMenuHelper() {
    window.closeMenu = function () {
      document.getElementById("nav-menu")?.classList.remove("show");
      document.querySelector(".navbar")?.classList.remove("show");
      document.querySelector(".nav-links")?.classList.remove("show");
    };
  }

  // Fix burger definitivo: event delegation en document. Sin importar cuándo
  // se renderiza el header o cuándo se monta el botón, el delegated handler
  // captura cualquier click en .menu-toggle / #menu-toggle.
  function setupMenuToggle() {
    const getNav = () => document.getElementById("nav-menu")
                       || document.querySelector(".nav-links")
                       || document.querySelector(".navbar");

    // Toggle del burger (delegated, sobrevive a cualquier re-render)
    document.addEventListener("click", function (e) {
      const btn = e.target && e.target.closest && e.target.closest(".menu-toggle, #menu-toggle");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const nav = getNav();
        if (nav) nav.classList.toggle("show");
        return;
      }
      // Cerrar si está abierto y el click fue fuera del nav
      const nav = getNav();
      if (!nav || !nav.classList.contains("show")) return;
      if (nav.contains(e.target)) return;
      nav.classList.remove("show");
    }, true); // capture phase: gana sobre cualquier handler stopPropagation interno

    // Cerrar al hacer scroll
    window.addEventListener("scroll", function () {
      const nav = getNav();
      if (nav && nav.classList.contains("show")) nav.classList.remove("show");
    }, { passive: true });
  }

  function setupDropdownOutsideClose() {
    document.addEventListener("click", function (e) {
      document.querySelectorAll(".pz-auth-dropdown.is-open").forEach(function (menu) {
        if (!menu.parentElement.contains(e.target)) menu.classList.remove("is-open");
      });
    });
    window.addEventListener("scroll", function () {
      document.querySelectorAll(".pz-auth-dropdown.is-open").forEach(m => m.classList.remove("is-open"));
    });
  }

  function escapeHTML(str) {
    return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function initialsFromUser(user) {
    const base  = (user && (user.displayName || user.email || "")) || "";
    const parts = String(base).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "P";
    return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join("");
  }

  window.updateNavUI = function (user) {
    const slot = document.querySelector("[data-auth-slot]");
    if (!slot) return;

    if (!user) {
      slot.innerHTML = `<button type="button" class="pz-auth-login-btn" data-auth-login>Iniciar sesión</button>`;
      const btn = slot.querySelector("[data-auth-login]");
      if (btn) btn.addEventListener("click", function () {
        if (window.PuntazoAuth && typeof window.PuntazoAuth.signIn === "function") window.PuntazoAuth.signIn();
      });
      return;
    }

    const safeName  = escapeHTML(user.displayName || "Mi perfil");
    const safeEmail = escapeHTML(user.email || "");
    const avatar    = user.photoURL
      ? `<img class="pz-auth-avatar" src="${user.photoURL}" alt="${safeName}">`
      : `<div class="pz-auth-avatar" style="display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;">${initialsFromUser(user)}</div>`;

    slot.innerHTML = `
      <div class="pz-auth-menu-wrap">
        <button type="button" class="pz-auth-avatar-btn" data-auth-avatar aria-label="Abrir menú de perfil">
          ${avatar}
        </button>
        <div class="pz-auth-dropdown" data-auth-dropdown>
          <div class="pz-auth-dropdown-head">
            <div class="pz-auth-dropdown-name">${safeName}</div>
            <div class="pz-auth-dropdown-email">${safeEmail}</div>
          </div>
          <a href="perfil.html">Mi perfil</a>
          <button type="button" data-auth-logout>Cerrar sesión</button>
        </div>
      </div>`;

    const avatarBtn = slot.querySelector("[data-auth-avatar]");
    const dropdown  = slot.querySelector("[data-auth-dropdown]");
    const logoutBtn = slot.querySelector("[data-auth-logout]");

    if (avatarBtn && dropdown) {
      avatarBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        document.querySelectorAll(".pz-auth-dropdown.is-open").forEach(m => { if (m !== dropdown) m.classList.remove("is-open"); });
        dropdown.classList.toggle("is-open");
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async function () {
        dropdown.classList.remove("is-open");
        if (window.PuntazoAuth && typeof window.PuntazoAuth.signOut === "function") await window.PuntazoAuth.signOut();
      });
    }
  };

  // ── Auth bootstrap ──────────────────────────────────────────
  async function bootstrapAuth() {
    try {
      await ensureScript("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",       () => !!window.firebase);
      await ensureScript("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js", () => !!(window.firebase && typeof firebase.firestore === "function"));
      await ensureScript("https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",      () => !!(window.firebase && typeof firebase.auth === "function"));
      await ensureScript("/assets/firebase-core.js", () => !!(window.PuntazoFirebase && typeof window.PuntazoFirebase.ensureApp === "function"));
      await ensureScript("/assets/auth.js",          () => !!window.PuntazoAuth);
      if (window.PuntazoAuth && typeof window.PuntazoAuth.init === "function") await window.PuntazoAuth.init();
      attachAuthGuard();
      // F105 Issues 7+8: banner "Tienes partido activo" en todas las páginas
      checkActiveMatchBanner();
      window.addEventListener("puntazo:auth-changed", checkActiveMatchBanner);
    } catch (err) {
      console.error("[Puntazo Header] Error cargando auth:", err);
    }
  }

  // F105: chequea match active del user y muestra banner persistente.
  // Se ejecuta tras bootstrapAuth, y cada vez que cambia el user.
  let _activeBannerEl = null;
  let _activeBannerLastMatchId = null;
  async function checkActiveMatchBanner() {
    const u = window.PuntazoAuth && window.PuntazoAuth.currentUser;
    if (!u) { hideActiveBanner(); return; }
    // No mostrar el banner si ya estás DENTRO del partido activo
    const path = (window.location.pathname || "").toLowerCase();
    if (path.endsWith("/mi-partido.html") || path.endsWith("mi-partido.html")) {
      hideActiveBanner();
      return;
    }
    try {
      if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function") return;
      const snap = await window.PuntazoFirebase.db()
        .collection("matches")
        .where("userId", "==", u.uid)
        .where("status", "==", "active")
        .orderBy("startedAt", "desc")
        .limit(1)
        .get();
      if (snap.empty) { hideActiveBanner(); return; }
      const doc = snap.docs[0];
      showActiveBanner(doc.id, doc.data());
    } catch (e) {
      // failed-precondition probable (índice). No bloquear UI.
      console.warn("[Puntazo Header] active match check fallo:", e && e.code ? e.code : e);
    }
  }
  function showActiveBanner(matchId, data) {
    if (_activeBannerLastMatchId === matchId && _activeBannerEl) return;
    _activeBannerLastMatchId = matchId;
    hideActiveBanner();
    const b = document.createElement("a");
    b.id = "pz-active-banner";
    b.href = "/mi-partido.html?matchId=" + encodeURIComponent(matchId);
    b.innerHTML = '<span class="pz-active-banner-dot"></span>' +
      '<span class="pz-active-banner-text">Tienes un partido en curso</span>' +
      '<span class="pz-active-banner-arrow">Volver al partido →</span>';
    // Inyectar styles una sola vez
    if (!document.getElementById("pz-active-banner-styles")) {
      const s = document.createElement("style");
      s.id = "pz-active-banner-styles";
      s.textContent = `
        #pz-active-banner {
          position: fixed; top: 0; left: 0; right: 0; z-index: 9500;
          display: flex; align-items: center; justify-content: center;
          gap: 12px; padding: 9px 18px;
          background: linear-gradient(90deg, rgba(34,197,94,0.94), rgba(22,163,74,0.94));
          color: #fff; font-family: 'Montserrat', sans-serif;
          font-size: 0.84rem; font-weight: 800;
          text-decoration: none;
          box-shadow: 0 4px 16px rgba(0,0,0,0.30);
          backdrop-filter: blur(8px);
        }
        #pz-active-banner:hover { filter: brightness(1.08); }
        .pz-active-banner-dot {
          width: 9px; height: 9px; border-radius: 50%;
          background: #fff;
          box-shadow: 0 0 8px rgba(255,255,255,0.95);
          animation: pz-active-pulse 1.5s infinite;
        }
        @keyframes pz-active-pulse { 0%,100% { opacity:1 } 50% { opacity: 0.45 } }
        .pz-active-banner-arrow { opacity: 0.92; font-weight: 700; }
        @media (max-width: 480px) {
          .pz-active-banner-text { display: none; }
        }
        body { padding-top: 40px; }
      `;
      document.head.appendChild(s);
    }
    document.body.appendChild(b);
    _activeBannerEl = b;
  }
  function hideActiveBanner() {
    if (_activeBannerEl) { try { _activeBannerEl.remove(); } catch (_) {} _activeBannerEl = null; }
    _activeBannerLastMatchId = null;
    // remove body padding-top regla (sólo si inyectamos)
    const s = document.getElementById("pz-active-banner-styles");
    if (s) { try { s.remove(); } catch (_) {} }
  }

  function attachAuthGuard() {
    document.addEventListener("click", function (e) {
      try {
        const a = e.target.closest && e.target.closest("a[data-auth-only]");
        if (!a) return;
        const user = (window.PuntazoAuth && window.PuntazoAuth.currentUser) ||
          (window.firebase && window.firebase.auth && window.firebase.auth().currentUser);
        if (user) return;
        e.preventDefault();
        if (window.PuntazoAuth && typeof window.PuntazoAuth.signIn === "function") window.PuntazoAuth.signIn();
      } catch {}
    }, false);
  }

  function ensureScript(src, readyCheck) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof readyCheck === "function" && readyCheck()) { resolve(); return; }
        const existing = Array.from(document.scripts).find(s => s.src && s.src.indexOf(src) !== -1);
        if (existing) { waitUntilReady(readyCheck, resolve, reject); return; }
        const script  = document.createElement("script");
        script.src    = src; script.async = true;
        script.onload = () => waitUntilReady(readyCheck, resolve, reject);
        script.onerror = () => reject(new Error("No se pudo cargar " + src));
        document.head.appendChild(script);
      } catch (err) { reject(err); }
    });
  }

  function waitUntilReady(readyCheck, resolve, reject) {
    const started = Date.now();
    (function poll() {
      if (!readyCheck || readyCheck()) { resolve(); return; }
      if (Date.now() - started > 12000) { reject(new Error("Timeout")); return; }
      setTimeout(poll, 80);
    })();
  }
  } // end bootHeader (F101)
})();
