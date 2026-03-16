(function () {
  "use strict";

  if (window.__PZ_HEADER_LOADED__) return;
  window.__PZ_HEADER_LOADED__ = true;

  const root = document.getElementById("nav-root");
  if (!root) {
    console.warn("[Puntazo Header] No existe #nav-root");
    return;
  }

  // En páginas específicas (p.ej. explorar.html) puede quedar un <nav>
  // estático heredado del layout antiguo. Para evitar mostrar dos headers,
  // eliminamos ese nav/header estático SOLO en la página de exploración.
  try {
    const pagePath = (window.location.pathname || "").toLowerCase();
    if (pagePath.endsWith("/explorar.html") || pagePath.endsWith("explorar.html")) {
      document.querySelectorAll('nav, header.site-header').forEach(function (n) {
        // no tocar el contenedor compartido `#nav-root`
        if (n.id === 'nav-root') return;
        // si el nodo es anterior al root o no forma parte de él, lo removemos
        if (!n.contains(root) && !root.contains(n)) {
          try { n.remove(); } catch (e) { /* noop */ }
        }
      });
    }
  } catch (e) {
    // no bloquear si falla este cleanup
  }

  root.style.display = "contents";

  const path = (window.location.pathname || "").toLowerCase();
  const variant = root.dataset.navVariant || (
    // index.html is the main landing now
    path.endsWith("/index.html") || path === "/" ? "landing" : "internal"
  );

  injectHeaderStyles();
  renderHeader();
  attachMenuToggle();
  setupCloseMenuHelper();
  setupDropdownOutsideClose();
  bootstrapAuth();

  function injectHeaderStyles() {
    if (document.getElementById("pz-header-auth-styles")) return;

    const style = document.createElement("style");
    style.id = "pz-header-auth-styles";
    style.textContent = `
      .pz-auth-slot{
        display:flex;
        align-items:center;
        justify-content:flex-end;
        min-height:40px;
      }

      .pz-auth-login-btn{
        appearance:none;
        border:none;
        cursor:pointer;
        border-radius:999px;
        padding:0.62rem 1rem;
        font-family:inherit;
        font-size:0.82rem;
        font-weight:800;
        line-height:1;
        color:#eaf2ff;
        background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.14);
        backdrop-filter:blur(16px);
        box-shadow:0 8px 24px rgba(0,0,0,.28);
        transition:all .18s ease;
        white-space:nowrap;
      }

      .pz-auth-login-btn:hover{
        transform:translateY(-1px);
        border-color:rgba(11,124,255,.38);
        background:rgba(0,79,200,.12);
      }

      .pz-auth-menu-wrap{
        position:relative;
        display:flex;
        align-items:center;
      }

      .pz-auth-avatar-btn{
        appearance:none;
        border:none;
        background:transparent;
        padding:0;
        cursor:pointer;
        border-radius:999px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
      }

      .pz-auth-avatar{
        width:38px;
        height:38px;
        border-radius:50%;
        object-fit:cover;
        border:2px solid rgba(255,255,255,.16);
        box-shadow:0 8px 24px rgba(0,0,0,.28);
        background:rgba(255,255,255,.06);
      }

      .pz-auth-dropdown{
        position:absolute;
        top:calc(100% + 10px);
        right:0;
        min-width:220px;
        background:rgba(8,14,28,.94);
        border:1px solid rgba(255,255,255,.10);
        border-radius:16px;
        box-shadow:0 22px 46px rgba(0,0,0,.44);
        backdrop-filter:blur(18px);
        overflow:hidden;
        display:none;
        z-index:1200;
      }

      .pz-auth-dropdown.is-open{
        display:block;
      }

      .pz-auth-dropdown-head{
        padding:12px 14px;
        border-bottom:1px solid rgba(255,255,255,.08);
      }

      .pz-auth-dropdown-name{
        color:#fff;
        font-size:0.9rem;
        font-weight:800;
        line-height:1.35;
      }

      .pz-auth-dropdown-email{
        color:rgba(234,242,255,.58);
        font-size:0.78rem;
        margin-top:3px;
        line-height:1.4;
        word-break:break-word;
      }

      .pz-auth-dropdown a,
      .pz-auth-dropdown button{
        width:100%;
        border:none;
        background:transparent;
        color:#eaf2ff;
        text-decoration:none;
        text-align:left;
        padding:12px 14px;
        font:inherit;
        font-size:0.88rem;
        font-weight:700;
        cursor:pointer;
        display:block;
      }

      .pz-auth-dropdown a:hover,
      .pz-auth-dropdown button:hover{
        background:rgba(255,255,255,.06);
      }

      .pz-auth-slot--landing{
        margin-left:10px;
      }

      .pz-nav-right--internal{
        position:absolute;
        right:56px;
        top:50%;
        transform:translateY(-50%);
        z-index:20;
        display:flex;
        align-items:center;
        gap:.7rem;
      }

      .pz-phone-cta{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-height:42px;
        padding:.72rem 1rem;
        border-radius:999px;
        text-decoration:none;
        font-weight:800;
        font-size:.84rem;
        line-height:1;
        color:#fff;
        white-space:nowrap;
        background:rgba(255,255,255,.05);
        border:1px solid rgba(255,255,255,.12);
        box-shadow:0 8px 24px rgba(0,0,0,.16);
        transition:transform .18s ease, background .18s ease, border-color .18s ease;
      }

      .pz-phone-cta:hover{
        transform:translateY(-1px);
        background:rgba(0,79,200,.14);
        border-color:rgba(11,124,255,.40);
      }

      .pz-nav-right{
        display:flex;
        align-items:center;
        gap:.7rem;
      }

      @media (max-width: 860px){
        .pz-phone-cta{
          font-size:.8rem;
          padding:.68rem .9rem;
        }
      }

      @media (max-width: 640px){
        .pz-phone-cta{
          display:none;
        }
      }

      .site-header{
        position:relative;
      }

      @media (max-width: 860px){
        .pz-nav-right--internal{
          right:52px;
        }

        .pz-auth-login-btn{
          padding:0.55rem 0.85rem;
          font-size:0.76rem;
        }

        .pz-auth-avatar{
          width:34px;
          height:34px;
        }

        .pz-auth-dropdown{
          right:-8px;
          min-width:210px;
        }
      }

      @media (max-width: 560px){
        .pz-auth-slot--landing .pz-auth-login-btn{
          padding:0.5rem 0.78rem;
          font-size:0.74rem;
        }

        .pz-auth-slot--landing{
          margin-left:8px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function isExplorerPage() {
    const path = (window.location.pathname || "").toLowerCase();
    return path.endsWith("/index.html") || path.endsWith("/explorar.html");
  }

  function getPhoneButtonCTA() {
    if (!isExplorerPage()) return "";
    return `
      <a
        href="https://puntazoclips.com/boton.html"
        target="_blank"
        rel="noopener"
        class="pz-phone-cta"
        onclick="try{gtag('event','registrar_puntazo_vivo_click',{event_category:'CTA',event_label:'header_phone_button'});}catch(e){}"
      >📲 Usar teléfono como botón</a>
    `;
  }

  function renderHeader() {
    if (variant === "landing") {
      root.innerHTML = `
        <nav>
          <a href="index.html" class="nav-logo">
            <img src="/assets/logo.png" alt="Puntazo" onerror="this.style.display='none'">
          </a>
          <ul class="nav-links" id="nav-menu">
            <li><a href="index.html#producto" onclick="closeMenu()">Producto</a></li>
            <li><a href="index.html#vision" onclick="closeMenu()">Visión</a></li>
            <li><a href="index.html#clubs" onclick="closeMenu()">Para clubs</a></li>
            <li><a href="index.html#locaciones" onclick="closeMenu()">Locaciones</a></li>
            <li><a href="mejores.html" onclick="closeMenu()">Puntazos del mes</a></li>
          </ul>
          <div class="pz-nav-right">
            ${getPhoneButtonCTA()}
            <div class="pz-auth-slot pz-auth-slot--landing" data-auth-slot></div>
            <button class="menu-toggle" id="menu-toggle" aria-label="Abrir menú">☰</button>
          </div>
        </nav>
      `;
      return;
    }

    root.innerHTML = `
      <header class="site-header">
        <a href="index.html" class="logo-link">
          <img src="assets/logo.png" alt="Puntazo" onerror="this.style.display='none'">
        </a>
        <button id="menu-toggle" class="menu-toggle" aria-label="Abrir menú">☰</button>
        <nav class="navbar" id="nav-menu">
          <a href="index.html">Inicio</a>
          <a href="index.html#clubs">Para clubs</a>
          <a href="mejores.html" class="top-month-nav-btn">🏆 Puntazos del mes</a>
        </nav>
        <div class="pz-nav-right pz-nav-right--internal">
          ${getPhoneButtonCTA()}
          <div class="pz-auth-slot" data-auth-slot></div>
        </div>
      </header>
    `;
  }

  function setupCloseMenuHelper() {
    window.closeMenu = function () {
      const landingMenu = document.getElementById("nav-menu");
      if (landingMenu) landingMenu.classList.remove("show");

      const internalMenu = document.querySelector(".navbar");
      if (internalMenu) internalMenu.classList.remove("show");
    };
  }

  function attachMenuToggle(){
    try{
      const btn = document.querySelector('.menu-toggle');
      const nav = document.querySelector('.navbar') || document.getElementById('nav-menu');
      if (!btn || !nav) return;
      if (btn.__pz_toggle_attached) return;
      btn.__pz_toggle_attached = true;

      btn.addEventListener('click', function(e){
        e.stopPropagation();
        nav.classList.toggle('show');
      });

      document.addEventListener('click', function(e){
        if (nav.classList.contains('show') && !nav.contains(e.target) && e.target !== btn) {
          nav.classList.remove('show');
        }
      });

      window.addEventListener('scroll', function(){ if (nav.classList.contains('show')) nav.classList.remove('show'); });
    }catch(err){/* noop */}
  }

  function setupDropdownOutsideClose() {
    document.addEventListener("click", function (e) {
      document.querySelectorAll(".pz-auth-dropdown.is-open").forEach(function (menu) {
        if (!menu.parentElement.contains(e.target)) {
          menu.classList.remove("is-open");
        }
      });
    });

    window.addEventListener("scroll", function () {
      document.querySelectorAll(".pz-auth-dropdown.is-open").forEach(function (menu) {
        menu.classList.remove("is-open");
      });
    });
  }

  function escapeHTML(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initialsFromUser(user) {
    const base = (user && (user.displayName || user.email || "")) || "";
    const parts = String(base).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "P";
    return parts.slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join("");
  }

  window.updateNavUI = function (user) {
    const slot = document.querySelector("[data-auth-slot]");
    if (!slot) return;

    if (!user) {
      slot.innerHTML = `
        <button type="button" class="pz-auth-login-btn" data-auth-login>
          Iniciar sesión
        </button>
      `;

      const btn = slot.querySelector("[data-auth-login]");
      if (btn) {
        btn.addEventListener("click", function () {
          if (window.PuntazoAuth && typeof window.PuntazoAuth.signIn === "function") {
            window.PuntazoAuth.signIn();
          }
        });
      }
      return;
    }

    const safeName = escapeHTML(user.displayName || "Mi perfil");
    const safeEmail = escapeHTML(user.email || "");
    const avatar = user.photoURL
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
      </div>
    `;

    const avatarBtn = slot.querySelector("[data-auth-avatar]");
    const dropdown = slot.querySelector("[data-auth-dropdown]");
    const logoutBtn = slot.querySelector("[data-auth-logout]");

    if (avatarBtn && dropdown) {
      avatarBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        document.querySelectorAll(".pz-auth-dropdown.is-open").forEach(function (menu) {
          if (menu !== dropdown) menu.classList.remove("is-open");
        });
        dropdown.classList.toggle("is-open");
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async function () {
        dropdown.classList.remove("is-open");
        if (window.PuntazoAuth && typeof window.PuntazoAuth.signOut === "function") {
          await window.PuntazoAuth.signOut();
        }
      });
    }
  };

  async function bootstrapAuth() {
    try {
      await ensureScript("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js", function () {
        return !!window.firebase;
      });

      await ensureScript("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js", function () {
        return !!(window.firebase && typeof firebase.firestore === "function");
      });

      await ensureScript("https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js", function () {
        return !!(window.firebase && typeof firebase.auth === "function");
      });

      await ensureScript("/assets/firebase-core.js", function () {
        return !!(window.PuntazoFirebase && typeof window.PuntazoFirebase.ensureApp === "function");
      });

      await ensureScript("/assets/auth.js", function () {
        return !!window.PuntazoAuth;
      });

      if (window.PuntazoAuth && typeof window.PuntazoAuth.init === "function") {
        await window.PuntazoAuth.init();
      }
      attachAuthGuard();
    } catch (err) {
      console.error("[Puntazo Header] Error cargando auth:", err);
    }
  }

  function attachAuthGuard() {
    document.addEventListener('click', function (e) {
      try {
        const a = e.target.closest && e.target.closest('a[data-auth-only]');
        if (!a) return;
        // if user is authenticated, allow navigation
        const user = (window.PuntazoAuth && window.PuntazoAuth.currentUser) || (window.firebase && window.firebase.auth && window.firebase.auth().currentUser);
        if (user) return;
        // not authenticated -> prevent navigation and open sign-in flow
        e.preventDefault();
        if (window.PuntazoAuth && typeof window.PuntazoAuth.signIn === 'function') {
          window.PuntazoAuth.signIn();
        }
      } catch (err) {
        // noop
      }
    }, false);
  }

  function ensureScript(src, readyCheck) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof readyCheck === "function" && readyCheck()) {
          resolve();
          return;
        }

        const existing = Array.from(document.scripts).find(function (s) {
          return s.src && s.src.indexOf(src) !== -1;
        });

        if (existing) {
          waitUntilReady(readyCheck, resolve, reject);
          return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = function () {
          waitUntilReady(readyCheck, resolve, reject);
        };
        script.onerror = function () {
          reject(new Error("No se pudo cargar " + src));
        };
        document.head.appendChild(script);
      } catch (err) {
        reject(err);
      }
    });
  }

  function waitUntilReady(readyCheck, resolve, reject) {
    const started = Date.now();

    (function poll() {
      if (!readyCheck || readyCheck()) {
        resolve();
        return;
      }

      if (Date.now() - started > 12000) {
        reject(new Error("Timeout esperando dependencia"));
        return;
      }

      setTimeout(poll, 80);
    })();
  }
})();
