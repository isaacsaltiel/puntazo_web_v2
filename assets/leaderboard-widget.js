/* ══════════════════════════════════════════════════════════════
   PUNTAZO — leaderboard-widget.js (2026-06-10)

   Tablero de ranking reusable (extraído de clasificacion.html para la
   pantalla unificada de nivel). Se auto-estila y renderiza en un
   contenedor:

     PuntazoLeaderboard.render(containerEl, {
       ctx: "global:padel",   // doc de leaderboards/
       myUid: "...",          // resalta tu fila
       limit: 100,
     })

   Lee leaderboards/{ctx}/entries orderBy nivel desc. Estados de
   loading/vacío/error incluidos. Cada fila enlaza al perfil público.
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoLeaderboard) return;

  function ensureStyles() {
    if (document.getElementById("pz-lb-styles")) return;
    var s = document.createElement("style");
    s.id = "pz-lb-styles";
    s.textContent = [
      ".pz-lb-list{display:flex;flex-direction:column;gap:8px;}",
      ".pz-lb-row{display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,.04);",
      "border:1px solid rgba(255,255,255,.08);border-radius:14px;text-decoration:none;color:inherit;cursor:pointer;",
      "transition:background .14s,border-color .14s,transform .14s;}",
      "a.pz-lb-row:hover{background:rgba(11,124,255,.10);border-color:rgba(11,124,255,.35);transform:translateY(-1px);}",
      ".pz-lb-row.is-me{background:rgba(11,124,255,.16);border-color:rgba(11,124,255,.55);",
      "box-shadow:0 0 0 1px rgba(11,124,255,.35),0 8px 24px rgba(0,79,200,.20);}",
      ".pz-lb-pos{flex-shrink:0;width:34px;text-align:center;font-size:1rem;font-weight:900;",
      "color:rgba(234,242,255,.55);font-variant-numeric:tabular-nums;}",
      ".pz-lb-row.is-top1 .pz-lb-pos{color:#ffd97a;}",
      ".pz-lb-row.is-top2 .pz-lb-pos{color:#d8e2f0;}",
      ".pz-lb-row.is-top3 .pz-lb-pos{color:#e2b07a;}",
      ".pz-lb-emoji{flex-shrink:0;font-size:1.5rem;line-height:1;}",
      ".pz-lb-info{flex:1;min-width:0;}",
      ".pz-lb-name{font-size:.96rem;font-weight:800;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".pz-lb-row.is-me .pz-lb-name::after{content:' · tú';color:#8fc0ff;font-weight:800;font-size:.82rem;}",
      ".pz-lb-meta{font-size:.76rem;color:rgba(234,242,255,.55);margin-top:2px;}",
      ".pz-lb-calib{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;",
      "background:rgba(255,170,60,.14);border:1px solid rgba(255,170,60,.34);color:#ffd497;",
      "font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.4px;vertical-align:middle;}",
      ".pz-lb-nivel{flex-shrink:0;text-align:right;}",
      ".pz-lb-nivel-num{font-size:1.35rem;font-weight:900;color:#cfe2ff;line-height:1;font-variant-numeric:tabular-nums;}",
      ".pz-lb-row.is-me .pz-lb-nivel-num{color:#fff;}",
      ".pz-lb-nivel-lbl{font-size:.64rem;color:rgba(234,242,255,.45);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;font-weight:700;}",
      ".pz-lb-state{text-align:center;padding:44px 20px;color:rgba(234,242,255,.70);}",
      ".pz-lb-state .icon{font-size:3rem;margin-bottom:12px;}",
      ".pz-lb-disclaimer{margin-top:22px;padding:12px 16px;background:rgba(11,124,255,.06);",
      "border:1px solid rgba(11,124,255,.18);border-radius:14px;font-size:.78rem;",
      "color:rgba(234,242,255,.65);line-height:1.5;}",
    ].join("");
    document.head.appendChild(s);
  }

  function esc(s) {
    return (window.PZ && PZ.escapeHtml) ? PZ.escapeHtml(s)
      : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
          return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
        });
  }

  // Emoji de bucket consistente con assets/ranking.js (escala 1.0-7.0).
  function bucketEmoji(nivel) {
    var n = Number(nivel) || 0;
    if (n >= 7.0) return "\u{1F451}";
    if (n >= 6.0) return "⚡";
    if (n >= 5.0) return "\u{1F525}";
    if (n >= 4.0) return "\u{1F985}";
    if (n >= 3.0) return "\u{1F425}";
    if (n >= 2.0) return "\u{1F423}";
    return "\u{1F331}";
  }

  function nameFor(entry, uid) {
    var dn = entry && typeof entry.displayName === "string" ? entry.displayName.trim() : "";
    return dn || ("Jugador " + String(uid || "").slice(0, 5));
  }

  function rowHtml(e, pos, isMe) {
    var wins = Number.isFinite(e.wins) ? e.wins : 0;
    var losses = Number.isFinite(e.losses) ? e.losses : 0;
    var nivel = Number.isFinite(e.nivel) ? e.nivel : 0;
    var cls = "pz-lb-row" + (isMe ? " is-me" : "")
      + (pos === 1 ? " is-top1" : pos === 2 ? " is-top2" : pos === 3 ? " is-top3" : "");
    return '<a class="' + cls + '" href="/jugador.html?uid=' + encodeURIComponent(e.uid || "") + '">' +
      '<div class="pz-lb-pos">' + pos + "</div>" +
      '<div class="pz-lb-emoji">' + bucketEmoji(nivel) + "</div>" +
      '<div class="pz-lb-info">' +
        '<div class="pz-lb-name">' + esc(nameFor(e, e.uid)) +
          (e.isCalibrating ? '<span class="pz-lb-calib">calibrando</span>' : "") + "</div>" +
        '<div class="pz-lb-meta">' + wins + "V · " + losses + "D</div>" +
      "</div>" +
      '<div class="pz-lb-nivel">' +
        '<div class="pz-lb-nivel-num">' + nivel.toFixed(2) + "</div>" +
        '<div class="pz-lb-nivel-lbl">Nivel</div>' +
      "</div>" +
    "</a>";
  }

  async function render(container, opts) {
    opts = opts || {};
    ensureStyles();
    container.innerHTML = '<div class="pz-lb-state">⏳ Cargando el tablero…</div>';
    var db = (window.PuntazoFirebase && window.PuntazoFirebase.db) ? window.PuntazoFirebase.db() : null;
    if (!db) {
      container.innerHTML = '<div class="pz-lb-state"><div class="icon">⚠️</div>No pudimos cargar el tablero. Intenta recargar.</div>';
      return;
    }
    try {
      var snap = await db.collection("leaderboards")
        .doc(opts.ctx || "global:padel")
        .collection("entries")
        .orderBy("nivel", "desc")
        .limit(opts.limit || 100)
        .get();
      var entries = [];
      snap.forEach(function (d) { entries.push(Object.assign({ uid: d.id }, d.data())); });
      if (!entries.length) {
        container.innerHTML = '<div class="pz-lb-state"><div class="icon">🎾</div><b>Aún no hay jugadores rankeados.</b><br>Juega y confirma un partido para aparecer aquí.</div>';
        return;
      }
      container.innerHTML = '<div class="pz-lb-list">' +
        entries.map(function (e, i) { return rowHtml(e, i + 1, opts.myUid && e.uid === opts.myUid); }).join("") +
        "</div>" +
        '<div class="pz-lb-disclaimer">El nivel se calcula automáticamente con cada partido validado. ' +
        "Los jugadores marcados como <b>calibrando</b> aún tienen pocos partidos: su nivel puede moverse bastante.</div>";
    } catch (e) {
      console.error("[leaderboard-widget] error", e);
      container.innerHTML = '<div class="pz-lb-state"><div class="icon">⚠️</div>No pudimos cargar el tablero. Intenta recargar.</div>';
    }
  }

  window.PuntazoLeaderboard = { render: render };
})();
