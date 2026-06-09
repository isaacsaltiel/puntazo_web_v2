/**
 * Puntazo Cloud Functions — ranking autoritativo server-side (spec §6).
 *
 *  - onMatchConfirmed      trigger: match pasa a "confirmed" -> aplica Glicko-2
 *                          global+local, idempotente vía runTransaction.
 *  - expireUnconfirmed     scheduled: pending_confirmation vencidos -> void.
 *  - recomputeAllRatings   callable (admin): reprocesa el histórico.
 *
 * Idempotencia (dura, spec §6.2): TODO dentro de una runTransaction; guard por
 * `processedMatches/{matchId}` + `matches/{id}.ratingProcessed`. NUNCA writeBatch
 * (hay que leer ratings antes de decidir), NUNCA dedup por eventId.
 */
"use strict";

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

const { planRatingUpdate, realPlayerUids } = require("./lib/rating.js");
const leaguesLib = require("./lib/leagues.js");
// Motor de standings (PURO, compartido con el navegador). Vendorizado a
// functions/vendor/ por scripts/vendor-ranking.js (pretest/predeploy), igual que
// el motor de ranking — `firebase deploy` solo sube functions/.
const standings = require("./vendor/standings.js");

admin.initializeApp();
const db = admin.firestore();
const REGION = "us-central1";

function displayNameFor(match, uid) {
  const js = Array.isArray(match && match.jugadores) ? match.jugadores : [];
  const j = js.find(function (x) { return x && x.uid === uid; });
  return (j && (j.nombre || j.displayName)) || null;
}

/**
 * Aplica (o reaplica) el ranking de UN match de forma idempotente y atómica.
 * Exportada para reuso desde recompute y tests de integración.
 */
async function applyRankingTx(matchId) {
  const matchRef = db.collection("matches").doc(matchId);
  const processedRef = db.collection("processedMatches").doc(matchId);

  return db.runTransaction(async function (tx) {
    // ── TODAS las lecturas primero ──
    const processedSnap = await tx.get(processedRef);
    if (processedSnap.exists) {
      return { outcome: "skipped-idempotent" };
    }
    const matchSnap = await tx.get(matchRef);
    if (!matchSnap.exists) return { outcome: "skipped-no-match" };
    const match = matchSnap.data();
    if (match.status !== "confirmed" || match.ratingProcessed === true) {
      return { outcome: "skipped-guard" };
    }
    const uids = realPlayerUids(match);
    const ratingRefs = uids.map(function (u) { return db.collection("ratings").doc(u); });
    const ratingSnaps = await Promise.all(ratingRefs.map(function (r) { return tx.get(r); }));
    const currentByUid = {};
    uids.forEach(function (u, i) {
      currentByUid[u] = ratingSnaps[i].exists ? ratingSnaps[i].data() : { uid: u, byContext: {} };
    });

    const plan = planRatingUpdate(match, currentByUid);

    // ── Escrituras ──
    if (!plan.applied) {
      // Marcar procesado igual (evita reintentos infinitos del trigger) pero sin tocar ratings.
      tx.set(processedRef, {
        processedAt: FieldValue.serverTimestamp(), outcome: "skipped",
        reason: plan.reason || null, algorithmVersion: plan.audit.algorithmVersion,
      });
      tx.update(matchRef, { ratingProcessed: true, ratingProcessedAt: FieldValue.serverTimestamp() });
      return { outcome: "skipped-invalid", reason: plan.reason };
    }

    Object.keys(plan.updatesByUid).forEach(function (uid) {
      const ref = db.collection("ratings").doc(uid);
      const dn = displayNameFor(match, uid) || uid;
      const byContextUpdate = {};
      Object.keys(plan.updatesByUid[uid]).forEach(function (ctx) {
        const st = plan.updatesByUid[uid][ctx];
        byContextUpdate[ctx] = st;
        // Entrada de leaderboard QUERYABLE por contexto: cualquier tabla (global,
        // club, grupo) = una sola query `leaderboards/{ctx}/entries orderBy nivel`.
        const lbRef = db.collection("leaderboards").doc(ctx).collection("entries").doc(uid);
        tx.set(lbRef, {
          uid: uid,
          displayName: dn,
          nivel: st.nivel,
          rating: st.rating,
          reliability: st.reliability,
          wins: st.wins,
          losses: st.losses,
          matchCount: st.matchCount,
          isCalibrating: st.isCalibrating,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      const payload = {
        uid: uid,
        updatedAt: FieldValue.serverTimestamp(),
        displayName: dn,
        byContext: byContextUpdate, // merge:true deep-mergea las claves de contexto
      };
      tx.set(ref, payload, { merge: true });
    });

    tx.update(matchRef, {
      ratingProcessed: true,
      ratingProcessedAt: FieldValue.serverTimestamp(),
      ratingAudit: plan.audit,
    });
    tx.set(processedRef, {
      processedAt: FieldValue.serverTimestamp(),
      algorithmVersion: plan.audit.algorithmVersion,
      contexts: plan.contexts,
      outcome: "applied",
    });
    return { outcome: "applied", contexts: plan.contexts };
  });
}

// ── Trigger principal ────────────────────────────────────────────────────────
// onDocumentWritten cubre CREATE (sesiones in-club que escriben un match ya
// confirmed) Y UPDATE (jornada sin hardware: pending → confirmed).
exports.onMatchConfirmed = onDocumentWritten(
  { region: REGION, document: "matches/{matchId}" },
  async function (event) {
    const before = (event.data.before && event.data.before.exists) ? event.data.before.data() : {};
    const after = (event.data.after && event.data.after.exists) ? event.data.after.data() : null;
    if (!after) return null; // delete
    const becameConfirmed = before.status !== "confirmed" && after.status === "confirmed";
    if (!becameConfirmed) return null;
    if (after.ratingProcessed === true) return null;
    try {
      const res = await applyRankingTx(event.params.matchId);
      logger.info("[onMatchConfirmed]", { matchId: event.params.matchId, ...res });
    } catch (e) {
      logger.error("[onMatchConfirmed] error", { matchId: event.params.matchId, err: e.message });
      throw e; // deja que el runtime reintente (idempotencia lo protege)
    }
    return null;
  }
);

// ── Expiración de partidos sin confirmar (spec §6.3) ─────────────────────────
exports.expireUnconfirmedMatches = onSchedule(
  { region: REGION, schedule: "every 15 minutes" },
  async function () {
    const nowMs = Date.now();
    const snap = await db.collection("matches")
      .where("status", "==", "pending_confirmation")
      .where("confirmation.expiresAtMs", "<", nowMs)
      .limit(200)
      .get();
    if (snap.empty) return null;
    const batch = db.batch();
    snap.forEach(function (d) {
      batch.update(d.ref, { status: "void", updatedAt: FieldValue.serverTimestamp() });
    });
    await batch.commit();
    logger.info("[expireUnconfirmed] vencidos -> void", { count: snap.size });
    return null;
  }
);

// ── Recompute admin (cambio de algoritmo) — callable ─────────────────────────
exports.recomputeAllRatings = onCall({ region: REGION }, async function (req) {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Login requerido.");
  const adminSnap = await db.collection("users").doc(uid).get();
  if (!adminSnap.exists || !(adminSnap.data().flags && adminSnap.data().flags.isAdmin)) {
    throw new HttpsError("permission-denied", "Solo admin.");
  }
  return recomputeCore();
});

// Núcleo del recompute (sin auth): resetea ratings/ + processedMatches/ y reprocesa
// TODOS los confirmados en orden cronológico. Se usa al cambiar el algoritmo/parámetros.
async function recomputeCore() {
  await deleteCollection("ratings");
  await deleteCollectionGroup("entries"); // leaderboards/{ctx}/entries/{uid}
  await deleteCollection("processedMatches");
  const confirmed = await db.collection("matches")
    .where("status", "==", "confirmed")
    .orderBy("endedAt", "asc")
    .get();
  let applied = 0;
  for (const doc of confirmed.docs) {
    await doc.ref.update({ ratingProcessed: false });
    const res = await applyRankingTx(doc.id);
    if (res.outcome === "applied") applied++;
  }
  return { reprocessed: confirmed.size, applied: applied };
}

async function deleteCollectionGroup(name) {
  const writer = db.bulkWriter();
  let last = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db.collectionGroup(name).orderBy("__name__").limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach(function (d) { writer.delete(d.ref); });
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
  await writer.close();
}

async function deleteCollection(name) {
  const writer = db.bulkWriter();
  let last = null;
  // paginado simple
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db.collection(name).orderBy("__name__").limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach(function (d) { writer.delete(d.ref); });
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
  await writer.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// EN2a — Notificaciones server-side (ADDITIVE). Escriben en
// notifications/{ownerUid}/items/{notifId}. Como escriben en `notifications/`
// (NO en su colección fuente) NO se auto-disparan. Idempotentes (notifId
// determinístico = type+"__"+refId) + limpieza cuando el estado de origen cambia.
// La lógica pura del "set objetivo" vive en ./lib/notify.js (unit-testeada).
// ═══════════════════════════════════════════════════════════════════════════
const notify = require("./lib/notify.js");

function notifItemRef(ownerUid, id) {
  return db.collection("notifications").doc(ownerUid).collection("items").doc(id);
}

// Crear-si-ausente: si ya existe, NO lo reescribe (preserva createdAt/read/readAt).
async function ensureNotif(ownerUid, payload) {
  if (!ownerUid) return;
  const ref = notifItemRef(ownerUid, notify.notifId(payload.type, payload.refId));
  const snap = await ref.get();
  if (snap.exists) return;
  await ref.set(Object.assign({}, payload, {
    createdAt: FieldValue.serverTimestamp(),
    read: false,
    readAt: null,
  }));
}

// Borrar-si-existe (delete de un doc inexistente es un no-op exitoso).
async function removeNotif(ownerUid, type, refId) {
  if (!ownerUid) return;
  await notifItemRef(ownerUid, notify.notifId(type, refId)).delete();
}

// displayName del solicitante para el subtítulo (fallback "Alguien"; cero mojibake).
async function userDisplayName(uid) {
  try {
    const snap = await db.collection("users").doc(uid).get();
    if (snap.exists) {
      const d = snap.data() || {};
      return d.displayName || d.realName || d.handle || "Alguien";
    }
  } catch (e) {
    logger.warn("[notify] userDisplayName error", { uid: uid, err: e.message });
  }
  return "Alguien";
}

// 1) Amistad → friend_request al RECEPTOR (participante != requesterUid).
exports.onFriendshipNotify = onDocumentWritten(
  { region: REGION, document: "friendships/{fid}" },
  async function (event) {
    const fid = event.params.fid;
    const before = (event.data.before && event.data.before.exists) ? event.data.before.data() : null;
    const after = (event.data.after && event.data.after.exists) ? event.data.after.data() : null;
    const data = after || before;
    if (!data) return null;
    const receptor = notify.friendReceptor(data);
    if (!receptor) return null;
    try {
      if (after && after.status === "pending") {
        const name = await userDisplayName(data.requesterUid);
        await ensureNotif(receptor, notify.friendRequestPayload(fid, name));
      } else {
        // accepted / blocked / borrado (reject) → ya no es solicitud pendiente.
        await removeNotif(receptor, "friend_request", fid);
      }
    } catch (e) {
      logger.error("[onFriendshipNotify] error", { fid: fid, err: e.message });
      throw e; // reintento del runtime; ensure/remove son idempotentes.
    }
    return null;
  }
);

// 2) Match → match_confirm a cada rival que falta por confirmar (fan-out).
exports.onMatchNotify = onDocumentWritten(
  { region: REGION, document: "matches/{matchId}" },
  async function (event) {
    const matchId = event.params.matchId;
    const before = (event.data.before && event.data.before.exists) ? event.data.before.data() : null;
    const after = (event.data.after && event.data.after.exists) ? event.data.after.data() : null;
    const match = after || before;
    if (!match) return null;
    // Borrado: el match ya no existe → quitar el match_confirm de TODOS sus players.
    const targets = after
      ? notify.computeMatchTargets(after)
      : { ensure: [], remove: Array.isArray(before.playerUids) ? before.playerUids : [] };
    const regName = notify.registrantName(match);
    try {
      await Promise.all([].concat(
        targets.ensure.map(function (uid) {
          return ensureNotif(uid, notify.matchConfirmPayload(matchId, regName));
        }),
        targets.remove.map(function (uid) {
          return removeNotif(uid, "match_confirm", matchId);
        })
      ));
      // G1-B — cerrar el loop del invitado: si alguien reclamó un slot que era
      // invitado (guestId+ownerUid, sin uid → ahora con uid), marca el guest del
      // DUEÑO como reclamado y avísale. Server-only: el claimer NO puede escribir
      // guests ajenos (lo hace el Admin SDK aquí). Idempotente (merge + ensureNotif).
      const claims = notify.detectGuestClaims(before, after);
      await Promise.all(claims.map(async function (c) {
        try {
          await db.collection("users").doc(c.ownerUid).collection("guests").doc(c.guestId)
            .set({ claimedByUid: c.claimerUid, claimedAt: FieldValue.serverTimestamp() }, { merge: true });
        } catch (_) {}
        return ensureNotif(c.ownerUid, notify.guestClaimedPayload(c.guestId, c.claimerName));
      }));
    } catch (e) {
      logger.error("[onMatchNotify] error", { matchId: matchId, err: e.message });
      throw e;
    }
    return null;
  }
);

// 3) Pulso → clip_ready al creador cuando queda procesado (consumed && !error).
exports.onPulseNotify = onDocumentWritten(
  { region: REGION, document: "pending_pulses/{pulseId}" },
  async function (event) {
    const pulseId = event.params.pulseId;
    const before = (event.data.before && event.data.before.exists) ? event.data.before.data() : null;
    const after = (event.data.after && event.data.after.exists) ? event.data.after.data() : null;
    const data = after || before;
    if (!data) return null;
    const owner = data.uid_creator;
    if (!owner) return null; // pulsos in-club sin creador → no hay a quién avisar.
    try {
      if (after && notify.pulseIsReady(after)) {
        await ensureNotif(owner, notify.clipReadyPayload(pulseId));
      } else {
        // error_reason, aún no consumido, o borrado → quitar el clip_ready.
        await removeNotif(owner, "clip_ready", pulseId);
      }
    } catch (e) {
      logger.error("[onPulseNotify] error", { pulseId: pulseId, err: e.message });
      throw e;
    }
    return null;
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// E7 — LIGAS: tagging server-side + EL LOOP
//
// Decisión LOCKED: 1 liga por partido. El servidor, al confirmar, resuelve a qué
// liga pertenece (≥3 miembros / pareja-vs-pareja) y escribe el tag en el match.
//
// IMPLEMENTACIÓN CONSERVADORA (documentada en el reporte): el tag se escribe en un
// campo DEDICADO `leagueGroupId` (singular, NO un array `leagueIds`), NO en
// `match.groupId`. Razón: `groupId` ya alimenta el contexto Glicko del grupo y lo
// escribe el cliente; sobrescribirlo arriesgaría el ranking existente y un caso en
// que un match es de un grupo genérico Y de una liga distinta. `leagueGroupId`
// respeta "reusar singular / no leagueIds[]" sin tocar el flujo de ranking. Las
// standings (liga.html) consultan `matches where leagueGroupId == {ligaId}`.
// Idempotente: si el tag ya coincide, no reescribe.
// ═══════════════════════════════════════════════════════════════════════════

// Candidatas: ligas (groups type=="liga") que comparten ≥1 jugador del match.
// Una query por uid (array-contains) — barato; dedup por groupId.
async function candidateLeaguesForMatch(match) {
  const uids = leaguesLib.realPlayerUids(match);
  if (!uids.length) return [];
  const seen = {};
  const out = [];
  const snaps = await Promise.all(uids.map(function (uid) {
    return db.collection("groups")
      .where("type", "==", "liga")
      .where("memberUids", "array-contains", uid)
      .get();
  }));
  snaps.forEach(function (snap) {
    snap.forEach(function (d) {
      if (seen[d.id]) return;
      seen[d.id] = true;
      out.push(Object.assign({ groupId: d.id }, d.data()));
    });
  });
  return out;
}

// Lee todos los matches confirmados de una liga (tagged). Para standings server-side.
async function confirmedLeagueMatches(leagueGroupId) {
  const snap = await db.collection("matches")
    .where("leagueGroupId", "==", leagueGroupId)
    .where("status", "==", "confirmed")
    .limit(2000)
    .get();
  const out = [];
  snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
  return out;
}

// displayName de un miembro (subcol members → fallback users → "Alguien").
async function memberName(groupId, uid) {
  try {
    const m = await db.collection("groups").doc(groupId).collection("members").doc(uid).get();
    if (m.exists && m.data().displayName) return notify.firstName(m.data().displayName);
  } catch (e) {}
  return notify.firstName(await userDisplayName(uid));
}

// El "rival inmediato" arriba de `rank` en las filas (clave=uid en individual / pairId).
function rowAtRank(rows, rank) {
  return rows.find(function (r) { return r.rank === rank; }) || null;
}

// Dispara league_rank a cada jugador-miembro del match tras recomputar la tabla.
// Re-crea el notif (borrar+ensure) para refrescar el subtítulo con el dato nuevo.
async function fireLeagueRankNotifs(league, match) {
  const groupId = league.groupId;
  const block = league.league || {};
  const seasonId = block.activeSeasonId || "active";
  const matches = await confirmedLeagueMatches(groupId);
  let seasonStartMs = null, seasonEndMs = null;
  try {
    if (block.activeSeasonId) {
      const s = await db.collection("groups").doc(groupId).collection("seasons").doc(block.activeSeasonId).get();
      if (s.exists) { seasonStartMs = s.data().startMs; seasonEndMs = s.data().endMs; }
    }
  } catch (e) {}
  const table = standings.computeStandings(matches, {
    mode: block.mode, pairs: block.pairs,
    pointsWin: block.pointsWin, pointsLoss: block.pointsLoss,
    period: "season", now: Date.now(),
    seasonStartMs: seasonStartMs, seasonEndMs: seasonEndMs,
  });
  const rows = table.rows;
  if (!rows.length) return;

  // Jugadores del match que son miembros (individual) — a ellos les notificamos.
  const memberSet = {};
  (Array.isArray(league.memberUids) ? league.memberUids : []).forEach(function (u) { memberSet[u] = true; });
  const matchUids = leaguesLib.realPlayerUids(match).filter(function (u) { return memberSet[u]; });

  await Promise.all(matchUids.map(async function (uid) {
    // En modo pairs, la fila del jugador es la de su pareja (key = pairId con su uid).
    const row = rows.find(function (r) {
      return r.key === uid || (Array.isArray(r.uids) && r.uids.indexOf(uid) >= 0);
    });
    if (!row) return;
    const above = (row.rank > 1) ? rowAtRank(rows, row.rank - 1) : null;
    const rivalName = above ? above.name : null;
    const gap = above ? (above.pts - row.pts) : null;
    // pts ganados en ESTE partido: pointsWin si su equipo ganó, si no pointsLoss.
    const won = didMatchWinnerIncludes(match, uid);
    const ptsGained = won ? (Number.isFinite(block.pointsWin) ? block.pointsWin : 3)
                          : (Number.isFinite(block.pointsLoss) ? block.pointsLoss : 0);
    const info = {
      leagueName: league.name || "tu liga",
      rank: row.rank, ptsGained: ptsGained,
      rivalName: rivalName, gap: gap,
    };
    const payload = notify.leagueRankPayload(groupId, seasonId, info);
    // refrescar: borrar el anterior (mismo refId) y recrear con el subtítulo nuevo.
    await removeNotif(uid, "league_rank", payload.refId);
    await ensureNotif(uid, payload);
  }));
}

// ¿el uid pertenece al equipo ganador del match?
function didMatchWinnerIncludes(match, uid) {
  const g = match && match.marcador && match.marcador.ganador;
  const js = Array.isArray(match && match.jugadores) ? match.jugadores : [];
  const j = js.find(function (x) { return x && x.uid === uid; });
  return !!(j && (j.equipo === g));
}

// Trigger de tagging + LOOP: al confirmar un match, resuelve su liga y notifica.
exports.onMatchLeagueTag = onDocumentWritten(
  { region: REGION, document: "matches/{matchId}" },
  async function (event) {
    const matchId = event.params.matchId;
    const before = (event.data.before && event.data.before.exists) ? event.data.before.data() : {};
    const after = (event.data.after && event.data.after.exists) ? event.data.after.data() : null;
    if (!after) return null;
    const becameConfirmed = before.status !== "confirmed" && after.status === "confirmed";
    if (!becameConfirmed) return null;
    try {
      const match = Object.assign({ id: matchId }, after);
      const candidates = await candidateLeaguesForMatch(match);
      // preChosen = groupId del match SI es una liga candidata (el cliente pre-eligió).
      const preChosen = candidates.some(function (c) { return c.groupId === after.groupId; })
        ? after.groupId : null;
      const res = leaguesLib.resolveLeagueGroupId(match, candidates, preChosen);
      const tag = res.groupId || null;

      // Idempotente: solo escribe si cambió.
      if ((after.leagueGroupId || null) !== tag) {
        await db.collection("matches").doc(matchId).update({
          leagueGroupId: tag,
          leagueTaggedAt: FieldValue.serverTimestamp(),
        });
      }
      if (!tag) {
        logger.info("[onMatchLeagueTag] sin liga", { matchId: matchId, reason: res.reason });
        return null;
      }
      const league = candidates.find(function (c) { return c.groupId === tag; });
      if (league) {
        // EL LOOP: recompute + notif de movimiento a los miembros del match.
        // El match recién taggeado ya está en `confirmed`, así que confirmedLeagueMatches
        // lo incluye (la query lee leagueGroupId que acabamos de escribir).
        await fireLeagueRankNotifs(Object.assign({}, league, { groupId: tag }), match);
      }
      logger.info("[onMatchLeagueTag] tagged", { matchId: matchId, leagueGroupId: tag, reason: res.reason });
    } catch (e) {
      logger.error("[onMatchLeagueTag] error", { matchId: matchId, err: e.message });
      throw e; // reintento; idempotente.
    }
    return null;
  }
);

// ── Resumen semanal automático (onSchedule, domingo 19:00 CT) ────────────────
// Itera ligas con actividad en la semana (≥1 match confirmado tagueado en rango)
// y notifica a cada miembro su posición/líder/próximo rival. Cuida costo: salta
// ligas sin actividad reciente.
exports.leagueWeeklyDigest = onSchedule(
  { region: REGION, schedule: "0 19 * * 0", timeZone: "America/Mexico_City" },
  async function () {
    const now = Date.now();
    const weekKey = weekKeyFor(now);
    const leaguesSnap = await db.collection("groups").where("type", "==", "liga").limit(500).get();
    let touched = 0;
    for (const lgDoc of leaguesSnap.docs) {
      const league = Object.assign({ groupId: lgDoc.id }, lgDoc.data());
      const block = league.league || {};
      const matches = await confirmedLeagueMatches(league.groupId);
      // ¿hubo actividad esta semana?
      const wkRange = standings._periodRange("week", now);
      const active = matches.some(function (m) {
        const ms = standings._matchEndMs(m);
        return ms != null && ms >= wkRange.start && ms < wkRange.end;
      });
      if (!active) continue;
      let seasonStartMs = null, seasonEndMs = null;
      if (block.activeSeasonId) {
        try {
          const s = await db.collection("groups").doc(league.groupId).collection("seasons").doc(block.activeSeasonId).get();
          if (s.exists) { seasonStartMs = s.data().startMs; seasonEndMs = s.data().endMs; }
        } catch (e) {}
      }
      const table = standings.computeStandings(matches, {
        mode: block.mode, pairs: block.pairs,
        pointsWin: block.pointsWin, pointsLoss: block.pointsLoss,
        period: "season", now: now, seasonStartMs: seasonStartMs, seasonEndMs: seasonEndMs,
      });
      const rows = table.rows;
      if (!rows.length) continue;
      const leaderName = rows[0] ? rows[0].name : null;
      const members = Array.isArray(league.memberUids) ? league.memberUids : [];
      await Promise.all(members.map(async function (uid) {
        const row = rows.find(function (r) {
          return r.key === uid || (Array.isArray(r.uids) && r.uids.indexOf(uid) >= 0);
        });
        if (!row) return;
        const above = (row.rank > 1) ? rowAtRank(rows, row.rank - 1) : null;
        const info = {
          leagueName: league.name || "tu liga",
          rank: row.rank, leaderName: leaderName,
          nextName: above ? above.name : null,
          gap: above ? (above.pts - row.pts) : null,
          chaserName: (rows[1] ? rows[1].name : null),
        };
        await ensureNotif(uid, notify.leagueWeeklyPayload(league.groupId, weekKey, info));
      }));
      touched++;
    }
    logger.info("[leagueWeeklyDigest] ligas notificadas", { count: touched });
    return null;
  }
);

// Clave de semana ISO-ish (YYYY-Www, lunes) para idempotencia del resumen.
function weekKeyFor(ms) {
  const d = new Date(ms);
  const day = d.getDay();
  const diff = (day === 0) ? 6 : (day - 1);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
  const onejan = new Date(monday.getFullYear(), 0, 1);
  const week = Math.ceil((((monday - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return monday.getFullYear() + "-W" + (week < 10 ? "0" + week : week);
}

// ── Cierre de temporada = EVENTO social (callable admin) ─────────────────────
// Congela la tabla de la temporada, corona al #1 (championRef), notifica a TODOS
// los miembros (season_champion) y ARRANCA la siguiente temporada (loop continuo).
// Server-side (Admin SDK) → protege closed/championRef sin abrir reglas.
exports.closeSeason = onCall({ region: REGION }, async function (req) {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Login requerido.");
  const groupId = req.data && req.data.groupId;
  if (!groupId) throw new HttpsError("invalid-argument", "Falta groupId.");

  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) throw new HttpsError("not-found", "Liga no existe.");
  const group = groupSnap.data();
  if (group.type !== "liga") throw new HttpsError("failed-precondition", "No es una liga.");
  const admins = Array.isArray(group.admins) ? group.admins : [];
  if (admins.indexOf(uid) < 0) throw new HttpsError("permission-denied", "Solo admin.");

  const block = group.league || {};
  const seasonId = (req.data && req.data.seasonId) || block.activeSeasonId;
  if (!seasonId) throw new HttpsError("failed-precondition", "Liga sin temporada activa.");
  const seasonRef = groupRef.collection("seasons").doc(seasonId);
  const seasonSnap = await seasonRef.get();
  if (!seasonSnap.exists) throw new HttpsError("not-found", "Temporada no existe.");
  const season = seasonSnap.data();
  if (season.closed === true) throw new HttpsError("failed-precondition", "Temporada ya cerrada.");

  // 1) Calcular el campeón (tabla de la temporada).
  const matches = await confirmedLeagueMatches(groupId);
  const table = standings.computeStandings(matches, {
    mode: block.mode, pairs: block.pairs,
    pointsWin: block.pointsWin, pointsLoss: block.pointsLoss,
    period: "season", now: Date.now(),
    seasonStartMs: season.startMs, seasonEndMs: season.endMs,
  });
  const champRow = table.rows.length ? table.rows[0] : null;
  const championRef = champRow ? {
    key: champRow.key, name: champRow.name,
    uids: champRow.uids || [], pts: champRow.pts, pj: champRow.pj,
  } : null;

  // 2) Congelar la temporada actual + arrancar la siguiente (loop continuo).
  const nextRef = groupRef.collection("seasons").doc();
  const nextName = (req.data && req.data.nextSeasonName) || nextSeasonName(season.name);
  const batch = db.batch();
  batch.update(seasonRef, {
    closed: true,
    closedAt: FieldValue.serverTimestamp(),
    championRef: championRef,
  });
  batch.set(nextRef, {
    seasonId: nextRef.id, name: nextName,
    startMs: Date.now(), endMs: null, closed: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(groupRef, { "league.activeSeasonId": nextRef.id });
  await batch.commit();

  // 3) season_champion a TODOS los miembros (cada uno sabe si ganó él).
  const members = Array.isArray(group.memberUids) ? group.memberUids : [];
  const champUids = championRef ? (championRef.uids || []) : [];
  await Promise.all(members.map(function (m) {
    const info = {
      leagueName: group.name || "tu liga",
      seasonName: season.name || "la temporada",
      championName: championRef ? championRef.name : "El campeón",
      youAreChampion: champUids.indexOf(m) >= 0,
    };
    return ensureNotif(m, notify.seasonChampionPayload(groupId, seasonId, info));
  }));

  return { ok: true, championRef: championRef, nextSeasonId: nextRef.id };
});

// "Temporada 2026" → "Temporada 2027"; si no hay número, sufija " · 2".
function nextSeasonName(name) {
  const s = String(name || "Temporada");
  const m = s.match(/(\d+)\s*$/);
  if (m) {
    const n = parseInt(m[1], 10) + 1;
    return s.replace(/(\d+)\s*$/, String(n));
  }
  return s + " · 2";
}

// Export para tests de integración (emulador).
exports._applyRankingTx = applyRankingTx;
exports._recomputeCore = recomputeCore;
exports._candidateLeaguesForMatch = candidateLeaguesForMatch;
