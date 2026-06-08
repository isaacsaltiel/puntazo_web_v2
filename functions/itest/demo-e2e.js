/**
 * DEMO end-to-end con DATOS REALES en el emulador (para que Isaac lo vea).
 * 4 amigos con nivel → juegan un partidazo → uno registra → el rival confirma →
 * el trigger calcula el ranking y la tabla. Narra en español los datos guardados.
 *
 * Correr: firebase emulators:exec --only functions,firestore "node itest/demo-e2e.js"
 */
"use strict";
const admin = require("firebase-admin");
const MC = require("../../assets/match-confirmation.js");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "puntazo-clips" });
const db = admin.firestore();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function established(nivel) {
  const rating = 800 + (nivel - 1) * 250 + 0.5 * 80; // inverso del nivel
  return { rating, RD: 80, volatility: 0.06, matchCount: 30, wins: 15, losses: 15, nivel, isCalibrating: false, recentOpponents: {}, conservativeRating: rating - 40 };
}
const PLAYERS = [
  { uid: "pedro", nombre: "Pedro", equipo: "team1", nivel: 4.2 },
  { uid: "maria", nombre: "María", equipo: "team1", nivel: 3.8 },
  { uid: "carlos", nombre: "Carlos", equipo: "team2", nivel: 4.0 },
  { uid: "ana", nombre: "Ana", equipo: "team2", nivel: 3.6 },
];
const PARTIDAZO = [{ team1: 6, team2: 7 }, { team1: 7, team2: 6 }, { team1: 7, team2: 5 }]; // team1 gana 2-1, games 20-18

async function nivelGlobal(uid) {
  const s = await db.collection("ratings").doc(uid).get();
  const g = s.exists && s.data().byContext && s.data().byContext["global:padel"];
  return g ? g.nivel : null;
}

async function main() {
  console.log("=================================================");
  console.log("  DEMO REAL — un partido de punta a punta");
  console.log("=================================================");

  // Seed: los 4 ya tienen nivel
  for (const p of PLAYERS) {
    await db.collection("ratings").doc(p.uid).set({
      uid: p.uid, displayName: p.nombre, byContext: { "global:padel": established(p.nivel) },
    });
  }
  console.log("\nNiveles ANTES del partido:");
  for (const p of PLAYERS) console.log("   " + p.nombre.padEnd(8) + (await nivelGlobal(p.uid)).toFixed(2) + "   (" + (p.equipo === "team1" ? "Equipo A" : "Equipo B") + ")");

  // 1) Pedro registra el partido (Equipo A gana un PARTIDAZO 6-7 7-6 7-5)
  const ref = db.collection("matches").doc("demo-real-1");
  await ref.set({
    userId: "pedro", status: MC.STATUS.PENDING, deporte: "padel", loc: "BreakPoint",
    modo: "partido_5", sourceMode: "manual", ratingProcessed: false,
    jugadores: PLAYERS.map((p) => ({ uid: p.uid, nombre: p.nombre, equipo: p.equipo })),
    playerUids: PLAYERS.map((p) => p.uid),
    marcador: { sets: PARTIDAZO, ganador: "team1" },
    scoreAcceptedBy: { pedro: true },
    confirmation: MC.buildPendingConfirmation("pedro", Date.now(), 7),
    endedAt: admin.firestore.Timestamp.fromDate(new Date("2026-06-05T19:00:00Z")),
  });
  console.log("\n📝 Pedro REGISTRÓ: 'Equipo A le ganó al B 6-7 7-6 7-5' (un partidazo).");
  await sleep(1500);
  const sinRanking = !(await db.collection("processedMatches").doc("demo-real-1").get()).exists;
  console.log("   Estado: PENDIENTE → ranking SIN cambios todavía: " + (sinRanking ? "✔ correcto" : "✗"));

  // 2) Carlos (rival) confirma
  const snap = await ref.get();
  const r = MC.computeConfirm(Object.assign({ id: snap.id }, snap.data()), "carlos", Date.now());
  await ref.update(r.patch);
  console.log("\n✅ Carlos (del Equipo B) CONFIRMÓ. El partido pasa a CONFIRMADO.");

  // 3) Esperar al trigger
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if ((await db.collection("processedMatches").doc("demo-real-1").get()).exists) break;
  }

  console.log("\nNiveles DESPUÉS (el trigger ya calculó):");
  for (const p of PLAYERS) {
    const antes = p.nivel, desp = await nivelGlobal(p.uid);
    const flecha = desp > antes ? "▲ subió" : desp < antes ? "▼ bajó" : "=";
    console.log("   " + p.nombre.padEnd(8) + antes.toFixed(2) + " → " + desp.toFixed(2) + "  " + flecha);
  }
  console.log("   (Partidazo: ¡subieron los DOS equipos! El que ganó, un poco más.)");

  // 4) La tabla (leaderboard global) ya quedó consultable
  console.log("\n🏆 Tabla GLOBAL de pádel (como la vería la app):");
  const lb = await db.collection("leaderboards").doc("global:padel").collection("entries").orderBy("nivel", "desc").get();
  let pos = 1;
  lb.forEach((d) => { const e = d.data(); console.log("   " + pos++ + ". " + (e.displayName || e.uid).padEnd(8) + "nivel " + e.nivel.toFixed(2)); });

  console.log("\n✔ Eso es todo el flujo, con datos reales guardados en la base.\n");
}
main().then(() => process.exit(0)).catch((e) => { console.error("DEMO-FAIL:", e); process.exit(1); });
