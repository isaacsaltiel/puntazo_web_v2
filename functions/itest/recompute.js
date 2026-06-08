/**
 * Valida recomputeAllRatings (el reproceso del histórico al cambiar el algoritmo).
 * Crea matches confirmados (el trigger los procesa), guarda el ranking resultante,
 * corre el recompute, y verifica que REPRODUCE el mismo ranking (determinista) y
 * deja los leaderboards consistentes.
 *
 * Correr: firebase emulators:exec --only functions,firestore "node itest/recompute.js"
 */
"use strict";
const assert = require("node:assert");
const idx = require("../index.js");
const admin = require("firebase-admin");
const db = admin.firestore();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POOL = ["ana", "beto", "caro", "dani", "eva", "fede"];
function rndMatch(i) {
  const p = POOL.slice().sort(() => 0.5 - ((i * 7 + 3) % 5) / 5); // orden pseudo-determinista por i
  const four = [p[0], p[1], p[2], p[3]];
  const t1w = i % 2 === 0;
  return {
    userId: four[0], status: "confirmed", deporte: "padel", loc: "BreakPoint", modo: "partido_3",
    jugadores: [
      { uid: four[0], equipo: "team1", nombre: four[0] }, { uid: four[1], equipo: "team1", nombre: four[1] },
      { uid: four[2], equipo: "team2", nombre: four[2] }, { uid: four[3], equipo: "team2", nombre: four[3] },
    ],
    marcador: { sets: [t1w ? { team1: 6, team2: 3 } : { team1: 3, team2: 6 }, t1w ? { team1: 6, team2: 4 } : { team1: 4, team2: 6 }], ganador: t1w ? "team1" : "team2" },
    ratingProcessed: false,
    endedAt: admin.firestore.Timestamp.fromDate(new Date("2026-06-0" + (i + 1) + "T12:00:00Z")),
  };
}

async function snapshotRatings() {
  const out = {};
  const snap = await db.collection("ratings").get();
  snap.forEach((d) => { const g = d.data().byContext && d.data().byContext["global:padel"]; if (g) out[d.id] = Math.round(g.rating * 100) / 100; });
  return out;
}

async function main() {
  // 1) crear 6 matches confirmados; el trigger los procesa
  for (let i = 0; i < 6; i++) await db.collection("matches").doc("rc" + i).set(rndMatch(i));
  // esperar a que el trigger procese todos
  for (let t = 0; t < 50; t++) {
    await sleep(400);
    const proc = await db.collection("processedMatches").get();
    if (proc.size >= 6) break;
  }
  const before = await snapshotRatings();
  assert.ok(Object.keys(before).length >= 5, "se procesaron jugadores antes del recompute");

  // 2) recompute (borra ratings/leaderboards/processedMatches y reprocesa)
  const r = await idx._recomputeCore();
  assert.strictEqual(r.reprocessed, 6, "reprocesó los 6 confirmados");
  assert.ok(r.applied >= 5, "aplicó la mayoría");

  // 3) el ranking reproducido debe ser IGUAL (determinista)
  const after = await snapshotRatings();
  const keys = Object.keys(before);
  let maxDiff = 0;
  keys.forEach((u) => { maxDiff = Math.max(maxDiff, Math.abs((before[u] || 0) - (after[u] || 0))); });
  assert.ok(maxDiff < 0.5, "recompute REPRODUCE el ranking (maxDiff=" + maxDiff.toFixed(2) + ")");

  // 4) leaderboards consistentes con ratings
  const lb = await db.collection("leaderboards").doc("global:padel").collection("entries").get();
  assert.ok(lb.size === keys.length, "leaderboard tiene una entrada por jugador (" + lb.size + ")");

  console.log("RECOMPUTE-OK reprocessed=" + r.reprocessed + " applied=" + r.applied + " maxDiff=" + maxDiff.toFixed(3));
}
main().then(() => process.exit(0)).catch((e) => { console.error("RECOMPUTE-FAIL:", e); process.exit(1); });
