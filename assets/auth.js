(function () {
  "use strict";

  if (window.PuntazoAuth) return;

  const state = {
    auth: null,
    currentUser: null,
    pendingAction: null,
    modalEl: null,
    isBootstrapped: false
  };

  function injectAuthStyles() {
    if (document.getElementById("pz-auth-styles")) return;

    const style = document.createElement("style");
    style.id = "pz-auth-styles";
    style.textContent = `
      .pz-auth-modal-backdrop{
        position:fixed;
        inset:0;
        z-index:9999;
        display:none;
        align-items:center;
        justify-content:center;
        padding:20px;
        background:rgba(2,6,14,0.72);
        backdrop-filter:blur(10px);
      }

      .pz-auth-modal-backdrop.is-open{
        display:flex;
      }

      .pz-auth-modal{
        width:min(100%, 420px);
        background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.12);
        border-radius:20px;
        box-shadow:0 24px 60px rgba(0,0,0,0.50);
        backdrop-filter:blur(16px);
        color:#eaf2ff;
        padding:22px 22px 20px;
        position:relative;
      }

      .pz-auth-close{
        position:absolute;
        top:12px;
        right:12px;
        width:36px;
        height:36px;
        border:none;
        border-radius:999px;
        background:rgba(255,255,255,0.06);
        color:#eaf2ff;
        cursor:pointer;
        font-size:20px;
        line-height:1;
      }

      .pz-auth-close:hover{
        background:rgba(255,255,255,0.10);
      }

      .pz-auth-modal h3{
        margin:0 0 10px;
        font-size:1.15rem;
        font-weight:900;
        letter-spacing:-0.2px;
        color:#fff;
      }

      .pz-auth-modal p{
        margin:0;
        color:rgba(234,242,255,.72);
        line-height:1.65;
        font-size:0.93rem;
      }

      .pz-auth-modal-note{
        margin-top:10px !important;
        color:rgba(234,242,255,.58) !important;
        font-size:0.84rem !important;
      }

      .pz-auth-error{
        display:none;
        margin-top:12px;
        padding:10px 12px;
        border-radius:12px;
        background:rgba(255,80,80,.10);
        border:1px solid rgba(255,80,80,.22);
        color:#ffd5d5;
        font-size:0.84rem;
        line-height:1.5;
      }

      .pz-auth-error.is-visible{
        display:block;
      }

      .pz-auth-actions{
        margin-top:18px;
        display:flex;
        gap:10px;
        flex-direction:column;
      }

      .pz-google-btn{
        width:100%;
        min-height:50px;
        border:none;
        border-radius:999px;
        cursor:pointer;
        font-weight:800;
        font-size:0.95rem;
        color:#09111f;
        background:#fff;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:10px;
        box-shadow:0 10px 28px rgba(0,0,0,.35);
        transition:transform .18s ease, box-shadow .18s ease, opacity .18s ease;
      }

      .pz-google-btn:hover{
        transform:translateY(-1px);
        box-shadow:0 14px 32px rgba(0,0,0,.40);
      }

      .pz-google-btn[disabled]{
        opacity:.75;
        cursor:wait;
        transform:none;
      }

      .pz-google-btn svg{
        width:18px;
        height:18px;
        flex-shrink:0;
      }

      .pz-auth-cancel{
        width:100%;
        min-height:44px;
        border:none;
        border-radius:999px;
        cursor:pointer;
        font-weight:700;
        font-size:0.9rem;
        color:#eaf2ff;
        background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.12);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    injectAuthStyles();

    if (state.modalEl) return state.modalEl;

    const backdrop = document.createElement("div");
    backdrop.className = "pz-auth-modal-backdrop";
    backdrop.innerHTML = `
      <div class="pz-auth-modal" role="dialog" aria-modal="true" aria-labelledby="pz-auth-title">
        <button class="pz-auth-close" type="button" aria-label="Cerrar">×</button>
        <h3 id="pz-auth-title">Para hacer esto necesitas una cuenta gratuita</h3>
        <p>Entra con Google para continuar.</p>
        <p class="pz-auth-modal-note">Es gratis. Un tap y listo.</p>

        <div class="pz-auth-error" data-auth-error></div>

        <div class="pz-auth-actions">
          <button class="pz-google-btn" type="button" data-auth-google>
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.239 36 24 36c-6.627 0-12-5.373-12-12S17.373 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.272 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
              <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 19.003 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.272 4 24 4c-7.682 0-14.347 4.337-17.694 10.691z"/>
              <path fill="#4CAF50" d="M24 44c5.169 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.144 35.091 26.688 36 24 36c-5.218 0-9.62-3.329-11.283-7.946l-6.522 5.025C9.5 39.556 16.227 44 24 44z"/>
              <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.084 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
            </svg>
            <span>Entrar con Google</span>
          </button>
          <button class="pz-auth-cancel" type="button" data-auth-cancel>Cancelar</button>
        </div>
      </div>
    `;

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModal(true);
    });

    backdrop.querySelector(".pz-auth-close").addEventListener("click", function () {
      closeModal(true);
    });

    backdrop.querySelector("[data-auth-cancel]").addEventListener("click", function () {
      closeModal(true);
    });

    backdrop.querySelector("[data-auth-google]").addEventListener("click", async function () {
      await signInWithGoogle({ fromRequireAuth: true });
    });

    document.body.appendChild(backdrop);
    state.modalEl = backdrop;
    return backdrop;
  }

  function setModalLoading(isLoading) {
    const modal = ensureModal();
    const btn = modal.querySelector("[data-auth-google]");
    if (!btn) return;
    btn.disabled = !!isLoading;
    btn.querySelector("span").textContent = isLoading ? "Entrando..." : "Entrar con Google";
  }

  function setModalError(message) {
    const modal = ensureModal();
    const el = modal.querySelector("[data-auth-error]");
    if (!el) return;

    if (!message) {
      el.textContent = "";
      el.classList.remove("is-visible");
      return;
    }

    el.textContent = message;
    el.classList.add("is-visible");
  }

  function openModal() {
    const modal = ensureModal();
    setModalError("");
    setModalLoading(false);
    modal.classList.add("is-open");
  }

  function closeModal(cancelPending) {
    if (!state.modalEl) return;
    state.modalEl.classList.remove("is-open");
    setModalError("");
    setModalLoading(false);

    if (cancelPending) {
      state.pendingAction = null;
    }
  }

  async function waitForFirebaseReady(timeoutMs) {
    const started = Date.now();
    const timeout = typeof timeoutMs === "number" ? timeoutMs : 10000;

    while (Date.now() - started < timeout) {
      const hasFirebase = !!window.firebase;
      const hasCore = !!(window.PuntazoFirebase && typeof window.PuntazoFirebase.ensureApp === "function");
      const hasAuthCompat = !!(hasFirebase && typeof firebase.auth === "function");

      if (hasFirebase && hasCore && hasAuthCompat) {
        try {
          window.PuntazoFirebase.ensureApp();
          return true;
        } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }

    return false;
  }

  async function initAuth() {
    if (state.isBootstrapped && state.auth) return state.auth;

    const ok = await waitForFirebaseReady(12000);
    if (!ok) {
      console.error("[Puntazo Auth] Firebase no está listo.");
      return null;
    }

    state.auth = window.PuntazoFirebase.auth();

    try {
      await state.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (err) {
      console.warn("[Puntazo Auth] No se pudo fijar persistence LOCAL:", err);
    }

    state.auth.onAuthStateChanged(function (user) {
      state.currentUser = user || null;

      if (typeof window.updateNavUI === "function") {
        try {
          window.updateNavUI(state.currentUser);
        } catch (err) {
          console.warn("[Puntazo Auth] updateNavUI falló:", err);
        }
      }

      window.dispatchEvent(new CustomEvent("puntazo:auth-changed", {
        detail: { user: state.currentUser }
      }));

      if (state.currentUser && typeof state.pendingAction === "function") {
        const pending = state.pendingAction;
        state.pendingAction = null;
        closeModal(false);
        try {
          pending();
        } catch (err) {
          console.error("[Puntazo Auth] Error ejecutando acción pendiente:", err);
        }
      }
    });

    state.isBootstrapped = true;
    window.dispatchEvent(new CustomEvent("puntazo:auth-ready"));
    return state.auth;
  }

  function normalizeAuthError(err) {
    const code = err && err.code ? String(err.code) : "";

    if (code === "auth/popup-closed-by-user") {
      return "Cerraste el popup antes de terminar.";
    }

    if (code === "auth/popup-blocked") {
      return "Tu navegador bloqueó el popup. Vuelve a intentar desde un clic directo.";
    }

    if (code === "auth/unauthorized-domain") {
      return "Este dominio todavía no está autorizado en Firebase Auth.";
    }

    if (code === "auth/cancelled-popup-request") {
      return "Ya había otro popup de acceso abierto.";
    }

    return "No se pudo iniciar sesión. Intenta de nuevo.";
  }

  async function signInWithGoogle(options) {
    const opts = options || {};
    const auth = await initAuth();
    if (!auth) {
      if (opts.fromRequireAuth) setModalError("Firebase Auth no quedó listo.");
      return null;
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
      if (opts.fromRequireAuth) {
        setModalError("");
        setModalLoading(true);
      }

      const result = await auth.signInWithPopup(provider);
      return result;
    } catch (err) {
      console.error("[Puntazo Auth] Error en Google login:", err);
      if (opts.fromRequireAuth) {
        setModalError(normalizeAuthError(err));
        setModalLoading(false);
      }
      return null;
    }
  }

  async function signOut() {
    const auth = await initAuth();
    if (!auth) return;
    await auth.signOut();
  }

  function requireAuth(callback) {
    if (state.currentUser) {
      if (typeof callback === "function") callback();
      return true;
    }

    state.pendingAction = typeof callback === "function" ? callback : null;
    openModal();
    return false;
  }

  window.PuntazoAuth = {
    init: initAuth,
    signIn: signInWithGoogle,
    signOut: signOut,
    requireAuth: requireAuth
  };

  Object.defineProperty(window.PuntazoAuth, "currentUser", {
    get: function () {
      return state.currentUser;
    }
  });

  initAuth();
})();
