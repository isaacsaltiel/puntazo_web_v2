/**
 * Test de INTEGRACIÓN contra el emulador de Firestore (spec §6.2).
 * Valida lo que los unit tests no pueden: la idempotencia transaccional real.
 *
 * Correr:  firebase emulators:exec --only firestore "node test/integration-idempotency.js"
 * (la CLI inyecta FIRESTORE_EMULATOR_HOST y GCLOUD_PROJECT)
 */
"use strict";
const assert = require("node:assert");
const idx = require("../index.js"); // initializeApp() + _applyRankingTx
const admin = require("firebase-admin");
const db = admin.firestore();

const MATCH = {
  userId: "pedro",
  status: "confirmed",
  deporte: "padel",
  loc: "BreakPoint",
  modo: "partido_3",
  jugadores: [
    { uid: "pedro", equipo: "team1", nombre: "Pedro" },
    { uid: "maria", equipo: "team1", nombre: "Maria" },
    { uid: "carlos", equipo: "team2", nombre: "Carlos" },
    { uid: "ana", equipo: "team2", nombre: "Ana" },
  ],
  marcador: { sets: [{ team1: 6, team2: 4 }, { team1: 6, team2: 3 }], ganador: "team1" },
  ratingProcessed: false,
};

async function main() {
  const matchId = "itest-idem-1";
  await db.collection("matches").doc(matchId).set(
    Object.assign({}, MATCH, { endedAt: admin.firestore.Timestamp.fromDate(new Date("2026-06-01T12:00:00Z")) })
  );

  // 1ª aplicación
  const r1 = await idx._applyRankingTx(matchId);
  assert.strictEqual(r1.outcome, "applied", "1ª debe aplicar");
  const pedro1 = (await db.collection("ratings").doc("pedro").get()).data();
  assert.ok(pedro1.byContext["global:padel"], "global escrito");
  assert.ok(pedro1.byContext["club:BreakPoint:padel"], "club escrito (lazy)");
  const gRating1 = pedro1.byContext["global:padel"].rating;
  const gCount1 = pedro1.byContext["global:padel"].matchCount;
  assert.strictEqual(gCount1, 1, "matchCount=1 tras 1 partido");
  assert.ok(gRating1 > 1500, "pedro subió");

  // processedMatches creado
  const proc = await db.collection("processedMatches").doc(matchId).get();
  assert.ok(proc.exists && proc.data().outcome === "applied", "processedMatches=applied");
  // match marcado
  const m1 = (await db.collection("matches").doc(matchId).get()).data();
  assert.strictEqual(m1.ratingProcessed, true, "match.ratingProcessed=true");

  // 2ª aplicación (reintento) → idempotente, NO duplica
  const r2 = await idx._applyRankingTx(matchId);
  assert.strictEqual(r2.outcome, "skipped-idempotent", "2ª debe ser skip idempotente");
  const pedro2 = (await db.collection("ratings").doc("pedro").get()).data();
  assert.strictEqual(pedro2.byContext["global:padel"].rating, gRating1, "rating NO cambió (no doble-apply)");
  assert.strictEqual(pedro2.byContext["global:padel"].matchCount, 1, "matchCount sigue en 1");

  // 3ª: aunque forzemos ratingProcessed=false, el guard de processedMatches lo frena
  await db.collection("matches").doc(matchId).update({ ratingProcessed: false });
  const r3 = await idx._applyRankingTx(matchId);
  assert.strictEqual(r3.outcome, "skipped-idempotent", "processedMatches frena reproceso");

  // Perdedor bajó, en ambos contextos
  const carlos = (await db.collection("ratings").doc("carlos").get()).data();
  assert.ok(carlos.byContext["global:padel"].rating < 1500, "carlos bajó global");
  assert.ok(carlos.byContext["club:BreakPoint:padel"].rating < 1500, "carlos bajó club");

  console.log("INTEGRATION-IDEMPOTENCY-OK");
}

main().then(function () { process.exit(0); }).catch(function (e) { console.error("INTEGRATION-FAIL:", e); process.exit(1); });
