// =============================================================
// reactions.js — Puntazo · Reacciones + Comentarios
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

(function initSharedFirebase() {
  try {
    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.ensureApp !== "function")
      throw new Error("PuntazoFirebase no disponible.");
    window.PuntazoFirebase.ensureApp();
  } catch (e) {
    console.error("[Puntazo Reactions] Init Firebase:", e);
  }
})();

function isAdmin() {
  return new URLSearchParams(window.location.search).get("admin") === ADMIN_PASS;
}

function getDeviceId() {
  let id = localStorage.getItem("pz_device");
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("pz_device", id); }
  return id;
}

function getVoted(videoId) {
  try { return JSON.parse(localStorage.getItem("pz_voted_" + videoId) || "{}"); } catch { return {}; }
}

function saveVoted(videoId, key, val) {
  const v = getVoted(videoId); v[key] = val;
  localStorage.setItem("pz_voted_" + videoId, JSON.stringify(v));
}

function escapeHTML(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function timeAgo(date) {
  if (!date) return "";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return "ahora";
  if (diff < 3600)  return Math.floor(diff / 60) + " min";
  if (diff < 86400) return Math.floor(diff / 3600) + " h";
  return Math.floor(diff / 86400) + " d";
}

// ── Builders ─────────────────────────────────────────────────

function buildUI(videoId, admin) {
  const btns = REACTIONS.map(r => `
    <button class="pz-rxn-btn" data-key="${r.key}" title="${r.label}" aria-label="${r.label}">
      <span class="pz-emoji">${r.emoji}</span>
      <span class="pz-count" style="${admin ? "" : "display:none"}">0</span>
    </button>`).join("");
  return `
    <div class="pz-reactions-wrap">
      <div class="pz-rxn-bar">${btns}</div>
      <div class="pz-participants-row">
        <div class="pz-participants"></div>
        <button class="pz-claim-btn" title="¿Saliste en este video? Márcalo como tuyo y aparece en el ranking del mes 🏆">🥷 Soy yo</button>
      </div>
      ${buildCommentsHTML(videoId)}
    </div>`;
}

function buildRxnBarHTML(admin) {
  const btns = REACTIONS.map(r => `
    <button class="pz-rxn-btn" data-key="${r.key}" title="${r.label}" aria-label="${r.label}">
      <span class="pz-emoji">${r.emoji}</span>
      ${admin ? '<span class="pz-count">0</span>' : ''}
    </button>`).join("");
  return `<div class="pz-rxn-bar">${btns}</div>`;
}

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
        <input class="pz-comment-input" id="pz-ci-${videoId}" type="text"
               placeholder="Escribe un comentario…" maxlength="200" autocomplete="off" />
        <button class="pz-send-btn" aria-label="Enviar">➤</button>
        <button class="pz-send-incognito-btn" style="display:none"
                aria-label="Enviar incógnito" title="🥷 Incógnito">🥷</button>
      </div>
      <div class="pz-char-count">200</div>
    </div>`;
}

// ── Lógica central ────────────────────────────────────────────

function wireReactionsCore({
  db, admin, DEVICE, videoId, meta,
  docRef, commentsRef, participantsRef,
  $rxnBtns, $participants, $claimBtn,
  $toggle, $section, $list, $input,
  $sendNormal, $sendIncognito, $charCount, $showMoreBtn, $rxnPreview,
  $heroName, // [data-hero-name] en card.js — para mostrar nombre del jugador
}) {

  if ($input && $charCount) {
    $input.addEventListener("input", () => {
      const left = 200 - $input.value.length;
      $charCount.textContent = left;
      $charCount.style.color = left < 20 ? "#ef4444" : "";
    });
  }

  if ($toggle && $section) {
    $toggle.addEventListener("click", () => {
      const open = !$section.hidden;
      $section.hidden = open;
      $toggle.setAttribute("aria-expanded", String(!open));
      if (!open && $input) $input.focus();
    });
  }

  // ── Reacciones (tiempo real) ──
  docRef.onSnapshot(snap => {
    const data  = snap.exists ? snap.data() : {};
    const voted = getVoted(videoId);
    const total = data.total || 0;

    if ($rxnBtns) $rxnBtns.forEach(btn => {
      const key = btn.dataset.key, count = data[key] || 0;
      const $c = btn.querySelector(".pz-count");
      if ($c) $c.textContent = count;
      btn.classList.toggle("pz-voted", !!voted[key]);
      btn.classList.toggle("pz-active-pop", count > 0);
    });

    if ($rxnPreview) {
      $rxnPreview.textContent = REACTIONS.filter(r => (data[r.key]||0) > 0).map(r => r.emoji).join("");
    }

    try {
      if (!data.immortal && total >= MIN_REACTIONS_FOR_BEST) {
        docRef.set({ immortal:true, immortal_reasons:{best_threshold:MIN_REACTIONS_FOR_BEST},
          immortal_markedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true}).catch(()=>{});
      }
    } catch {}
  });

  // ── Participantes ──
  if ($participants) {
    participantsRef.orderBy("claimedAt","asc").onSnapshot(snap => {
      $participants.innerHTML = "";
      snap.forEach(doc => {
        const p = doc.data();
        const chip = document.createElement("a");
        chip.href = `/jugador.html?uid=${encodeURIComponent(p.uid)}`;
        chip.className = "pz-participant-chip";
        chip.title = p.displayName || "Jugador";
        chip.innerHTML = p.photoURL
          ? `<img src="${escapeHTML(p.photoURL)}" alt="${escapeHTML(p.displayName||"")}" /><span>${escapeHTML(p.displayName||"Jugador")}</span>`
          : `<span class="pz-p-initial">${escapeHTML((p.displayName||"")[0]||"J")}</span><span>${escapeHTML(p.displayName||"Jugador")}</span>`;
        $participants.appendChild(chip);
      });

      // Actualizar hero name: primer participante
      if ($heroName) {
        if (snap.size > 0) {
          const first = snap.docs[0].data();
          const name = first.displayName || '';
          if (name) {
            $heroName.textContent = '🥷 ' + name;
            $heroName.style.display = 'inline-flex';
          }
        } else {
          $heroName.style.display = 'none';
        }
      }

      if ($claimBtn) {
        const authUser = window.PuntazoAuth?.currentUser;
        const myClaim  = authUser && snap.docs && snap.docs.find(d => d.id === authUser.uid);
        $claimBtn.textContent = myClaim ? "✓ Quitar reclamo" : "🥷 Soy yo";
        // Tooltip explicativo
        $claimBtn.title = myClaim
          ? "Quitar tu reclamo de este video"
          : "¿Saliste en este punto? Márcalo como tuyo — apareces en el ranking del mes y puedes ganar el premio 🏆";
        if (typeof snap.size === "number" && snap.size >= 4 && !myClaim)
          $claimBtn.style.display = "none";
        else
          $claimBtn.style.display = "";
      }
    });
  }

  // ── Comentarios ──
  let showAllComments = false;
  const MAX_COLLAPSED = 3;

  if ($list) {
    commentsRef.orderBy("ts","asc").onSnapshot(snap => {
      $list.innerHTML = "";
      const count = snap.size;
      const docs  = [];
      snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() }));
      const toShow = showAllComments ? docs : docs.slice(-MAX_COLLAPSED);

      toShow.forEach(item => {
        const d   = item.data;
        const ago = d.ts?.toDate ? timeAgo(d.ts.toDate()) : "";
        const authUser = window.PuntazoAuth?.currentUser;
        const isMe = d.deviceId === DEVICE || (d.uid && authUser && d.uid === authUser.uid);

        const el = document.createElement("div");
        el.className = "pz-comment" + (isMe ? " pz-mine" : "");

        let authorHtml = "";
        if (d.uid && d.public === true) {
          const name  = escapeHTML(d.displayName || "Jugador");
          const photo = d.photoURL ? `<img class="pz-comment-avatar" src="${escapeHTML(d.photoURL)}" alt="${name}" />` : "";
          authorHtml  = `<a class="pz-comment-author" href="/jugador.html?uid=${encodeURIComponent(d.uid)}">${photo}<strong>${name}</strong></a>`;
        } else if (d.uid && d.public === false) {
          authorHtml = `<span class="pz-comment-author">🥷 Incógnito</span>`;
        } else {
          authorHtml = `<span class="pz-comment-author" style="color:rgba(234,242,255,.35)">Anónimo</span>`;
        }

        const canDelete = isMe && d.uid && authUser && d.uid === authUser.uid;

        el.innerHTML = `
          <div class="pz-comment-head">
            ${authorHtml}
            <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
              <span class="pz-comment-meta">${ago}</span>
              ${canDelete ? `<button class="pz-comment-delete" title="Borrar" data-id="${escapeHTML(item.id)}">🗑</button>` : ""}
            </div>
          </div>
          <div class="pz-comment-text">${escapeHTML(d.text)}</div>`;

        const $del = el.querySelector(".pz-comment-delete");
        if ($del) {
          $del.addEventListener("click", async () => {
            $del.disabled = true;
            try { await commentsRef.doc($del.dataset.id).delete(); }
            catch(e) { console.error("[Puntazo] Borrar comentario:", e); $del.disabled = false; }
          });
        }

        $list.appendChild(el);
      });

      if ($showMoreBtn) {
        $showMoreBtn.style.display = count > MAX_COLLAPSED ? "inline-block" : "none";
        if (count > MAX_COLLAPSED)
          $showMoreBtn.textContent = showAllComments ? "Ver menos" : `Ver ${count - MAX_COLLAPSED} más`;
      }

      if ($toggle) {
        const $txt = $toggle.querySelector(".pz-ct-text");
        if ($txt) $txt.textContent = count > 0 ? `Comentarios (${count})` : "Comentar";
      }

      if (!$section?.hidden && showAllComments && $list)
        $list.scrollTop = $list.scrollHeight;
    });
  }

  if ($showMoreBtn) {
    $showMoreBtn.addEventListener("click", () => { showAllComments = !showAllComments; });
  }

  // ── Click en reacción ──
  if ($rxnBtns) $rxnBtns.forEach(btn => {
    btn.addEventListener("click", async () => {
      const key     = btn.dataset.key;
      const voted   = getVoted(videoId);
      const already = !!voted[key];
      const delta   = already ? -1 : 1;

      saveVoted(videoId, key, !already);
      btn.classList.toggle("pz-voted", !already);

      const update = {
        [key]:  firebase.firestore.FieldValue.increment(delta),
        total:  firebase.firestore.FieldValue.increment(delta),
        videoId,
        videoUrl: meta.videoUrl || "",
        club:     meta.club     || "",
        cancha:   meta.cancha   || "",
        lado:     meta.lado     || "",
        fecha:    meta.fecha    || "",
        lastInteractionAt: firebase.firestore.FieldValue.serverTimestamp(),
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

    if ($sendNormal)    $sendNormal.disabled    = true;
    if ($sendIncognito) $sendIncognito.disabled = true;
    if ($input)         $input.disabled         = true;

    try {
      const payload = { text, deviceId: DEVICE, ts: firebase.firestore.FieldValue.serverTimestamp() };
      const authUser = window.PuntazoAuth?.currentUser || null;
      if (authUser) {
        payload.uid         = authUser.uid;
        payload.displayName = authUser.displayName || "";
        payload.photoURL    = authUser.photoURL    || "";
        payload.public      = !incognito;
      }

      await commentsRef.add(payload);
      await docRef.set({
        videoId, videoUrl: meta.videoUrl||"", club: meta.club||"",
        cancha: meta.cancha||"", lado: meta.lado||"", fecha: meta.fecha||"",
        total: firebase.firestore.FieldValue.increment(0),
      }, { merge: true });
      try { await docRef.set({ comments_count: firebase.firestore.FieldValue.increment(1) }, { merge: true }); } catch {}

      $input.value = "";
      if ($charCount) $charCount.textContent = "200";
      if ($list) $list.scrollTop = $list.scrollHeight;
    } catch(e) { console.error("[Puntazo] Comentar:", e); }

    if ($sendNormal)    $sendNormal.disabled    = false;
    if ($sendIncognito) $sendIncognito.disabled = false;
    if ($input) { $input.disabled = false; $input.focus(); }
  }

  if ($sendNormal)    $sendNormal.addEventListener("click",   () => sendComment(false));
  if ($sendIncognito) $sendIncognito.addEventListener("click", () => sendComment(true));
  if ($input) {
    $input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendComment(false); }
    });
  }

  function syncAuthUI(user) {
    if ($sendIncognito) $sendIncognito.style.display = user ? "flex" : "none";
  }
  window.addEventListener("puntazo:auth-changed", e => { try { syncAuthUI(e.detail?.user); } catch {} });
  syncAuthUI(window.PuntazoAuth?.currentUser || null);

  // ── Claim ──
  async function doClaim() {
    const user = window.PuntazoAuth?.currentUser;
    if (!user) return;
    const uid  = user.uid;
    const doc  = await participantsRef.doc(uid).get();
    if (doc.exists) {
      await participantsRef.doc(uid).delete();
      try { await docRef.set({ claims_count: firebase.firestore.FieldValue.increment(-1) }, { merge: true }); } catch {}
      return;
    }
    const snapCount = await participantsRef.get();
    if (snapCount.size >= 4) { alert("Este video ya tiene 4 participantes"); return; }
    await participantsRef.doc(uid).set({
      uid, displayName: user.displayName||"", photoURL: user.photoURL||"",
      claimedAt: firebase.firestore.FieldValue.serverTimestamp(), videoId,
    });
    try { await docRef.set({ claims_count: firebase.firestore.FieldValue.increment(1) }, { merge: true }); } catch {}
  }

  if ($claimBtn) {
    $claimBtn.addEventListener("click", async () => {
      const auth = window.PuntazoAuth;
      if (!auth?.currentUser) {
        if (auth?.requireAuth) auth.requireAuth(async () => { try { await doClaim(); } catch {} });
        return;
      }
      await doClaim();
    });
  }
}

// ── attach() ─────────────────────────────────────────────────

async function attachReactions(container, meta) {
  let retries = 0;
  while (!window.PuntazoFirebase?.db && retries < 30) {
    await new Promise(r => setTimeout(r, 200));
    retries++;
  }
  if (!window.PuntazoFirebase?.db) {
    console.error("[Puntazo Reactions] PuntazoFirebase no disponible.");
    return;
  }

  const db      = window.PuntazoFirebase.db();
  const admin   = isAdmin();
  const DEVICE  = getDeviceId();
  const videoId = (meta.videoId || "unknown").replace(/[^a-zA-Z0-9._\-]/g, "_");

  const docRef          = db.collection("reactions").doc(videoId);
  const commentsRef     = docRef.collection("comments");
  const participantsRef = docRef.collection("participants");

  const rxnSlot    = container.querySelector("[data-rxn-slot]");
  const isSlotMode = !!rxnSlot;

  if (isSlotMode) {
    const participantsSlot = container.querySelector("[data-participants-slot]");
    const commentsSlot     = container.querySelector("[data-comments-slot]");
    const claimSlot        = container.querySelector("[data-claim-slot]");
    const rxnPreview       = container.querySelector("[data-rxn-preview]");
    const heroName         = container.querySelector("[data-hero-name]");

    rxnSlot.innerHTML = buildRxnBarHTML(admin);
    if (participantsSlot) participantsSlot.innerHTML = `<div class="pz-participants"></div>`;
    if (commentsSlot)     commentsSlot.innerHTML     = buildCommentsHTML(videoId);
    if (claimSlot) {
      claimSlot.innerHTML = `
        <button class="pz-claim-btn" title="¿Saliste en este punto? Márcalo como tuyo y aparece en el ranking del mes 🏆">
          🥷 Soy yo
        </button>
        <div class="pz-claim-hint">
          ¿Apareces en este video? Reclámalos y <strong>entra al ranking del mes</strong> — hay premios 🎁
        </div>`;
    }

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
      $heroName:      heroName   || null,
    });
  } else {
    // Legacy mode
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
      $heroName:      null,
    });
  }
}

window.PuntazoReactions = {
  attach:      attachReactions,
  isAdmin,
  MIN_FOR_BEST: MIN_REACTIONS_FOR_BEST,
  db:          () => window.PuntazoFirebase.db(),
};
