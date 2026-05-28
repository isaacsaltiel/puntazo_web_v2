/* ══════════════════════════════════════════════════════════════
   PUNTAZO — scoreboard-card.js  (Fase 2b · F81)
   Helper reusable para renderizar una card de partido estilo
   "marcador de transmisión TV" (como la imagen de referencia del
   dictado 2026-05-26). Usado por:
     - perfil.html → "Mis partidos" (top 3)
     - mis-partidos.html → todos los partidos
     - detalle-partido.html → header (Fase 2c)

   API expuesta en window.PuntazoScoreboardCard:
     - build(match, opts)   → HTMLElement
     - buildHTML(match, opts) → string
     - CSS_REFERENCE         → const string (puedes inyectarlo si tu
                               página no lo tiene cargado vía CSS file)

   Esquema esperado de `match`:
     { id, status, startedAt, endedAt, modo, loc, can, lado,
       jugadores: [{ nombre, equipo, uid?, claimedByUid? }, …],
       marcador?: { sets: [{team1,team2}, …], gamesTotal?, ganador? } }

   opts:
     - clickable: bool — si true, agrega cursor:pointer + role
     - href: string — si presente, envuelve la card en <a>
     - compact: bool — variante más densa (sin lugar/hora)
     - showLocation: bool (default true) — mostrar "Club · Cancha N · hora"
     - myUid: string|null — para resaltar el equipo del usuario con trofeo
                             si ganó / inscripción "Tú" si está logueado.
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoScoreboardCard) return;

  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function tsToDate(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return ts;
    if (typeof ts.toDate === "function") { try { return ts.toDate(); } catch (_) { return null; } }
    if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6));
    if (typeof ts === "number") return new Date(ts);
    return null;
  }

  function formatRelative(d) {
    if (!d) return "";
    const now = Date.now();
    const diff = Math.max(0, now - d.getTime());
    const min = Math.floor(diff / 60000);
    if (min < 1) return "ahora";
    if (min < 60) return "hace " + min + " min";
    const h = Math.floor(min / 60);
    if (h < 24) return "hace " + h + "h";
    const days = Math.floor(h / 24);
    if (days < 7) return "hace " + days + "d";
    // Después de una semana, fecha absoluta
    return d.getDate() + " " + MESES[d.getMonth()] + " " + d.getFullYear();
  }

  // Distribuye nombres por equipo. Reglas:
  //   ≥2 nombres → "Nombre1 / Nombre2"
  //   1 nombre  → ese nombre
  //   0 nombres en team1 → "Equipo 1" (modo público)
  //   0 nombres en team2 → "Equipo 2"
  function teamName(jugadores, teamId) {
    const J = Array.isArray(jugadores) ? jugadores : [];
    const names = J
      .filter(j => j && j.equipo === teamId && j.nombre)
      .map(j => String(j.nombre).trim())
      .filter(Boolean);
    if (names.length >= 2) return names.slice(0, 2).join(" / ");
    if (names.length === 1) return names[0];
    return teamId === "team1" ? "Equipo 1" : "Equipo 2";
  }

  // ¿El user está en este equipo?
  function userIsInTeam(jugadores, teamId, myUid) {
    if (!myUid) return false;
    const J = Array.isArray(jugadores) ? jugadores : [];
    return J.some(j => j && j.equipo === teamId && (j.uid === myUid || j.claimedByUid === myUid));
  }

  // Construye un array de cells: [{team1, team2}] por set.
  function setsCells(match) {
    const m = match && match.marcador;
    if (!m || !Array.isArray(m.sets)) return [];
    return m.sets
      .filter(s => s && Number.isFinite(s.team1) && Number.isFinite(s.team2))
      .map(s => ({ t1: s.team1, t2: s.team2 }));
  }

  // ¿Quién ganó el set? Devuelve "team1" | "team2" | null.
  function setWinner(s) {
    if (!s || !Number.isFinite(s.t1) || !Number.isFinite(s.t2)) return null;
    if (s.t1 > s.t2) return "team1";
    if (s.t2 > s.t1) return "team2";
    return null;
  }

  // Conteo total de sets por equipo (solo para badges/trofeo).
  function totalSets(cells) {
    let t1 = 0, t2 = 0;
    cells.forEach(s => {
      const w = setWinner(s);
      if (w === "team1") t1++;
      else if (w === "team2") t2++;
    });
    return { t1, t2 };
  }

  // Determinar ganador. Prefiere match.marcador.ganador si está; fallback a setsCount.
  function matchWinner(match) {
    const m = match && match.marcador;
    if (m && (m.ganador === "team1" || m.ganador === "team2")) return m.ganador;
    const cells = setsCells(match);
    if (!cells.length) return null;
    const totals = totalSets(cells);
    if (totals.t1 > totals.t2) return "team1";
    if (totals.t2 > totals.t1) return "team2";
    return null;
  }

  function statusBadgeHTML(status) {
    if (status === "active") {
      return '<span class="pz-sb-badge is-active"><span class="pz-sb-livedot"></span>EN VIVO</span>';
    }
    if (status === "cancelled") {
      return '<span class="pz-sb-badge is-cancelled">CANCELADO</span>';
    }
    return ""; // ended: sin badge (el trofeo + scores ya dicen "terminado")
  }

  function buildHTML(match, opts) {
    const o = opts || {};
    const myUid = o.myUid || null;
    const status = match.status || "ended";
    const cells = setsCells(match);
    const winner = matchWinner(match);

    const t1Name = escHtml(teamName(match.jugadores, "team1"));
    const t2Name = escHtml(teamName(match.jugadores, "team2"));
    const t1Win = winner === "team1";
    const t2Win = winner === "team2";

    const userInT1 = userIsInTeam(match.jugadores, "team1", myUid);
    const userInT2 = userIsInTeam(match.jugadores, "team2", myUid);

    // Construir filas de scores: 1 fila por equipo, N cells (uno por set)
    function scoreRow(teamKey) {
      if (!cells.length) {
        return '<span class="pz-sb-score-empty">—</span>';
      }
      return cells.map(s => {
        const v = teamKey === "team1" ? s.t1 : s.t2;
        const w = setWinner(s);
        const winThis = (w === teamKey);
        return '<span class="pz-sb-score-cell' + (winThis ? ' is-win' : '') + '">' + v + '</span>';
      }).join("");
    }

    const startedDate = tsToDate(match.startedAt);
    const relStr = startedDate ? formatRelative(startedDate) : "";

    // Meta line: hora · club · cancha
    const meta = [];
    if (relStr) meta.push(relStr);
    if (o.locNombre) meta.push(o.locNombre);
    else if (match.loc) meta.push(match.loc);
    if (o.canNombre) meta.push(o.canNombre);
    else if (match.can) meta.push(String(match.can));
    const metaHTML = meta.length
      ? '<div class="pz-sb-meta">' + meta.map(escHtml).join('<span class="pz-sb-meta-sep">·</span>') + '</div>'
      : "";

    const youT1 = userInT1 ? '<span class="pz-sb-you">tú</span>' : '';
    const youT2 = userInT2 ? '<span class="pz-sb-you">tú</span>' : '';
    const trophyT1 = t1Win ? '<span class="pz-sb-trophy" title="Ganador">🏆</span>' : '';
    const trophyT2 = t2Win ? '<span class="pz-sb-trophy" title="Ganador">🏆</span>' : '';

    return (
      '<div class="pz-sb-card pz-sb-status-' + escHtml(status) + (o.compact ? ' pz-sb-compact' : '') + '">' +
        (statusBadgeHTML(status) ? '<div class="pz-sb-badge-wrap">' + statusBadgeHTML(status) + '</div>' : '') +
        '<div class="pz-sb-grid">' +
          '<div class="pz-sb-team' + (t1Win ? ' is-win' : '') + (userInT1 ? ' is-mine' : '') + '">' +
            '<span class="pz-sb-team-dot" style="background:var(--team1-color,#0B7CFF)"></span>' +
            '<span class="pz-sb-team-name">' + trophyT1 + t1Name + youT1 + '</span>' +
          '</div>' +
          '<div class="pz-sb-scores">' + scoreRow("team1") + '</div>' +
          '<div class="pz-sb-team' + (t2Win ? ' is-win' : '') + (userInT2 ? ' is-mine' : '') + '">' +
            '<span class="pz-sb-team-dot" style="background:var(--team2-color,#c8e835)"></span>' +
            '<span class="pz-sb-team-name">' + trophyT2 + t2Name + youT2 + '</span>' +
          '</div>' +
          '<div class="pz-sb-scores">' + scoreRow("team2") + '</div>' +
        '</div>' +
        (o.showLocation === false ? "" : metaHTML) +
      '</div>'
    );
  }

  function build(match, opts) {
    const html = buildHTML(match, opts);
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const node = wrap.firstElementChild;
    if (opts && opts.href) {
      const a = document.createElement("a");
      a.href = opts.href;
      a.className = "pz-sb-cardlink";
      a.appendChild(node);
      return a;
    }
    return node;
  }

  // CSS de referencia. Páginas pueden incluirlo via <style> o agregarlo
  // a su CSS file. Mantiene cohesión visual entre perfil / mis-partidos /
  // detalle.
  const CSS_REFERENCE = `
    .pz-sb-cardlink { display:block; text-decoration:none; color:inherit; }
    .pz-sb-card {
      position:relative;
      background: linear-gradient(180deg, rgba(11,124,255,0.08), rgba(0,79,200,0.06)),
                  rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 18px;
      padding: 18px 16px 14px;
      box-shadow: 0 14px 36px rgba(0,0,0,0.40);
      backdrop-filter: blur(14px);
      transition: transform .14s, border-color .14s, box-shadow .14s;
    }
    .pz-sb-cardlink:hover .pz-sb-card,
    .pz-sb-card.is-clickable:hover {
      transform: translateY(-2px);
      border-color: rgba(11,124,255,0.40);
      box-shadow: 0 18px 44px rgba(11,124,255,0.18), 0 14px 36px rgba(0,0,0,0.42);
    }
    .pz-sb-badge-wrap {
      position: absolute; top: 10px; right: 12px;
    }
    .pz-sb-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 9px; border-radius: 999px;
      font-size: 0.66rem; font-weight: 900;
      letter-spacing: 0.8px;
    }
    .pz-sb-badge.is-active {
      background: rgba(34, 197, 94, 0.18);
      border: 1px solid rgba(34, 197, 94, 0.40);
      color: #9af2c0;
    }
    .pz-sb-badge.is-cancelled {
      background: rgba(150, 150, 150, 0.15);
      border: 1px solid rgba(180, 180, 180, 0.30);
      color: rgba(234, 242, 255, 0.60);
    }
    .pz-sb-livedot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34,197,94,0.85);
      animation: pz-sb-pulse 1.6s infinite;
    }
    @keyframes pz-sb-pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.4; }
    }

    .pz-sb-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: auto auto;
      align-items: center;
      gap: 6px 10px;
      margin-bottom: 10px;
    }
    .pz-sb-team {
      display: flex; align-items: center; gap: 8px;
      min-width: 0;
    }
    .pz-sb-team-dot {
      width: 10px; height: 10px; border-radius: 50%;
      flex-shrink: 0;
      box-shadow: 0 0 6px currentColor;
    }
    .pz-sb-team-name {
      flex: 1; min-width: 0;
      font-size: 1.02rem;
      font-weight: 800;
      color: #eaf2ff;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .pz-sb-team.is-win .pz-sb-team-name { color: #ffd97a; }
    .pz-sb-team.is-mine .pz-sb-team-name { font-weight: 900; }
    .pz-sb-trophy {
      font-size: 0.94rem;
      flex-shrink: 0;
    }
    .pz-sb-you {
      font-size: 0.62rem;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(11, 124, 255, 0.22);
      border: 1px solid rgba(11, 124, 255, 0.40);
      color: #cfe2ff;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .pz-sb-scores {
      display: inline-flex; gap: 5px;
      align-items: center;
      flex-shrink: 0;
    }
    .pz-sb-score-cell {
      min-width: 30px;
      min-height: 30px;
      padding: 0 6px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      font-family: 'Montserrat', system-ui, sans-serif;
      font-size: 1.06rem;
      font-weight: 900;
      color: rgba(234, 242, 255, 0.65);
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .pz-sb-score-cell.is-win {
      color: #6fb2ff;
      border-color: rgba(11, 124, 255, 0.55);
      background: rgba(11, 124, 255, 0.08);
      text-shadow: 0 0 6px rgba(11, 124, 255, 0.40);
    }
    .pz-sb-score-empty {
      font-size: 0.84rem;
      color: rgba(234, 242, 255, 0.40);
      font-style: italic;
    }
    .pz-sb-meta {
      font-size: 0.78rem;
      color: rgba(234, 242, 255, 0.55);
      font-weight: 600;
    }
    .pz-sb-meta-sep { margin: 0 6px; opacity: 0.50; }

    .pz-sb-compact .pz-sb-team-name { font-size: 0.92rem; }
    .pz-sb-compact .pz-sb-score-cell { min-width: 26px; min-height: 26px; font-size: 0.92rem; }
    .pz-sb-compact { padding: 12px 12px 10px; }

    @media (max-width: 380px) {
      .pz-sb-card { padding: 14px 12px 12px; }
      .pz-sb-team-name { font-size: 0.96rem; }
      .pz-sb-score-cell { min-width: 26px; min-height: 26px; font-size: 0.95rem; padding: 0 4px; }
    }
  `;

  window.PuntazoScoreboardCard = {
    build: build,
    buildHTML: buildHTML,
    CSS_REFERENCE: CSS_REFERENCE,
    _teamName: teamName,
    _matchWinner: matchWinner,
  };
})();
