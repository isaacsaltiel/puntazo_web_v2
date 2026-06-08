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

// Export para tests de integración (emulador).
exports._applyRankingTx = applyRankingTx;
exports._recomputeCore = recomputeCore;
