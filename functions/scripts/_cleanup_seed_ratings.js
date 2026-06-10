"use strict";
/* Parte 2 del nivel (decisión 2026-06-08, ejecutada 10-jun a petición de Isaac:
   "salgo como gabo y aparecen dummies"): borra el ranking SEMILLA/demo.
   Solo datos DERIVADOS (ratings/leaderboards/processedMatches se regeneran al
   confirmar partidos reales). NO toca matches/ ni users/. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || "C:\\Users\\Isaac\\.puntazo-secrets\\service_account.json";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

(async () => {
  const entries = await db.collection("leaderboards").doc("global:padel").collection("entries").get();
  const ratings = await db.collection("ratings").get();
  const batch = db.batch();
  let n = 0;
  entries.forEach(d => { console.log("DEL entry ", d.id, JSON.stringify(d.data().displayName)); batch.delete(d.ref); n++; });
  ratings.forEach(d => { console.log("DEL rating", d.id, JSON.stringify(d.data().displayName)); batch.delete(d.ref); n++; });
  if (!n) { console.log("Nada que borrar."); return; }
  await batch.commit();
  console.log(`OK — ${n} docs derivados borrados. El tablero se repobla solo con partidos confirmados reales.`);
})().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
