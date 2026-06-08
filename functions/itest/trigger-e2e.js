/**
 * E2E del TRIGGER onMatchConfirmed contra emuladores functions+firestore.
 * Siembra un match pending, lo flota a "confirmed", y verifica que el trigger
 * escriba ratings/ por su cuenta (sin llamar la lógica directamente).
 *
 * Correr: firebase emulators:exec --only functions,firestore "node itest/trigger-e2e.js"
 */
"use strict";
const assert = require("node:assert");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "puntazo-clips" });
const db = admin.firestore();

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  const matchId = "e2e-trigger-1";
  const ref = db.collection("matches").doc(matchId);

  // 1) match pending (aún no debe tocar ranking)
  await ref.set({
    userId: "luis",
    status: "pending_confirmation",
    deporte: "padel",
    loc: "BreakPoint",
    modo: "partido_3",
    jugadores: [
      { uid: "luis", equipo: "team1", nombre: "Luis" },
      { uid: "sara", equipo: "team1", nombre: "Sara" },
      { uid: "diego", equipo: "team2", nombre: "Diego" },
      { uid: "nora", equipo: "team2", nombre: "Nora" },
    ],
    marcador: { sets: [{ team1: 6, team2: 2 }, { team1: 6, team2: 4 }], ganador: "team1" },
    endedAt: admin.firestore.Timestamp.fromDate(new Date("2026-06-02T10:00:00Z")),
    ratingProcessed: false,
  });
  await sleep(2500);
  const noneYet = await db.collection("ratings").doc("luis").get();
  assert.ok(!noneYet.exists, "pending NO debe generar ranking");

  // 2) flota a confirmed → el trigger debe disparar
  await ref.update({ status: "confirmed", updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  // 3) poll hasta 20s
  let luis = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const s = await db.collection("ratings").doc("luis").get();
    if (s.exists && s.data().byContext && s.data().byContext["global:padel"]) { luis = s.data(); break; }
  }
  assert.ok(luis, "el trigger debió escribir ratings/luis");
  assert.ok(luis.byContext["global:padel"].rating > 1500, "luis (ganó) subió");
  assert.ok(luis.byContext["club:BreakPoint:padel"], "club local creado");
  const proc = await db.collection("processedMatches").doc(matchId).get();
  assert.ok(proc.exists, "processedMatches creado por el trigger");

  console.log("TRIGGER-E2E-OK");
}
main().then(function () { process.exit(0); }).catch(function (e) { console.error("TRIGGER-E2E-FAIL:", e); process.exit(1); });
