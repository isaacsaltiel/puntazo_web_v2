// =============================================================
// reactions.js — Puntazo · Reacciones + Comentarios
// Requiere: Firebase SDK (compat v9) cargado ANTES que este script
// =============================================================
//
// SETUP RÁPIDO (5 pasos):
//   1. Ve a https://console.firebase.google.com → Crear proyecto → "puntazo-clips"
//   2. En el proyecto: Build → Firestore Database → Crear en modo TEST
//   3. En el proyecto: Configuración ⚙️ → Aplicaciones → </> Web → Registrar app
//   4. Copia el objeto firebaseConfig que te da y pégalo en FIREBASE_CONFIG abajo
//   5. Listo. El resto lo hace este archivo.
//
// INTEGRACIÓN en lado.html (añadir antes de </body>):
//   <link rel="stylesheet" href="/assets/reactions.css" />
//   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
//   <script src="/assets/reactions.js"></script>
//
// LLAMADA por cada video renderizado (en script.js, donde creas la card):
//   PuntazoReactions.attach(cardElement, {
//     videoId: nombreArchivo,   // ej: "20250310_143022_cancha1A.mp4"
//     videoUrl: urlDropbox,
//     club: "Club Punta Sur",
//     cancha: "Cancha 1",
//     lado: "A",
//     fecha: "2025-03-10"
//   });
//
// MODO ADMIN: agrega ?admin=puntazo2025 a cualquier URL para ver los conteos
// =============================================================

// ──────────────────────────────────────────────
// 1. CONFIGURACIÓN — Usar Firebase compartido (PuntazoFirebase)
// ──────────────────────────────────────────────
// La configuración y el init deben provenir de la instancia compartida
// `window.PuntazoFirebase` provista por la aplicación principal.


// Contraseña para modo admin (URL: ?admin=puntazo2025)
const ADMIN_PASS = "puntazo2025";

// Mínimo de reacciones para aparecer en mejores.html
// REVISADO: elevar a 3 para evitar que cualquier video con 1 reacción
// se vuelva candidato automáticamente. Ajusta según negocio.
const MIN_REACTIONS_FOR_BEST = 3;

// Reacciones disponibles
const REACTIONS = [
  { key: "fuego",     emoji: "🔥", label: "Fuego"     },
  { key: "risa",      emoji: "😂", label: "Risa"      },
  { key: "enojo",     emoji: "😡", label: "Enojo"     },
  { key: "diversion", emoji: "🎉", label: "Diversión" },
  { key: "sorpresa",  emoji: "😮", label: "¡Wow!"     },
];

// ──────────────────────────────────────────────
// 2. INIT FIREBASE (usar instancia compartida)
// ──────────────────────────────────────────────
(function initSharedFirebase() {
  try {
    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.ensureApp !== "function") {
      throw new Error("PuntazoFirebase no está disponible.");
    }
    window.PuntazoFirebase.ensureApp();
  } catch (e) {
    console.error("[Puntazo Reactions] Error inicializando Firebase compartido:", e);
  }
})();

// ──────────────────────────────────────────────
// 3. UTILIDADES
// ──────────────────────────────────────────────
function isAdmin() {
  return new URLSearchParams(window.location.search).get("admin") === ADMIN_PASS;
}

function getDeviceId() {
  let id = localStorage.getItem("pz_device");
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("pz_device", id);
  }
  return id;
}

function getVoted(videoId) {
  try {
    const raw = localStorage.getItem("pz_voted_" + videoId);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveVoted(videoId, key, val) {
  const v = getVoted(videoId);
  v[key] = val;
  localStorage.setItem("pz_voted_" + videoId, JSON.stringify(v));
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeAgo(date) {
  if (!date) return "";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)  return "ahora";
  if (diff < 3600) return Math.floor(diff / 60) + " min";
  if (diff < 86400) return Math.floor(diff / 3600) + " h";
  return Math.floor(diff / 86400) + " d";
}

// ──────────────────────────────────────────────
// 4. HTML DE LA UI DE REACCIONES
// ──────────────────────────────────────────────
function buildUI(videoId, admin) {
  const btns = REACTIONS.map(r => `
    <button class="pz-rxn-btn" data-key="${r.key}" title="${r.label}" aria-label="${r.label}">
      <span class="pz-emoji">${r.emoji}</span>
      <span class="pz-count" style="${admin ? "" : "display:none"}">0</span>
    </button>
  `).join("");

  return `
    <div class="pz-reactions-wrap">
      <div class="pz-rxn-bar">${btns}</div>

      <div class="pz-participants-row">
        <div class="pz-participants" aria-hidden="false"></div>
        <button class="pz-claim-btn" title="Reclamar participación">🥷 Soy yo</button>
      </div>

      <button class="pz-comment-toggle" aria-expanded="false">
        <span class="pz-ct-icon">💬</span>
        <span class="pz-ct-text">Comentar</span>
      </button>

      <div class="pz-comment-section" hidden>
        <div class="pz-comments-list"></div>

        <div class="pz-comment-controls">
          <label class="pz-public-switch" style="display:none">
            <input type="checkbox" class="pz-comment-public-cb" /> <span>Público</span>
          </label>
        </div>

        <div class="pz-comment-input-row">
          <input
            class="pz-comment-input"
            id="pz-comment-input-${videoId}"
            name="pz-comment-input-${videoId}"
            type="text"
            placeholder="Escribe un comentario…"
            maxlength="200"
            autocomplete="off"
          />

          <button class="pz-send-btn" aria-label="Enviar">➤</button>
        </div>
        <div class="pz-char-count">200</div>
        <button class="pz-show-more-comments" style="display:none">Mostrar más</button>
      </div>
    </div>
  `;
}

// ──────────────────────────────────────────────
// 5. FUNCIÓN PRINCIPAL: attach()
// ──────────────────────────────────────────────
async function attachReactions(container, meta) {
  const db = window.PuntazoFirebase.db();
  const admin = isAdmin();
  const DEVICE = getDeviceId();

  // Sanitizar videoId: solo alfanumérico, puntos, guiones
  const videoId = (meta.videoId || "unknown").replace(/[^a-zA-Z0-9._\-]/g, "_");

  const docRef      = db.collection("reactions").doc(videoId);
  const commentsRef = docRef.collection("comments");
  const participantsRef = docRef.collection("participants");

  // Inyectar UI
  container.insertAdjacentHTML("beforeend", buildUI(videoId, admin));

  const wrap         = container.querySelector(".pz-reactions-wrap");
  const $participants = wrap.querySelector('.pz-participants');
  const $claimBtn = wrap.querySelector('.pz-claim-btn');
  const $btns        = wrap.querySelectorAll(".pz-rxn-btn");
  const $toggle      = wrap.querySelector(".pz-comment-toggle");
  const $section     = wrap.querySelector(".pz-comment-section");
  const $list        = wrap.querySelector(".pz-comments-list");
  const $input       = wrap.querySelector(".pz-comment-input");
  const $send        = wrap.querySelector(".pz-send-btn");
  const $charCount   = wrap.querySelector(".pz-char-count");
  const $showMoreBtn = wrap.querySelector('.pz-show-more-comments');
  const $publicSwitchWrap = wrap.querySelector('.pz-public-switch');
  const $publicCb = wrap.querySelector('.pz-comment-public-cb');

  // ── Actualizar conteo de caracteres ──
  $input.addEventListener("input", () => {
    const left = 200 - $input.value.length;
    $charCount.textContent = left;
    $charCount.style.color = left < 20 ? "#ef4444" : "";
  });

  // ── Toggle comentarios ──
  $toggle.addEventListener("click", () => {
    const open = !$section.hidden;
    $section.hidden = open;
    $toggle.setAttribute("aria-expanded", String(!open));
    if (!open) $input.focus();
  });

  // ── Listener reacciones (tiempo real) ──
  docRef.onSnapshot(snap => {
    const data   = snap.exists ? snap.data() : {};
    const voted  = getVoted(videoId);
    const total  = data.total || 0;

    $btns.forEach(btn => {
      const key   = btn.dataset.key;
      const count = data[key] || 0;
      btn.querySelector(".pz-count").textContent = count;
      btn.classList.toggle("pz-voted", !!voted[key]);
      // Animación suave al cambiar
      btn.classList.toggle("pz-active-pop", count > 0);
    });

    // Badge en el toggle (solo si hay reacciones)
    // Reactions total shown on reaction buttons; keep comment count in toggle text only

    // --- Business rule: marcar inmortalidad si cruza umbral de "mejores" ---
    try {
      const MIN = MIN_REACTIONS_FOR_BEST;
      if (!data.immortal && (total >= MIN)) {
        // marcar inmortal y guardar razón explícita
        docRef.set({
          immortal: true,
          immortal_reasons: { best_threshold: MIN },
          immortal_markedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => {});
      }
    } catch (e) {
      // no bloquear UI si falla
    }
  });

  // ── Participants listener ──
  participantsRef.orderBy('claimedAt', 'asc').onSnapshot(snap => {
    $participants.innerHTML = '';
    snap.forEach(doc => {
      const p = doc.data();
      const chip = document.createElement('a');
      chip.href = `/jugador.html?uid=${encodeURIComponent(p.uid)}`;
      chip.className = 'pz-participant-chip';
      chip.title = p.displayName || 'Jugador';
      chip.innerHTML = p.photoURL ? `<img src="${escapeHTML(p.photoURL)}" alt="${escapeHTML(p.displayName||'')}" />` : `<span class="pz-p-initial">${escapeHTML((p.displayName||'')[0]||'J')}</span>`;
      $participants.appendChild(chip);
    });
    // Show/hide claim button depending on snapshot size
    if (typeof snap.size === 'number') {
      $claimBtn.style.display = snap.size >= 4 ? 'none' : 'inline-flex';
    }
  });

  // ── Listener comentarios ──
  // New: collapse long comment lists, show first 3 unless user expands
  let showAllComments = false;
  const MAX_COLLAPSED = 3;
  commentsRef.orderBy("ts", "asc").onSnapshot(snap => {
    $list.innerHTML = "";
    const count = snap.size;

    const docs = [];
    snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() }));

    const toShow = showAllComments ? docs : docs.slice(-MAX_COLLAPSED);

    toShow.forEach(item => {
      const d = item.data;
      const ago = d.ts?.toDate ? timeAgo(d.ts.toDate()) : "";
      const isMe = d.deviceId === DEVICE || (d.uid && window.PuntazoAuth && window.PuntazoAuth.currentUser && d.uid === window.PuntazoAuth.currentUser.uid);

      const el = document.createElement("div");
      el.className = "pz-comment" + (isMe ? " pz-mine" : "");

      // Determine author display
      let authorHtml = '';
      if (d.uid && d.public === true) {
        const name = escapeHTML(d.displayName || 'Jugador');
        const photo = d.photoURL ? `<img class="pz-comment-avatar" src="${escapeHTML(d.photoURL)}" alt="${name}" />` : '';
        authorHtml = `<a class="pz-comment-author" href="/jugador.html?uid=${encodeURIComponent(d.uid)}">${photo}<strong>${name}</strong></a>`;
      } else if (d.uid && d.public === false) {
        authorHtml = `<span class="pz-comment-author">Incógnito</span>`;
      } else if (d.deviceId && !d.uid) {
        authorHtml = `<span class="pz-comment-author">Anónimo</span>`;
      }

      el.innerHTML = `
        <div class="pz-comment-head">${authorHtml}<span class="pz-comment-meta">${ago}</span></div>
        <div class="pz-comment-text">${escapeHTML(d.text)}</div>
      `;
      $list.appendChild(el);
    });

    // Show more button logic
    if (count > MAX_COLLAPSED) {
      $showMoreBtn.style.display = 'inline-block';
      $showMoreBtn.textContent = showAllComments ? `Mostrar menos` : `Mostrar ${count - MAX_COLLAPSED} comentarios`;
    } else {
      $showMoreBtn.style.display = 'none';
    }

    // Scroll to bottom if open and showing all
    if (!$section.hidden && showAllComments) {
      $list.scrollTop = $list.scrollHeight;
    }

    const txt = $toggle.querySelector(".pz-ct-text");
    txt.textContent = count > 0 ? `Comentarios (${count})` : "Comentar";
  });

  // ── Click en reacción ──
  $btns.forEach(btn => {
    btn.addEventListener("click", async () => {
      const key     = btn.dataset.key;
      const voted   = getVoted(videoId);
      const already = !!voted[key];
      const delta   = already ? -1 : 1;

      // Optimistic UI
      saveVoted(videoId, key, !already);
      btn.classList.toggle("pz-voted", !already);

      const update = {
        [key]: firebase.firestore.FieldValue.increment(delta),
        total: firebase.firestore.FieldValue.increment(delta),
        // Guardar metadata para mejores.html (solo en primera reacción)
        videoId,
        videoUrl: meta.videoUrl  || "",
        club:     meta.club      || "",
        cancha:   meta.cancha    || "",
        lado:     meta.lado      || "",
        fecha:    meta.fecha     || "",
        lastReaction: firebase.firestore.FieldValue.serverTimestamp(),
      };

      try {
        await docRef.set(update, { merge: true });
      } catch (e) {
        // Rollback si falla
        saveVoted(videoId, key, already);
        btn.classList.toggle("pz-voted", already);
        console.error("[Puntazo Reactions] Error guardando reacción:", e);
      }
    });
  });

  // ── Enviar comentario ──
  async function sendComment() {
    const text = $input.value.trim();
    if (!text) return;

    $send.disabled = true;
    $input.disabled = true;

    try {
      // Build comment payload: preserve backward-compatible fields for old anonymous comments
      const payload = {
        text,
        deviceId: DEVICE,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      };

      // If user is authenticated and chose public, attach uid/displayName/photo and public flag
      const authUser = window.PuntazoAuth && window.PuntazoAuth.currentUser ? window.PuntazoAuth.currentUser : null;
      if (authUser) {
        const chosePublic = !!($publicCb && $publicCb.checked);
        payload.uid = authUser.uid;
        payload.displayName = authUser.displayName || '';
        payload.photoURL = authUser.photoURL || '';
        payload.public = !!chosePublic; // true => show name+photo, false => incognito label
      }

      await commentsRef.add(payload);

      // Asegurar que el doc padre existe
      await docRef.set({
        videoId,
        videoUrl: meta.videoUrl || "",
        club:     meta.club     || "",
        cancha:   meta.cancha   || "",
        lado:     meta.lado     || "",
        fecha:    meta.fecha    || "",
        total:    firebase.firestore.FieldValue.increment(0), // no suma, solo asegura campo
      }, { merge: true });

      // Incrementar contador de comentarios (métrica comercial)
      try {
        await docRef.set({ comments_count: firebase.firestore.FieldValue.increment(1) }, { merge: true });
      } catch (e) { /* noop */ }

      $input.value = "";
      $charCount.textContent = "200";
      $list.scrollTop = $list.scrollHeight;
    } catch (e) {
      console.error("[Puntazo Reactions] Error al comentar:", e);
    }

    $send.disabled  = false;
    $input.disabled = false;
    $input.focus();
  }

  $send.addEventListener("click", sendComment);
  $input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendComment();
    }
  });

  // Toggle show more comments
  $showMoreBtn.addEventListener('click', () => {
    showAllComments = !showAllComments;
    // Force re-render by re-querying once (we depend on onSnapshot to update view)
    // No-op: onSnapshot will reflect current showAllComments in closure next tick
  });

  // Claim button behavior: requires auth, creates participant doc under participants/<uid>
  async function toggleClaim() {
    const auth = window.PuntazoAuth;
    if (!auth || !auth.currentUser) {
      // Ask to login
      if (typeof window.PuntazoAuth !== 'undefined') {
        window.PuntazoAuth.requireAuth(async () => {
          try { await doClaim(); } catch (e) { console.error(e); }
        });
      }
      return;
    }
    await doClaim();
  }

  async function doClaim() {
    const user = window.PuntazoAuth.currentUser;
    if (!user) return;
    const uid = user.uid;
    const doc = await participantsRef.doc(uid).get();
    if (doc.exists) {
      // Unclaim
      await participantsRef.doc(uid).delete();
      try {
        await docRef.set({ claims_count: firebase.firestore.FieldValue.increment(-1) }, { merge: true });
      } catch (e) { /* noop */ }
      return;
    }

    // Ensure we don't exceed 4 participants (best-effort client-side guard)
    const snap = await participantsRef.get();
    if (snap.size >= 4) {
      alert('Este video ya tiene 4 participantes reclamados');
      return;
    }

    await participantsRef.doc(uid).set({
      uid: uid,
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      claimedAt: firebase.firestore.FieldValue.serverTimestamp(),
      videoId
    });
    // Incrementar contador de claims/apariciones
    try {
      await docRef.set({ claims_count: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    } catch (e) { /* noop */ }
  }

  $claimBtn.addEventListener('click', toggleClaim);

  // Show public checkbox only when auth ready
  function updateAuthUI(user) {
    if (user) {
      $publicSwitchWrap.style.display = '';
    } else {
      $publicSwitchWrap.style.display = 'none';
      if ($publicCb) $publicCb.checked = false;
    }
  }

  // Listen auth changes
  window.addEventListener('puntazo:auth-changed', (e) => {
    try { updateAuthUI(e.detail.user); } catch {}
  });

  // Initial auth state
  try { updateAuthUI(window.PuntazoAuth && window.PuntazoAuth.currentUser); } catch {}
}


// ──────────────────────────────────────────────
// 6. EXPORT
// ──────────────────────────────────────────────
window.PuntazoReactions = {
  attach:  attachReactions,
  isAdmin,
  MIN_FOR_BEST: MIN_REACTIONS_FOR_BEST,
  db: () => window.PuntazoFirebase.db(),
};
