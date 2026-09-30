/**
 * (2026-09-30) Reglas de me gusta + conteo de guardados (assets/reacciones.js).
 * Invariante: clip_stats solo sube / baja de 1 en 1 y solo en el mismo lote
 * en que se crea / borra el me gusta o el guardado de quien escribe.
 *
 * Correr SOLA (mata 8080 antes):
 *   firebase emulators:exec --only firestore --project puntazo-rules-test "node --test itest/reacciones-rules.js"
 */
"use strict";
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");

const RULES = fs.readFileSync(path.resolve(__dirname, "..", "..", "firestore.rules"), "utf8");
const V = "BreakPoint_Cancha1_LadoA_20260930120000.mp4";
let env;

function inc(n) { return require("firebase/compat/app").default.firestore.FieldValue.increment(n); }

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "puntazo-rules-test", firestore: { rules: RULES } });
});
test.after(async () => { await env.cleanup(); });
test.beforeEach(async () => { await env.clearFirestore(); });

function dbDe(uid) { return env.authenticatedContext(uid).firestore(); }
function like(db, uid) { return db.collection("clip_likes").doc(V).collection("likers").doc(uid); }
function stats(db) { return db.collection("clip_stats").doc(V); }
function guardado(db, uid) { return db.collection("usuarios").doc(uid).collection("guardados").doc(V); }
const TS = () => require("firebase/compat/app").default.firestore.FieldValue.serverTimestamp();

async function darLike(db, uid) {
  const b = db.batch();
  b.set(like(db, uid), { uid, at: TS() });
  b.set(stats(db), { likes: inc(1) }, { merge: true });
  return b.commit();
}
async function quitarLike(db, uid) {
  const b = db.batch();
  b.delete(like(db, uid));
  b.set(stats(db), { likes: inc(-1) }, { merge: true });
  return b.commit();
}

test("me gusta: dar, contar, quitar", async () => {
  const a = dbDe("ana"), b = dbDe("beto");
  await assertSucceeds(darLike(a, "ana"));
  await assertSucceeds(darLike(b, "beto"));
  let s; await env.withSecurityRulesDisabled(async c => { s = await c.firestore().collection("clip_stats").doc(V).get(); });
  if (s.data().likes !== 2) throw new Error("likes=" + s.data().likes);
  await assertSucceeds(quitarLike(a, "ana"));
  await assertSucceeds(env.unauthenticatedContext().firestore().collection("clip_stats").doc(V).get());   // lectura pública
});

test("no se puede dar dos veces ni inflar", async () => {
  const a = dbDe("ana");
  await assertSucceeds(darLike(a, "ana"));
  await assertFails(darLike(a, "ana"));                                          // ya existía
  await assertFails(stats(a).set({ likes: inc(1) }, { merge: true }));           // sin me gusta nuevo
  await assertFails(stats(a).set({ likes: 50 }, { merge: true }));
  const b = a.batch();                                                            // +2 con un solo me gusta
  b.set(like(a, "otro"), { uid: "otro", at: TS() });
  b.set(stats(a), { likes: inc(2) }, { merge: true });
  await assertFails(b.commit());
  await assertFails(env.unauthenticatedContext().firestore().collection("clip_stats").doc(V).set({ likes: 1 }));
});

test("el me gusta es de quien lo da", async () => {
  const a = dbDe("ana");
  await assertFails(like(a, "beto").set({ uid: "beto", at: TS() }));
  await assertFails(like(a, "ana").set({ uid: "beto", at: TS() }));
  await assertSucceeds(darLike(a, "ana"));
  await assertFails(dbDe("beto").collection("clip_likes").doc(V).collection("likers").doc("ana").get());
  await assertFails(dbDe("beto").collection("clip_likes").doc(V).collection("likers").doc("ana").delete());
});

test("quitar sin haber dado no baja el contador", async () => {
  const a = dbDe("ana");
  await assertSucceeds(darLike(dbDe("beto"), "beto"));
  await assertFails(quitarLike(a, "ana"));
});

test("guardados: contar al guardar y al quitar", async () => {
  const a = dbDe("ana");
  let b = a.batch();
  b.set(guardado(a, "ana"), { videoId: V, nombreArchivo: V }, { merge: true });
  b.set(stats(a), { guardados: inc(1) }, { merge: true });
  await assertSucceeds(b.commit());
  // Volver a guardar lo ya guardado no cuenta (el cliente cae al set normal).
  b = a.batch();
  b.set(guardado(a, "ana"), { videoId: V }, { merge: true });
  b.set(stats(a), { guardados: inc(1) }, { merge: true });
  await assertFails(b.commit());
  await assertSucceeds(guardado(a, "ana").set({ videoId: V }, { merge: true }));
  b = a.batch();
  b.delete(guardado(a, "ana"));
  b.set(stats(a), { guardados: inc(-1) }, { merge: true });
  await assertSucceeds(b.commit());
  // Nunca negativo
  await assertSucceeds(guardado(a, "ana").set({ videoId: V }));
  b = a.batch();
  b.delete(guardado(a, "ana"));
  b.set(stats(a), { guardados: inc(-1) }, { merge: true });
  await assertFails(b.commit());
});

test("likes y guardados en el mismo doc sin pisarse", async () => {
  const a = dbDe("ana");
  await assertSucceeds(darLike(a, "ana"));
  const b = a.batch();
  b.set(guardado(a, "ana"), { videoId: V }, { merge: true });
  b.set(stats(a), { guardados: inc(1) }, { merge: true });
  await assertSucceeds(b.commit());
  let s; await env.withSecurityRulesDisabled(async c => { s = await c.firestore().collection("clip_stats").doc(V).get(); });
  if (s.data().likes !== 1 || s.data().guardados !== 1) throw new Error(JSON.stringify(s.data()));
});
