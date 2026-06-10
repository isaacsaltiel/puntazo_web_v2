/* ══════════════════════════════════════════════════════════════
   PUNTAZO — util.js  (Bloque C · auditoría 2026-06-09)

   Helpers compartidos que vivían copiados en ~20 páginas:
     PZ.escapeHtml   — escape XSS (antes 21 copias con 2 nombres)
     PZ.tsToDate     — Timestamp|{seconds}|Date|ms|string → Date|null
     PZ.tsToMillis   — ídem → ms|null   (antes 14+ copias divergentes)
     PZ.toast        — aviso flotante no bloqueante (ok|err)
     PZ.confirm      — modal Promise<boolean>  (reemplaza window.confirm)
     PZ.prompt       — modal Promise<string|null> con chips opcionales
                       (reemplaza window.prompt; null = canceló)

   Sin dependencias. Cargar después de estilo.css (no es requisito).
   Las páginas migran gradualmente; las copias locales se irán borrando.
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PZ) return;

  // ── Texto ──────────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ── Tiempo (Firestore Timestamp / {seconds} / Date / ms / ISO) ─────────────
  function tsToMillis(v) {
    if (v == null) return null;
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v.toMillis === "function") { try { return v.toMillis(); } catch (e) {} }
    if (typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
    if (typeof v === "string") { var t = Date.parse(v); return isNaN(t) ? null : t; }
    return null;
  }
  function tsToDate(v) {
    var ms = tsToMillis(v);
    return ms == null ? null : new Date(ms);
  }

  // ── Estilos compartidos (inyectados una vez) ───────────────────────────────
  function injectStyles() {
    if (document.getElementById("pz-util-styles")) return;
    var s = document.createElement("style");
    s.id = "pz-util-styles";
    s.textContent = [
      ".pz-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:88vw;",
      "background:rgba(8,14,28,.95);color:#eaf2ff;padding:11px 18px;border-radius:12px;z-index:99999;",
      "font-family:inherit;font-weight:700;font-size:14px;line-height:1.4;pointer-events:none;",
      "border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 40px rgba(0,0,0,.45);",
      "opacity:0;transition:opacity .22s;}",
      ".pz-toast.is-on{opacity:1;}",
      ".pz-toast--err{border-color:rgba(255,107,107,.45);}",
      ".pz-toast--ok{border-color:rgba(34,197,94,.45);}",
      ".pz-modal-backdrop{position:fixed;inset:0;background:rgba(3,6,14,.62);backdrop-filter:blur(6px);",
      "z-index:99990;display:flex;align-items:center;justify-content:center;padding:18px;",
      "opacity:0;transition:opacity .18s;}",
      ".pz-modal-backdrop.is-on{opacity:1;}",
      ".pz-modal{width:100%;max-width:420px;background:rgba(10,16,30,.97);border:1px solid rgba(255,255,255,.12);",
      "border-radius:18px;box-shadow:0 26px 60px rgba(0,0,0,.55);padding:20px 18px;color:#eaf2ff;",
      "font-family:inherit;transform:translateY(8px);transition:transform .18s;}",
      ".pz-modal-backdrop.is-on .pz-modal{transform:translateY(0);}",
      ".pz-modal-title{font-size:1.02rem;font-weight:900;margin:0 0 6px;}",
      ".pz-modal-msg{font-size:.9rem;line-height:1.5;color:rgba(234,242,255,.78);margin:0 0 14px;}",
      ".pz-modal-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px;}",
      ".pz-modal-chip{appearance:none;cursor:pointer;border-radius:999px;padding:8px 13px;font:inherit;",
      "font-size:.8rem;font-weight:700;color:#eaf2ff;background:rgba(255,255,255,.06);",
      "border:1px solid rgba(255,255,255,.14);transition:all .15s;}",
      ".pz-modal-chip.is-sel{background:rgba(11,124,255,.22);border-color:rgba(11,124,255,.65);}",
      ".pz-modal-input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);color:#eaf2ff;",
      "border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:11px 12px;font:inherit;",
      "font-size:.9rem;margin:0 0 14px;outline:none;}",
      ".pz-modal-input:focus{border-color:rgba(11,124,255,.55);}",
      ".pz-modal-actions{display:flex;gap:10px;justify-content:flex-end;}",
      ".pz-modal-btn{appearance:none;cursor:pointer;border-radius:999px;padding:11px 18px;font:inherit;",
      "font-size:.86rem;font-weight:800;min-height:44px;transition:all .15s;border:1px solid transparent;}",
      ".pz-modal-btn--ghost{background:transparent;color:rgba(234,242,255,.75);border-color:rgba(255,255,255,.16);}",
      ".pz-modal-btn--ghost:hover{background:rgba(255,255,255,.06);}",
      ".pz-modal-btn--ok{background:linear-gradient(135deg,#0B7CFF,#004FC8);color:#fff;}",
      ".pz-modal-btn--danger{background:linear-gradient(135deg,#ef4444,#b91c1c);color:#fff;}",
    ].join("");
    document.head.appendChild(s);
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  var toastTimer = null;
  function toast(msg, opts) {
    opts = opts || {};
    injectStyles();
    var el = document.getElementById("__pz_toast__");
    if (!el) {
      el = document.createElement("div");
      el.id = "__pz_toast__";
      document.body.appendChild(el);
    }
    el.className = "pz-toast" + (opts.type === "err" ? " pz-toast--err" : (opts.type === "ok" ? " pz-toast--ok" : ""));
    el.textContent = String(msg == null ? "" : msg);
    // reflow para reiniciar la transición si ya estaba visible
    void el.offsetWidth;
    el.classList.add("is-on");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-on"); }, opts.duration || 2600);
  }

  // ── Modal base (Promise). Resuelve con el valor según el modo. ─────────────
  // opts: { title, message, okLabel, cancelLabel, danger, input:{placeholder,
  //         value, maxLength}, chips:[string], allowEmpty }
  function openModal(mode, opts) {
    opts = opts || {};
    injectStyles();
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var back = document.createElement("div");
      back.className = "pz-modal-backdrop";
      var chipSel = null;

      var chipsHtml = "";
      if (mode === "prompt" && Array.isArray(opts.chips) && opts.chips.length) {
        chipsHtml = '<div class="pz-modal-chips">' + opts.chips.map(function (c, i) {
          return '<button type="button" class="pz-modal-chip" data-chip="' + i + '">' + escapeHtml(c) + "</button>";
        }).join("") + "</div>";
      }
      var inputHtml = "";
      if (mode === "prompt") {
        var inp = opts.input || {};
        inputHtml = '<input class="pz-modal-input" type="text" ' +
          'placeholder="' + escapeHtml(inp.placeholder || "") + '" ' +
          'value="' + escapeHtml(inp.value || "") + '" ' +
          'maxlength="' + (Number.isFinite(inp.maxLength) ? inp.maxLength : 280) + '" />';
      }
      back.innerHTML =
        '<div class="pz-modal" role="dialog" aria-modal="true"' + (opts.title ? ' aria-label="' + escapeHtml(opts.title) + '"' : "") + ">" +
          (opts.title ? '<div class="pz-modal-title">' + escapeHtml(opts.title) + "</div>" : "") +
          (opts.message ? '<div class="pz-modal-msg">' + escapeHtml(opts.message) + "</div>" : "") +
          chipsHtml + inputHtml +
          '<div class="pz-modal-actions">' +
            '<button type="button" class="pz-modal-btn pz-modal-btn--ghost" data-act="cancel">' +
              escapeHtml(opts.cancelLabel || "Cancelar") + "</button>" +
            '<button type="button" class="pz-modal-btn ' + (opts.danger ? "pz-modal-btn--danger" : "pz-modal-btn--ok") + '" data-act="ok">' +
              escapeHtml(opts.okLabel || "Aceptar") + "</button>" +
          "</div>" +
        "</div>";
      document.body.appendChild(back);
      void back.offsetWidth;
      back.classList.add("is-on");

      var input = back.querySelector(".pz-modal-input");

      function close(result) {
        back.classList.remove("is-on");
        document.removeEventListener("keydown", onKey);
        setTimeout(function () {
          back.remove();
          if (prevFocus && typeof prevFocus.focus === "function") { try { prevFocus.focus(); } catch (e) {} }
        }, 180);
        resolve(result);
      }
      function okValue() {
        if (mode === "confirm") return true;
        var typed = input ? input.value.trim() : "";
        var chip = (chipSel != null) ? opts.chips[chipSel] : "";
        var combined = chip && typed ? (chip + " — " + typed) : (chip || typed);
        return combined;
      }
      function onOk() {
        var v = okValue();
        if (mode === "prompt" && !v && !opts.allowEmpty) { if (input) input.focus(); return; }
        close(v);
      }
      function onKey(e) {
        if (e.key === "Escape") close(mode === "confirm" ? false : null);
        else if (e.key === "Enter" && (mode === "confirm" || document.activeElement === input)) onOk();
      }

      back.addEventListener("click", function (e) {
        if (e.target === back) close(mode === "confirm" ? false : null);
        var chip = e.target.closest && e.target.closest("[data-chip]");
        if (chip) {
          var i = parseInt(chip.dataset.chip, 10);
          chipSel = (chipSel === i) ? null : i;
          back.querySelectorAll(".pz-modal-chip").forEach(function (c, j) {
            c.classList.toggle("is-sel", j === chipSel);
          });
          return;
        }
        var act = e.target.closest && e.target.closest("[data-act]");
        if (!act) return;
        if (act.dataset.act === "ok") onOk();
        else close(mode === "confirm" ? false : null);
      });
      document.addEventListener("keydown", onKey);
      setTimeout(function () {
        var target = input || back.querySelector('[data-act="ok"]');
        if (target) target.focus();
      }, 60);
    });
  }

  function pzConfirm(message, opts) {
    return openModal("confirm", Object.assign({ message: message }, opts || {}));
  }
  function pzPrompt(message, opts) {
    return openModal("prompt", Object.assign({ message: message }, opts || {}));
  }

  // ── Views (2026-06-10): contador de reproducciones en video_stats/{id}. ──
  // 1 view por video por sesión de browser; increment validado por reglas.
  // Fail-silent: medir nunca debe romper la reproducción.
  function trackVideoView(videoId, meta) {
    try {
      if (!videoId) return;
      var key = "pzv_" + videoId;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      var db = (window.PuntazoFirebase && window.PuntazoFirebase.db) ? window.PuntazoFirebase.db() : null;
      if (!db || !window.firebase || !firebase.firestore) return;
      var doc = {
        views: firebase.firestore.FieldValue.increment(1),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      meta = meta || {};
      if (meta.club) doc.club = meta.club;
      if (meta.cancha) doc.cancha = meta.cancha;
      if (meta.lado) doc.lado = meta.lado;
      db.collection("video_stats").doc(String(videoId)).set(doc, { merge: true })
        .catch(function (e) { console.warn("[PZ.trackVideoView]", e && e.code); });
    } catch (_) {}
  }

  window.PZ = {
    escapeHtml: escapeHtml,
    trackVideoView: trackVideoView,
    tsToDate: tsToDate,
    tsToMillis: tsToMillis,
    toast: toast,
    confirm: pzConfirm,
    prompt: pzPrompt,
  };
})();
