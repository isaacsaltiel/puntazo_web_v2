/**
 * E2E de leaderboards (F5 backend): tras confirmar partidos, las tablas por
 * contexto (global/club/grupo) quedan consultables y ordenables por nivel.
 *
 * Correr: firebase emulators:exec --only functions,firestore "node itest/leaderboard.js"
 */
"use strict";
const assert = require("node:assert");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "puntazo-clips" });
const db = admin.firestore();
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function confirmedMatch(id, ganador, groupId) {
  return {
    userId: "pedro", status: "confirmed", deporte: "padel", loc: "BreakPoint",
    modo: "partido_3", groupId: groupId || null, ratingProcessed: false,
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { uid: "maria", equipo: "team1", nombre: "Maria" },
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
      { uid: "ana", equipo: "team2", nombre: "Ana" },
    ],
    marcador: { sets: [{ team1: 6, team2: ganador === "team1" ? 2 : 6 }, { team1: ganador === "team1" ? 6 : 2, team2: 4 }], ganador: ganador },
    endedAt: admin.firestore.Timestamp.fromDate(new Date("2026-06-0" + id + "T12:00:00Z")),
  };
}

async function waitProcessed(matchId) {
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const p = await db.collection("processedMatches").doc(matchId).get();
    if (p.exists) return true;
  }
  return false;
}

async function main() {
  // dos partidos en el mismo grupo: pedro&maria ganan ambos
  await db.collection("matches").doc("lb1").set(confirmedMatch("1", "team1", "grpLiga"));
  assert.ok(await waitProcessed("lb1"), "lb1 procesado");
  await db.collection("matches").doc("lb2").set(confirmedMatch("2", "team1", "grpLiga"));
  assert.ok(await waitProcessed("lb2"), "lb2 procesado");

  // leaderboard GLOBAL del deporte
  const globalSnap = await db.collection("leaderboards").doc("global:padel")
    .collection("entries").orderBy("nivel", "desc").get();
  assert.ok(globalSnap.size >= 4, "4 jugadores en el leaderboard global");
  const top = globalSnap.docs[0].data();
  assert.ok(["pedro", "maria"].indexOf(top.uid) >= 0, "los ganadores arriba (top=" + top.uid + ")");
  assert.ok(Number.isFinite(top.nivel), "entrada trae nivel");

  // leaderboard del GRUPO (liga)
  const grpSnap = await db.collection("leaderboards").doc("group:grpLiga:padel")
    .collection("entries").orderBy("nivel", "desc").get();
  assert.ok(grpSnap.size >= 4, "leaderboard de grupo poblado");

  // leaderboard del CLUB
  const clubSnap = await db.collection("leaderboards").doc("club:BreakPoint:padel")
    .collection("entries").get();
  assert.ok(clubSnap.size >= 4, "leaderboard de club poblado");

  // consistencia: el nivel de pedro en el leaderboard == el de ratings/pedro
  const lbPedro = (await db.collection("leaderboards").doc("global:padel").collection("entries").doc("pedro").get()).data();
  const rPedro = (await db.collection("ratings").doc("pedro").get()).data().byContext["global:padel"];
  assert.strictEqual(lbPedro.nivel, rPedro.nivel, "leaderboard y ratings consistentes");

  console.log("LEADERBOARD-E2E-OK");
}
main().then(function () { process.exit(0); }).catch(function (e) { console.error("LEADERBOARD-FAIL:", e); process.exit(1); });
