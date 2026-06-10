"use strict";
/* DRY-RUN (solo lectura): radiografía de ratings/ + leaderboard global vs
   matches confirmados y users reales. Para decidir el recompute (Parte 2). */
const path = require("path");
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || "C:\\Users\\Isaac\\.puntazo-secrets\\service_account.json";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

(async () => {
  const [ratings, entries, users, confirmed, processed] = await Promise.all([
    db.collection("ratings").get(),
    db.collection("leaderboards").doc("global:padel").collection("entries").get(),
    db.collection("users").get(),
    db.collection("matches").where("status", "==", "confirmed").get(),
    db.collection("processedMatches").get(),
  ]);
  const userIds = new Set(users.docs.map(d => d.id));
  const confUids = new Set();
  confirmed.forEach(d => (d.data().playerUids || []).forEach(u => u && confUids.add(u)));

  console.log(`ratings: ${ratings.size} · leaderboard global entries: ${entries.size} · users: ${users.size} · matches confirmed: ${confirmed.size} · processedMatches: ${processed.size}`);
  console.log("\n— Entradas del leaderboard global —");
  entries.forEach(d => {
    const e = d.data();
    const flags = [];
    if (!userIds.has(d.id)) flags.push("SIN users doc");
    if (!confUids.has(d.id)) flags.push("SIN partido confirmado actual");
    console.log(`  ${d.id.slice(0, 10)}…  "${e.displayName}"  nivel=${(e.nivel || 0).toFixed(2)} ${e.matchCount || 0}p  ${flags.length ? "⚠️ " + flags.join(" + ") : "ok"}`);
  });
  console.log("\n— ratings sin entrada coherente —");
  ratings.forEach(d => {
    if (!confUids.has(d.id)) console.log(`  ratings/${d.id.slice(0, 14)}… "${(d.data().displayName) || "?"}" ⚠️ uid sin confirmados actuales`);
  });
})().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
