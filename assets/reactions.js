// =============================================================
// reactions.js — Puntazo · Reacciones + Comentarios
// Soporte doble: slot mode (nuevo card layout) + legacy mode (mejores.html)
// =============================================================

const ADMIN_PASS = "puntazo2025";
const MIN_REACTIONS_FOR_BEST = 3;

const REACTIONS = [
  { key: "fuego",     emoji: "🔥", label: "Fuego"     },
  { key: "risa",      emoji: "😂", label: "Risa"      },
  { key: "enojo",     emoji: "😡", label: "Enojo"     },
  { key: "diversion", emoji: "🎉", label: "Diversión" },
  { key: "sorpresa",  emoji: "😮", label: "¡Wow!"     },
];

// ── Init Firebase compartido ──
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

// ── Utilidades ──
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
  if (diff < 60)   return "ahora";
  if (diff < 3600) return Math.floor(diff / 60) + " min";
  if (diff < 86400) return Math.floor(diff / 3600) + " h";
  return Math.floor(diff / 86400) + " d";
}

// ── HTML builders ──

// Legacy: bloque completo para mejores.html
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
      ${buildCommentsHTML(videoId)}
    </div>
  `;
}

// Slot mode: sección de reacciones
function buildRxnBarHTML(admin) {
  const btns = REACTIONS.map(r => `
    <button class="pz-rxn-btn" data-key="${r.key}" title="${r.label}" aria-label="${r.label}">
      <span class="pz-emoji">${r.emoji}</span>
      ${admin ? '<span class="pz-count">0</span>' : ''}
    </button>
  `).join("");
  return `<div class="pz-rxn-bar">${btns}</div>`;
}

// Sección de comentarios (usada en ambos modos)
function buildCommentsHTML(videoId) {
  return `
    <button class="pz-comment-toggle" aria-expanded="false">
      <span class="pz-ct-icon">💬</span>
      <span class="pz-ct-text">Comentar</span>
    </button>
    <div class="pz-comment-section" hidden>
      <div class="pz-comments-list"></div>
      <button class="pz-show-more-comments" style="display:none">Ver más</button>
      <div class="pz-comment-input-row">
        <input
          class="pz-comment-input"
          id="pz-ci-${videoId}"
          type="text"
          placeholder="Escribe un comentario…"
          maxlength="200"
          autocomplete="off"
        />
        <button class="pz-send-btn" aria-label="Enviar">➤</button>
        <button class="pz-send-incognito-btn" style="display:none" aria-label="Enviar como incógnito" title="🥷 Enviar como incógnito">🥷</button>
      </div>
      <div class="pz-char-count">200</div>
    </div>
  `;
}

// ── Core wiring: toda la lógica de Firestore y eventos ──
// Recibe refs a los elementos DOM y referencias de Firestore.
function wireReactionsCore({
  db, admin, DEVICE, videoId, meta,
  docRef, commentsRef, participantsRef,
  $rxnBtns,         // NodeList de buttons .pz-rxn-btn
  $participants,    // div .pz-participants
  $claimBtn,        // button .pz-claim-btn
  $toggle,          // button .pz-comment-toggle
  $section,         // div .pz-comment-section
  $list,            // div .pz-comments-list
  $input,           // input
  $sendNormal,      // button enviar normal
  $sendIncognito,   // button enviar incógnito (puede ser null)
  $charCount,       // div char count
  $showMoreBtn,     // button mostrar más
  $rxnPreview,      // div en header de card (puede ser null, solo slot mode)
}) {

  // ── Input: contador de caracteres ──
  if ($input) {
    $input.addEventListener("input", () => {
      const left = 200 - $input.value.length;
      if ($charCount) {
        $charCount.textContent = left;
        $charCount.style.color = left < 20 ? "#ef4444" : "";
      }
    });
  }

  // ── Toggle comentarios ──
  if ($toggle && $section) {
    $toggle.addEventListener("click", () => {
      const open = !$section.hidden;
      $section.hidden = open;
      $toggle.setAttribute("aria-expanded", String(!open));
      if (!open && $input) $input.focus();
    });
  }

  // ── Snapshot reacciones ──
  docRef.onSnapshot(snap => {
    const data  = snap.exists ? snap.data() : {};
    const voted = getVoted(videoId);
    const total = data.total || 0;

    $rxnBtns && $rxnBtns.forEach(btn => {
      const key   = btn.dataset.key;
      const count = data[key] || 0;
      const $count = btn.querySelector(".pz-count");
      if ($count) $count.textContent = count;
      btn.classList.toggle("pz-voted", !!voted[key]);
      btn.classList.toggle("pz-active-pop", count > 0);
    });

    // Preview de emojis activos en el header de card (slot mode)
    if ($rxnPreview) {
      const activos = REACTIONS
        .filter(r => (data[r.key] || 0) > 0)
        .map(r => r.emoji)
        .join("");
      $rxnPreview.textContent = activos;
    }

    // Lógica inmortal
    try {
      const MIN = MIN_REACTIONS_FOR_BEST;
      if (!data.immortal && total >= MIN) {
        docRef.set({
          immortal: true,
          immortal_reasons: { best_threshold: MIN },
          immortal_markedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => {});
      }
    } catch(e) {}
  });

  // ── Snapshot participantes ──
  if ($participants) {
    participantsRef.orderBy("claimedAt", "asc").onSnapshot(snap => {
      $participants.innerHTML = "";
      snap.forEach(doc => {
        const p = doc.data();
        const chip = document.createElement("a");
        chip.href = `/jugador.html?uid=${encodeURIComponent(p.uid)}`;
        chip.className = "pz-participant-chip";
        chip.title = p.displayName || "Jugador";
        chip.innerHTML = p.photoURL
          ? `<img src="${escapeHTML(p.photoURL)}" alt="${escapeHTML(p.displayName || "")}" /><span>${escapeHTML(p.displayName || "Jugador")}</span>`
          : `<span class="pz-p-initial">${escapeHTML((p.displayName || "")[0] || "J")}</span><span>${escapeHTML(p.displayName || "Jugador")}</span>`;
        $participants.appendChild(chip);
      });

      if ($claimBtn) {
        // Si el usuario ya está como participante, cambiar texto del botón
        const authUser = window.PuntazoAuth && window.PuntazoAuth.currentUser;
        if (authUser) {
          const myClaim = snap.docs && snap.docs.find(d => d.id === authUser.uid);
          if (myClaim) {
            $claimBtn.textContent = "✓ Quitar reclamo";
            $claimBtn.style.color = "rgba(234,242,255,0.80)";
          } else {
            $claimBtn.textContent = "🥷 Soy yo";
            $claimBtn.style.color = "";
          }
        }
        // Ocultar si hay 4 y no eres participante
        if (typeof snap.size === "number" && snap.size >= 4) {
          const authUser2 = window.PuntazoAuth && window.PuntazoAuth.currentUser;
          const isClaimed = authUser2 && snap.docs && snap.docs.find(d => d.id === authUser2.uid);
          if (!isClaimed) $claimBtn.style.display = "none";
        } else {
          $claimBtn.style.display = "";
        }
      }
    });
  }

  // ── Snapshot comentarios ──
  let showAllComments = false;
  const MAX_COLLAPSED = 3;

  if ($list) {
    commentsRef.orderBy("ts", "asc").onSnapshot(snap => {
      $list.innerHTML = "";
      const count = snap.size;
      const docs = [];
      snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() }));
      const toShow = showAllComments ? docs : docs.slice(-MAX_COLLAPSED);

      toShow.forEach(item => {
        const d = item.data;
        const ago = d.ts?.toDate ? timeAgo(d.ts.toDate()) : "";
        const isMe = d.deviceId === DEVICE ||
          (d.uid && window.PuntazoAuth?.currentUser && d.uid === window.PuntazoAuth.currentUser.uid);

        const el = document.createElement("div");
        el.className = "pz-comment" + (isMe ? " pz-mine" : "");

        let authorHtml = "";
        if (d.uid && d.public === true) {
          const name = escapeHTML(d.displayName || "Jugador");
          const photo = d.photoURL
            ? `<img class="pz-comment-avatar" src="${escapeHTML(d.photoURL)}" alt="${name}" />`
            : "";
          authorHtml = `<a class="pz-comment-author" href="/jugador.html?uid=${encodeURIComponent(d.uid)}">${photo}<strong>${name}</strong></a>`;
        } else if (d.uid && d.public === false) {
          authorHtml = `<span class="pz-comment-author">🥷 Incógnito</span>`;
        } else {
          authorHtml = `<span class="pz-comment-author" style="color:rgba(234,242,255,.35)">Anónimo</span>`;
        }

        el.innerHTML = `
          <div class="pz-comment-head">${authorHtml}<span class="pz-comment-meta">${ago}</span></div>
          <div class="pz-comment-text">${escapeHTML(d.text)}</div>
        `;
        $list.appendChild(el);
      });

      if ($showMoreBtn) {
        if (count > MAX_COLLAPSED) {
          $showMoreBtn.style.display = "inline-block";
          $showMoreBtn.textContent = showAllComments
            ? "Ver menos"
            : `Ver ${count - MAX_COLLAPSED} más`;
        } else {
          $showMoreBtn.style.display = "none";
        }
      }

      if ($toggle) {
        const $txt = $toggle.querySelector(".pz-ct-text");
        if ($txt) $txt.textContent = count > 0 ? `Comentarios (${count})` : "Comentar";
      }

      if (!$section?.hidden && showAllComments && $list) {
        $list.scrollTop = $list.scrollHeight;
      }
    });
  }

  if ($showMoreBtn) {
    $showMoreBtn.addEventListener("click", () => {
      showAllComments = !showAllComments;
      // El snapshot onSnapshot se re-evaluará porque showAllComments está en closure
      commentsRef.orderBy("ts", "asc").get().then(snap => {
        // Disparar re-render manual
        if ($list) $list.dispatchEvent(new Event("pz-rerender"));
      });
    });
  }

  // ── Click en reacción ──
  $rxnBtns && $rxnBtns.forEach(btn => {
    btn.addEventListener("click", async () => {
      const key     = btn.dataset.key;
      const voted   = getVoted(videoId);
      const already = !!voted[key];
      const delta   = already ? -1 : 1;

      saveVoted(videoId, key, !already);
      btn.classList.toggle("pz-voted", !already);

      const update = {
        [key]: firebase.firestore.FieldValue.increment(delta),
        total: firebase.firestore.FieldValue.increment(delta),
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
      } catch(e) {
        saveVoted(videoId, key, already);
        btn.classList.toggle("pz-voted", already);
        console.error("[Puntazo Reactions] Error guardando reacción:", e);
      }
    });
  });

  // ── Enviar comentario ──
  async function sendComment(incognito = false) {
    if (!$input) return;
    const text = $input.value.trim();
    if (!text) return;

    if ($sendNormal)   $sendNormal.disabled = true;
    if ($sendIncognito) $sendIncognito.disabled = true;
    if ($input)        $input.disabled = true;

    try {
      const payload = {
        text,
        deviceId: DEVICE,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      };

      const authUser = window.PuntazoAuth?.currentUser || null;
      if (authUser) {
        payload.uid          = authUser.uid;
        payload.displayName  = authUser.displayName || "";
        payload.photoURL     = authUser.photoURL    || "";
        payload.public       = !incognito;
      }

      await commentsRef.add(payload);

      await docRef.set({
        videoId,
        videoUrl: meta.videoUrl || "",
        club:     meta.club     || "",
        cancha:   meta.cancha   || "",
        lado:     meta.lado     || "",
        fecha:    meta.fecha    || "",
        total: firebase.firestore.FieldValue.increment(0),
      }, { merge: true });

      try {
        await docRef.set({ comments_count: firebase.firestore.FieldValue.increment(1) }, { merge: true });
      } catch(e) {}

      $input.value = "";
      if ($charCount) $charCount.textContent = "200";
      if ($list) $list.scrollTop = $list.scrollHeight;
    } catch(e) {
      console.error("[Puntazo Reactions] Error al comentar:", e);
    }

    if ($sendNormal)    $sendNormal.disabled   = false;
    if ($sendIncognito) $sendIncognito.disabled = false;
    if ($input) {
      $input.disabled = false;
      $input.focus();
    }
  }

  if ($sendNormal)   $sendNormal.addEventListener("click",   () => sendComment(false));
  if ($sendIncognito) $sendIncognito.addEventListener("click", () => sendComment(true));

  if ($input) {
    $input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendComment(false);
      }
    });
  }

  // ── Mostrar/ocultar botón incógnito según auth ──
  function syncAuthUI(user) {
    if ($sendIncognito) {
      $sendIncognito.style.display = user ? "flex" : "none";
    }
  }

  window.addEventListener("puntazo:auth-changed", e => {
    try { syncAuthUI(e.detail?.user); } catch {}
  });
  syncAuthUI(window.PuntazoAuth?.currentUser || null);

  // ── Claim ──
  async function doClaim() {
    const user = window.PuntazoAuth?.currentUser;
    if (!user) return;
    const uid = user.uid;
    const doc = await participantsRef.doc(uid).get();
    if (doc.exists) {
      await participantsRef.doc(uid).delete();
      try { await docRef.set({ claims_count: firebase.firestore.FieldValue.increment(-1) }, { merge: true }); } catch {}
      return;
    }
    const snapCount = await participantsRef.get();
    if (snapCount.size >= 4) { alert("Este video ya tiene 4 participantes reclamados"); return; }
    await participantsRef.doc(uid).set({
      uid,
      displayName: user.displayName || "",
      photoURL:    user.photoURL    || "",
      claimedAt: firebase.firestore.FieldValue.serverTimestamp(),
      videoId
    });
    try { await docRef.set({ claims_count: firebase.firestore.FieldValue.increment(1) }, { merge: true }); } catch {}
  }

  if ($claimBtn) {
    $claimBtn.addEventListener("click", async () => {
      const auth = window.PuntazoAuth;
      if (!auth || !auth.currentUser) {
        if (auth && typeof auth.requireAuth === "function") {
          auth.requireAuth(async () => { try { await doClaim(); } catch(e) {} });
        }
        return;
      }
      await doClaim();
    });
  }
}

// ── Función principal: attach() ──
async function attachReactions(container, meta) {
  // Esperar hasta que PuntazoFirebase esté disponible
  let retries = 0;
  while (!window.PuntazoFirebase?.db && retries < 30) {
    await new Promise(r => setTimeout(r, 200));
    retries++;
  }

  if (!window.PuntazoFirebase?.db) {
    console.error("[Puntazo Reactions] PuntazoFirebase no disponible tras espera.");
    return;
  }

  const db   = window.PuntazoFirebase.db();
  const admin  = isAdmin();
  const DEVICE = getDeviceId();

  const videoId         = (meta.videoId || "unknown").replace(/[^a-zA-Z0-9._\-]/g, "_");
  const docRef          = db.collection("reactions").doc(videoId);
  const commentsRef     = docRef.collection("comments");
  const participantsRef = docRef.collection("participants");

  // ── Detectar modo ──
  const rxnSlot = container.querySelector("[data-rxn-slot]");
  const isSlotMode = !!rxnSlot;

  if (isSlotMode) {
    // === SLOT MODE: card con estructura pre-construida ===
    const participantsSlot = container.querySelector("[data-participants-slot]");
    const commentsSlot     = container.querySelector("[data-comments-slot]");
    const claimSlot        = container.querySelector("[data-claim-slot]");
    const rxnPreview       = container.querySelector("[data-rxn-preview]");

    // Poblar slots
    rxnSlot.innerHTML = buildRxnBarHTML(admin);

    if (participantsSlot) {
      participantsSlot.innerHTML = `<div class="pz-participants"></div>`;
    }
    if (commentsSlot) {
      commentsSlot.innerHTML = buildCommentsHTML(videoId);
    }
    if (claimSlot) {
      claimSlot.innerHTML = `<button class="pz-claim-btn">🥷 Soy yo</button>`;
    }

    // Recopilar refs
    wireReactionsCore({
      db, admin, DEVICE, videoId, meta,
      docRef, commentsRef, participantsRef,
      $rxnBtns:       rxnSlot.querySelectorAll(".pz-rxn-btn"),
      $participants:  participantsSlot?.querySelector(".pz-participants"),
      $claimBtn:      claimSlot?.querySelector(".pz-claim-btn"),
      $toggle:        commentsSlot?.querySelector(".pz-comment-toggle"),
      $section:       commentsSlot?.querySelector(".pz-comment-section"),
      $list:          commentsSlot?.querySelector(".pz-comments-list"),
      $input:         commentsSlot?.querySelector(".pz-comment-input"),
      $sendNormal:    commentsSlot?.querySelector(".pz-send-btn"),
      $sendIncognito: commentsSlot?.querySelector(".pz-send-incognito-btn"),
      $charCount:     commentsSlot?.querySelector(".pz-char-count"),
      $showMoreBtn:   commentsSlot?.querySelector(".pz-show-more-comments"),
      $rxnPreview:    rxnPreview || null,
    });

  } else {
    // === LEGACY MODE: inject bloque completo (mejores.html) ===
    container.insertAdjacentHTML("beforeend", buildUI(videoId, admin));

    const wrap = container.querySelector(".pz-reactions-wrap");
    if (!wrap) return;

    wireReactionsCore({
      db, admin, DEVICE, videoId, meta,
      docRef, commentsRef, participantsRef,
      $rxnBtns:       wrap.querySelectorAll(".pz-rxn-btn"),
      $participants:  wrap.querySelector(".pz-participants"),
      $claimBtn:      wrap.querySelector(".pz-claim-btn"),
      $toggle:        wrap.querySelector(".pz-comment-toggle"),
      $section:       wrap.querySelector(".pz-comment-section"),
      $list:          wrap.querySelector(".pz-comments-list"),
      $input:         wrap.querySelector(".pz-comment-input"),
      $sendNormal:    wrap.querySelector(".pz-send-btn"),
      $sendIncognito: wrap.querySelector(".pz-send-incognito-btn"),
      $charCount:     wrap.querySelector(".pz-char-count"),
      $showMoreBtn:   wrap.querySelector(".pz-show-more-comments"),
      $rxnPreview:    null,
    });
  }
}

// ── Export ──
window.PuntazoReactions = {
  attach:      attachReactions,
  isAdmin,
  MIN_FOR_BEST: MIN_REACTIONS_FOR_BEST,
  db:          () => window.PuntazoFirebase.db(),
};
