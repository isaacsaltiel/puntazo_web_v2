/**
 * E7 · Fase 0 — BACKFILL de `memberUids` (array espejo) en grupos/ligas existentes.
 *
 * Rellena `groups/{groupId}.memberUids` desde la subcolección `members` para los
 * docs creados ANTES de que groups.js empezara a mantener el array. Necesario para
 * el heurístico ≥3 server-side de E7 y para las reglas de self-join.
 *
 * ⚠️ NO LO CORRE EL WORKER. Lo corre el MAESTRO con el Admin SDK (credencial en
 *    C:\Users\Isaac\.puntazo-secrets\service_account.json), tras revisar el código.
 *
 * Es IDEMPOTENTE y NO DESTRUCTIVO: solo escribe `memberUids` (y opcionalmente
 * `memberCount` derivado). No borra ni toca otros campos. Re-correrlo es seguro.
 *
 * Uso (maestro):
 *   GOOGLE_APPLICATION_CREDENTIALS="C:\\Users\\Isaac\\.puntazo-secrets\\service_account.json" \
 *   node functions/_backfillMemberUids.js              # dry-run (default)
 *   ... node functions/_backfillMemberUids.js --apply  # escribe de verdad
 */
"use strict";
const admin = require("firebase-admin");

const APPLY = process.argv.indexOf("--apply") >= 0;

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "puntazo-clips" });
const db = admin.firestore();

async function main() {
  const groups = await db.collection("groups").get();
  let scanned = 0, toUpdate = 0, updated = 0;
  for (const g of groups.docs) {
    scanned++;
    const data = g.data() || {};
    const membersSnap = await g.ref.collection("members").get();
    const uids = [];
    membersSnap.forEach(function (m) {
      const uid = (m.data() && m.data().uid) || m.id;
      if (uid && uids.indexOf(uid) < 0) uids.push(uid);
    });
    uids.sort();

    const current = Array.isArray(data.memberUids) ? data.memberUids.slice().sort() : null;
    const same = current && current.length === uids.length &&
      current.every(function (v, i) { return v === uids[i]; });
    if (same) continue;

    toUpdate++;
    console.log("[backfill]", g.id,
      "members=", uids.length,
      "memberUids actual=", current ? current.length : "(ausente)",
      APPLY ? "→ ESCRIBIENDO" : "→ (dry-run)");

    if (APPLY) {
      await g.ref.update({
        memberUids: uids,
        memberCount: uids.length, // re-derivado del set real (corrige desincronizaciones).
      });
      updated++;
    }
  }
  console.log("[backfill] DONE", { scanned: scanned, needUpdate: toUpdate, updated: updated, apply: APPLY });
}

main().then(function () { process.exit(0); }).catch(function (e) {
  console.error("[backfill] ERROR", e);
  process.exit(1);
});
