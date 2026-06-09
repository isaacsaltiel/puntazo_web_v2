/**
 * E6 — Reglas de `groups/{groupId}/seasons/{seasonId}` (temporadas de liga).
 * Invariante: lectura para cualquier signedIn; create/update/delete SOLO admin del grupo.
 *
 * Correr SOLA (mata 8080 antes):
 *   firebase emulators:exec --only firestore --project puntazo-rules-test "node --test itest/leagues-rules.js"
 */
"use strict";
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");

const RULES = fs.readFileSync(path.resolve(__dirname, "..", "..", "firestore.rules"), "utf8");
let env;
const ADMIN = "admin_uid", MEMBER = "member_uid", OUTSIDER = "outsider_uid";
const GID = "liga_test";

function groupDoc() {
  return {
    groupId: GID, name: "Liga Test", type: "liga",
    creatorUid: ADMIN, admins: [ADMIN], memberCount: 2, matchCount: 0,
    isPublic: false, inviteCode: "abc123", createdAt: new Date(),
    league: { mode: "individual", sport: "padel", pointsWin: 3, pointsLoss: 0, countThreshold: 3, activeSeasonId: "s1" },
  };
}
function seasonDoc(id) {
  return { seasonId: id, name: "Temporada 1", startMs: 0, endMs: 1000, closed: false, createdAt: new Date() };
}

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "puntazo-rules-test", firestore: { rules: RULES } });
});
test.after(async () => { await env.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await d.collection("groups").doc(GID).set(groupDoc());
    await d.collection("groups").doc(GID).collection("members").doc(ADMIN).set({ uid: ADMIN, role: "admin" });
    await d.collection("groups").doc(GID).collection("members").doc(MEMBER).set({ uid: MEMBER, role: "member" });
    await d.collection("groups").doc(GID).collection("seasons").doc("s1").set(seasonDoc("s1"));
  });
});

function seasons(uid) {
  return env.authenticatedContext(uid).firestore().collection("groups").doc(GID).collection("seasons");
}

test("admin crea season → SUCCEEDS", async () => {
  await assertSucceeds(seasons(ADMIN).doc("s2").set(seasonDoc("s2")));
});

test("admin edita season → SUCCEEDS", async () => {
  await assertSucceeds(seasons(ADMIN).doc("s1").update({ closed: true }));
});

test("admin borra season → SUCCEEDS", async () => {
  await assertSucceeds(seasons(ADMIN).doc("s1").delete());
});

test("member (no-admin) crea season → DENIED", async () => {
  await assertFails(seasons(MEMBER).doc("s3").set(seasonDoc("s3")));
});

test("member (no-admin) edita season → DENIED", async () => {
  await assertFails(seasons(MEMBER).doc("s1").update({ closed: true }));
});

test("outsider crea season → DENIED", async () => {
  await assertFails(seasons(OUTSIDER).doc("s4").set(seasonDoc("s4")));
});

test("member lee season → SUCCEEDS", async () => {
  await assertSucceeds(seasons(MEMBER).doc("s1").get());
});

test("outsider (signedIn) lee season → SUCCEEDS", async () => {
  await assertSucceeds(seasons(OUTSIDER).doc("s1").get());
});
