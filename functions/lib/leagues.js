"use strict";
/**
 * E7 — lógica PURA del tagging de partidos a una liga (sin admin/SDK).
 * Se importa desde functions/index.js y se unit-testea SIN emulador.
 *
 * Decisión LOCKED: 1 liga por partido → reusar el `groupId` SINGULAR del match
 * (NO se inventa `leagueIds`). El servidor, al confirmar, RESUELVE a qué liga
 * pertenece el partido (≥3 de 4 miembros, o pareja-vs-pareja en modo pairs) y
 * escribe ese groupId. Idempotente.
 *
 * El heurístico usa `memberUids` (array espejo en el doc del grupo, Fase 0).
 */

// uids reales (con cuenta) de un match.
function realPlayerUids(match) {
  const js = Array.isArray(match && match.jugadores) ? match.jugadores : [];
  return js.filter(function (j) { return j && j.uid && (j.equipo === "team1" || j.equipo === "team2"); })
           .map(function (j) { return j.uid; });
}

function teamUids(match, team) {
  const js = Array.isArray(match && match.jugadores) ? match.jugadores : [];
  return js.filter(function (j) { return j && j.uid && j.equipo === team; })
           .map(function (j) { return j.uid; });
}

// ¿uids contienen una pareja registrada (2 uids exactos)? → pairId | null
function pairMatch(pairs, uids) {
  if (!Array.isArray(pairs) || uids.length < 2) return null;
  const set = {}; uids.forEach(function (u) { set[u] = true; });
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const pu = (p && Array.isArray(p.uids)) ? p.uids : [];
    if (pu.length === 2 && set[pu[0]] && set[pu[1]]) return p.pairId;
  }
  return null;
}

/**
 * ¿Este match califica para esta liga? Devuelve { qualifies, overlap }.
 *  - individual: overlap = #uids del match que están en memberUids; qualifies si ≥threshold.
 *  - pairs: qualifies si AMBOS equipos son parejas registradas distintas; overlap=4.
 */
function leagueQualifies(match, league) {
  const block = (league && league.league) || {};
  const mode = (block.mode === "pairs") ? "pairs" : "individual";
  const threshold = Number.isFinite(block.countThreshold) ? block.countThreshold : 3;
  const memberUids = Array.isArray(league && league.memberUids) ? league.memberUids : [];

  if (mode === "pairs") {
    const pairs = Array.isArray(block.pairs) ? block.pairs : [];
    const p1 = pairMatch(pairs, teamUids(match, "team1"));
    const p2 = pairMatch(pairs, teamUids(match, "team2"));
    const ok = !!(p1 && p2 && p1 !== p2);
    return { qualifies: ok, overlap: ok ? 4 : 0 };
  }
  // individual
  const mset = {}; memberUids.forEach(function (u) { mset[u] = true; });
  let overlap = 0;
  realPlayerUids(match).forEach(function (u) { if (mset[u]) overlap++; });
  return { qualifies: overlap >= threshold, overlap: overlap };
}

/**
 * Resuelve el groupId de liga para un match.
 * @param match
 * @param candidates  [{ groupId, memberUids, league:{mode,pairs,countThreshold} }]
 * @param preChosenGroupId  groupId que el match ya trae (registrante pre-eligió), o null.
 * @returns { groupId|null, reason }
 *   - Si preChosen califica → lo respeta.
 *   - Si no, elige el candidato que califica con MAYOR overlap; desempate por groupId
 *     (determinista) para idempotencia.
 */
function resolveLeagueGroupId(match, candidates, preChosenGroupId) {
  const list = Array.isArray(candidates) ? candidates : [];
  // 1) preChosen: si está en la lista y califica, respétalo.
  if (preChosenGroupId) {
    const pre = list.find(function (c) { return c && c.groupId === preChosenGroupId; });
    if (pre) {
      const q = leagueQualifies(match, pre);
      if (q.qualifies) return { groupId: preChosenGroupId, reason: "prechosen-qualifies" };
      return { groupId: null, reason: "prechosen-not-qualifying" };
    }
    // preChosen no es una liga candidata (p.ej. grupo genérico) → no es de liga.
    return { groupId: null, reason: "prechosen-not-a-league" };
  }
  // 2) sin preChosen: el mejor candidato que califica.
  const qualifying = list
    .map(function (c) { return { groupId: c.groupId, q: leagueQualifies(match, c) }; })
    .filter(function (x) { return x.q.qualifies; });
  if (!qualifying.length) return { groupId: null, reason: "no-qualifying-league" };
  qualifying.sort(function (a, b) {
    if (b.q.overlap !== a.q.overlap) return b.q.overlap - a.q.overlap;
    return String(a.groupId).localeCompare(String(b.groupId)); // determinista
  });
  return { groupId: qualifying[0].groupId, reason: "resolved-by-overlap" };
}

module.exports = {
  realPlayerUids: realPlayerUids,
  teamUids: teamUids,
  pairMatch: pairMatch,
  leagueQualifies: leagueQualifies,
  resolveLeagueGroupId: resolveLeagueGroupId,
};
