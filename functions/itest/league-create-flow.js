/* Decisive check: ¿la regla de seasons.create permite crear la season cuando el GRUPO
   todavía NO existe? Ese es el estado que ve la regla a mitad del batch de createGroup
   (get() en rules NO ve escrituras pendientes del mismo batch). Si esto FALLA, crear una
   liga revienta en prod. */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");

const RULES = fs.readFileSync(path.resolve(__dirname, "..", "..", "firestore.rules"), "utf8");
let env;
const ME = "creator_uid";
const GID = "liga_nueva";

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "puntazo-league-create", firestore: { rules: RULES } });
});
test.after(async () => { await env.cleanup(); });
test.beforeEach(async () => { await env.clearFirestore(); });

// Caso A: grupo NO existe (estado a mitad del batch). La regla DEBE denegar → por eso
// createGroup crea la temporada en un 2º paso, NO en el mismo batch que el grupo.
test("season.create con grupo INEXISTENTE (estado mid-batch) → DENIED", async () => {
  const d = env.authenticatedContext(ME).firestore();
  const ref = d.collection("groups").doc(GID).collection("seasons").doc("s1");
  await assertFails(ref.set({ seasonId: "s1", name: "T1", startMs: 0, endMs: 1, closed: false, createdAt: new Date() }));
});

// Caso B (control): grupo SÍ existe y soy admin → debe permitir (ya cubierto, sanity).
test("season.create con grupo existente y soy admin → permitido (control)", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("groups").doc(GID).set({
      groupId: GID, type: "liga", creatorUid: ME, admins: [ME], createdAt: new Date(),
    });
  });
  const d = env.authenticatedContext(ME).firestore();
  const ref = d.collection("groups").doc(GID).collection("seasons").doc("s2");
  await assertSucceeds(ref.set({ seasonId: "s2", name: "T2", startMs: 0, endMs: 1, closed: false, createdAt: new Date() }));
});
