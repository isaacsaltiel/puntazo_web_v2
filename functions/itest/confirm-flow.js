/**
 * E2E del flujo COMPLETO de la jornada sin hardware (F2 → F1):
 *   registrar (pending) → un rival confirma → trigger aplica ranking.
 * Usa el MISMO módulo puro que el navegador (assets/match-confirmation.js,
 * export dual) para calcular el patch de confirmación. Solo le falta el wrapper
 * web-SDK (trivial). Valida la composición real.
 *
 * Correr: firebase emulators:exec --only functions,firestore "node itest/confirm-flow.js"
 */
"use strict";
const assert = require("node:assert");
const admin = require("firebase-admin");
const MC = require("../../assets/match-confirmation.js"); // export dual
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "puntazo-clips" });
const db = admin.firestore();
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  const matchId = "e2e-confirm-1";
  const ref = db.collection("matches").doc(matchId);
  const nowMs = Date.now();

  // 1) "register()" — pending_confirmation, registrante (pedro/team1) auto-acepta.
  await ref.set({
    userId: "pedro",
    status: MC.STATUS.PENDING,
    version: 1,
    deporte: "padel", loc: "BreakPoint", modo: "partido_3", sourceMode: "manual",
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { nombre: "Amigo Dummy", equipo: "team1" },           // compañero dummy (sin cuenta)
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
      { uid: "ana", equipo: "team2", nombre: "Ana" },
    ],
    marcador: { sets: [{ team1: 6, team2: 3 }, { team1: 6, team2: 4 }], ganador: "team1" },
    scoreAcceptedBy: { pedro: true },
    confirmation: MC.buildPendingConfirmation("pedro", nowMs, 7),
    ratingProcessed: false,
    endedAt: admin.firestore.Timestamp.fromDate(new Date("2026-06-03T18:00:00Z")),
  });
  await sleep(2000);
  assert.ok(!(await db.collection("ratings").doc("pedro").get()).exists, "pending NO genera ranking");

  // 2) El compañero dummy NO tiene cuenta; un rival (carlos) confirma.
  const snap = await ref.get();
  const match = Object.assign({ id: snap.id }, snap.data());
  const res = MC.computeConfirm(match, "carlos", Date.now());
  assert.ok(res.ok && res.becameConfirmed, "carlos (rival) debe cerrar la confirmación");
  await ref.update(res.patch); // lo que hará el wrapper web-SDK dentro de la tx

  // 3) El trigger debe aplicar ranking a los jugadores CON cuenta (pedro, carlos, ana).
  let pedro = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const s = await db.collection("ratings").doc("pedro").get();
    if (s.exists && s.data().byContext && s.data().byContext["global:padel"]) { pedro = s.data(); break; }
  }
  assert.ok(pedro, "el trigger debió escribir ratings/pedro tras confirmar");
  assert.ok(pedro.byContext["global:padel"].rating > 1500, "pedro (ganó) subió");
  assert.ok(pedro.byContext["club:BreakPoint:padel"], "club local creado");

  const carlos = (await db.collection("ratings").doc("carlos").get()).data();
  assert.ok(carlos.byContext["global:padel"].rating < 1500, "carlos (perdió) bajó");
  // el dummy sin uid NO tiene rating
  const ana = await db.collection("ratings").doc("ana").get();
  assert.ok(ana.exists, "ana (con cuenta) sí tiene rating");

  const m2 = (await ref.get()).data();
  assert.strictEqual(m2.status, "confirmed", "match quedó confirmed");
  assert.strictEqual(m2.ratingProcessed, true, "trigger marcó ratingProcessed");

  console.log("CONFIRM-FLOW-E2E-OK");
}
main().then(function () { process.exit(0); }).catch(function (e) { console.error("CONFIRM-FLOW-FAIL:", e); process.exit(1); });
