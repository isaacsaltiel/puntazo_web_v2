/**
 * Núcleo PURO del cálculo de ranking server-side (spec §6).
 *
 * Sin Firestore: recibe el match + los docs ratings/{uid} actuales y devuelve el
 * PLAN de escritura (qué byContext de qué uid cambia) + audit. El wrapper de la
 * Cloud Function (index.js) lo envuelve en una runTransaction idempotente.
 *
 * Contextos por partido (D2/D3):
 *   - global:{sport}              siempre
 *   - club:{loc}:{sport}          siempre (si hay loc)
 *   - group:{groupId}:{sport}     si match.groupId
 * Los LOCALES se siembran del GLOBAL con RD inflado la primera vez (seedLocalFromGlobal).
 */
"use strict";

const PR = require("../vendor/ranking.js");

function sportOf(match) {
  return (match && typeof match.deporte === "string" && match.deporte) || "padel";
}

/** Lista de claves de contexto que este match alimenta. */
function contextsForMatch(match) {
  const sport = sportOf(match);
  const ctxs = ["global:" + sport];
  if (match && match.loc) ctxs.push("club:" + match.loc + ":" + sport);
  if (match && match.groupId) ctxs.push("group:" + match.groupId + ":" + sport);
  return ctxs;
}

/** uids reales (con cuenta) presentes en el match, por equipo. */
function realPlayerUids(match) {
  const js = Array.isArray(match && match.jugadores) ? match.jugadores : [];
  return js.filter(function (j) { return j && j.uid && (j.equipo === "team1" || j.equipo === "team2"); })
           .map(function (j) { return j.uid; });
}

/** ¿ganó el equipo de este jugador? (para wins/losses) */
function didPlayerWin(match, uid) {
  const js = Array.isArray(match && match.jugadores) ? match.jugadores : [];
  const me = js.find(function (j) { return j && j.uid === uid; });
  if (!me || !match.marcador) return null;
  return match.marcador.ganador === me.equipo;
}

/**
 * Enriquece el estado crudo del motor con los campos derivados para UI/almacenamiento.
 * `prev` = estado previo en ese contexto (para acumular wins/losses y sparkline).
 */
function enrich(newState, prev, won) {
  const conservative = Number.isFinite(newState.conservativeRating)
    ? newState.conservativeRating
    : PR.conservativeRating(newState.rating, newState.RD);
  const buck = PR.bucketForRating(conservative);
  const prevWins = (prev && prev.wins) || 0;
  const prevLosses = (prev && prev.losses) || 0;
  const sparkPrev = (prev && Array.isArray(prev.sparkline)) ? prev.sparkline : [];
  const spark = sparkPrev.concat([Number(buck.nivel.toFixed(2))]).slice(-12);
  return {
    rating: newState.rating,
    RD: newState.RD,
    volatility: newState.volatility,
    conservativeRating: conservative,
    nivel: Number(buck.nivel.toFixed(2)),
    bucket: buck.emoji + " " + buck.name,
    reliability: PR.reliability(newState.RD),
    matchCount: newState.matchCount,
    wins: prevWins + (won === true ? 1 : 0),
    losses: prevLosses + (won === false ? 1 : 0),
    lastMatchAt: newState.lastMatchAt || null,
    isCalibrating: !!newState.isCalibrating,
    recentOpponents: newState.recentOpponents || {},
    seededFromGlobal: !!(prev && prev.seededFromGlobal) && newState.matchCount < 1,
  };
}

/**
 * Construye el plan de actualización de ratings para UN match confirmado.
 * @param {object} match  doc del match (jugadores, marcador, endedAt, loc, deporte, groupId)
 * @param {object} currentByUid  { uid: ratingsDoc }  (ratingsDoc.byContext puede faltar)
 * @returns {{ updatesByUid: object, contexts: string[], audit: object, applied: boolean, reason?: string }}
 */
function planRatingUpdate(match, currentByUid) {
  currentByUid = currentByUid || {};
  const sport = sportOf(match);
  const globalCtx = "global:" + sport;
  const contexts = contextsForMatch(match);
  const uids = realPlayerUids(match);

  // Guard rápido: necesita ganador y ≥1 uid por equipo (lo revalida el motor).
  const audit = { algorithmVersion: PR.ALGORITHM_VERSION, contexts: contexts, byContext: {} };
  const updatesByUid = {};

  let appliedAny = false;
  contexts.forEach(function (ctx) {
    // Estado actual de cada uid EN ESTE contexto; los locales se siembran del global.
    const currentForCtx = {};
    uids.forEach(function (uid) {
      const doc = currentByUid[uid] || {};
      const byCtx = doc.byContext || {};
      if (byCtx[ctx]) {
        currentForCtx[uid] = byCtx[ctx];
      } else if (ctx !== globalCtx) {
        // local nuevo → sembrar del global (actual del jugador) con RD inflado
        currentForCtx[uid] = PR.seedLocalFromGlobal(byCtx[globalCtx]);
      } // global nuevo → se deja ausente; el motor lo inicializa a INITIAL
    });

    const res = PR.applyMatchToRatings(match, currentForCtx);
    if (res.audit.skipped) {
      audit.skippedReason = res.audit.reason;
      return; // no aplica en ningún contexto si el match es inválido
    }
    appliedAny = true;
    audit.byContext[ctx] = { before: res.audit.before, after: res.audit.after };

    Object.keys(res.newRatings).forEach(function (uid) {
      const prev = (currentByUid[uid] && currentByUid[uid].byContext && currentByUid[uid].byContext[ctx]) || null;
      const won = didPlayerWin(match, uid);
      const enriched = enrich(res.newRatings[uid], prev, won);
      if (!updatesByUid[uid]) updatesByUid[uid] = {};
      updatesByUid[uid][ctx] = enriched;
    });
  });

  if (!appliedAny) {
    return { updatesByUid: {}, contexts: contexts, audit: audit, applied: false, reason: audit.skippedReason || "sin contexto aplicable" };
  }
  return { updatesByUid: updatesByUid, contexts: contexts, audit: audit, applied: true };
}

module.exports = {
  planRatingUpdate: planRatingUpdate,
  contextsForMatch: contextsForMatch,
  realPlayerUids: realPlayerUids,
  sportOf: sportOf,
  _enrich: enrich,
};
