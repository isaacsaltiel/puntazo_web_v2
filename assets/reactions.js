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
// 1. CONFIGURACIÓN — REEMPLAZA CON TUS DATOS
// ──────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDN6lutb_WqCZHQT3_NbxjZ2BlA8wjnfPg",
  authDomain: "puntazo-clips.firebaseapp.com",
  projectId: "puntazo-clips",
  storageBucket: "puntazo-clips.firebasestorage.app",
  messagingSenderId: "400777430029",
  appId: "1:400777430029:web:4ce79047ddf5544a010144",
  measurementId: "G-1954JRGNL6"
};


// Contraseña para modo admin (URL: ?admin=puntazo2025)
const ADMIN_PASS = "puntazo2025";

// Mínimo de reacciones para aparecer en mejores.html
const MIN_REACTIONS_FOR_BEST = 2;

// Reacciones disponibles
const REACTIONS = [
  { key: "fuego",     emoji: "🔥", label: "Fuego"     },
  { key: "risa",      emoji: "😂", label: "Risa"      },
  { key: "enojo",     emoji: "😡", label: "Enojo"     },
  { key: "diversion", emoji: "🎉", label: "Diversión" },
  { key: "sorpresa",  emoji: "😮", label: "¡Wow!"     },
];

// ──────────────────────────────────────────────
// 2. INIT FIREBASE (solo una vez)
// ──────────────────────────────────────────────
(function initFirebase() {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
  } catch (e) {
    console.error("[Puntazo Reactions] Error inicializando Firebase:", e);
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
      <button class="pz-comment-toggle" aria-expanded="false">
        <span class="pz-ct-icon">💬</span>
        <span class="pz-ct-text">Comentar</span>
        <span class="pz-ct-badge" style="display:none">0</span>
      </button>
      <div class="pz-comment-section" hidden>
        <div class="pz-comments-list"></div>
        <div class="pz-comment-input-row">
          <input
            class="pz-comment-input"
            type="text"
            placeholder="Escribe un comentario…"
            maxlength="200"
            autocomplete="off"
          />
          <button class="pz-send-btn" aria-label="Enviar">➤</button>
        </div>
        <div class="pz-char-count">200</div>
      </div>
    </div>
  `;
}

// ──────────────────────────────────────────────
// 5. FUNCIÓN PRINCIPAL: attach()
// ──────────────────────────────────────────────
async function attachReactions(container, meta) {
  const db   = firebase.firestore();
  const admin = isAdmin();
  const DEVICE = getDeviceId();

  // Sanitizar videoId: solo alfanumérico, puntos, guiones
  const videoId = (meta.videoId || "unknown").replace(/[^a-zA-Z0-9._\-]/g, "_");

  const docRef      = db.collection("reactions").doc(videoId);
  const commentsRef = docRef.collection("comments");

  // Inyectar UI
  container.insertAdjacentHTML("beforeend", buildUI(videoId, admin));

  const wrap         = container.querySelector(".pz-reactions-wrap");
  const $btns        = wrap.querySelectorAll(".pz-rxn-btn");
  const $toggle      = wrap.querySelector(".pz-comment-toggle");
  const $section     = wrap.querySelector(".pz-comment-section");
  const $list        = wrap.querySelector(".pz-comments-list");
  const $input       = wrap.querySelector(".pz-comment-input");
  const $send        = wrap.querySelector(".pz-send-btn");
  const $charCount   = wrap.querySelector(".pz-char-count");
  const $badge       = wrap.querySelector(".pz-ct-badge");

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
    if (total > 0) {
      $badge.textContent = total;
      $badge.style.display = "inline-flex";
    } else {
      $badge.style.display = "none";
    }
  });

  // ── Listener comentarios ──
  commentsRef.orderBy("ts", "asc").onSnapshot(snap => {
    $list.innerHTML = "";
    const count = snap.size;

    snap.forEach(doc => {
      const d   = doc.data();
      const ago = d.ts?.toDate ? timeAgo(d.ts.toDate()) : "";
      const isMe = d.deviceId === DEVICE;

      const el = document.createElement("div");
      el.className = "pz-comment" + (isMe ? " pz-mine" : "");
      el.innerHTML = `
        <span class="pz-comment-text">${escapeHTML(d.text)}</span>
        <span class="pz-comment-meta">${ago}</span>
      `;
      $list.appendChild(el);
    });

    // Scroll al fondo si está abierto
    if (!$section.hidden) {
      $list.scrollTop = $list.scrollHeight;
    }

    // Actualizar badge del toggle
    if (count > 0) {
      $badge.textContent = count;
      $badge.style.display = "inline-flex";
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
      await commentsRef.add({
        text,
        deviceId: DEVICE,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });

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
}


// ──────────────────────────────────────────────
// 6. EXPORT
// ──────────────────────────────────────────────
window.PuntazoReactions = {
  attach:  attachReactions,
  isAdmin,
  MIN_FOR_BEST: MIN_REACTIONS_FOR_BEST,
  db: () => firebase.firestore(),
};
