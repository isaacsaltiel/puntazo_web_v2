/**
 * Reproduce + valida el fix del bug "insufficient permissions" al agregar un amigo
 * por PRIMERA vez. Causa: sendFriendRequest hace ref.get() ANTES de crear; la regla
 * de read de friendships referencia resource.data.uidA → en un doc INEXISTENTE,
 * resource es null → la regla revienta → permission-denied en el .get().
 *
 * Correr: firebase emulators:exec --only firestore --project puntazo-rules-test "node --test itest/friends-rules.js"
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");

const RULES = fs.readFileSync(path.resolve(__dirname, "..", "..", "firestore.rules"), "utf8");
let env;
const ALICE = "alice", BOB = "bob";
function fid(a, b) { return a < b ? a + "_" + b : b + "_" + a; }
function pendingFriendship(requester, a, b) {
  const uidA = a < b ? a : b, uidB = a < b ? b : a;
  return { friendshipId: fid(a, b), uidA, uidB, status: "pending", requesterUid: requester, createdAt: new Date() };
}

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "puntazo-rules-test", firestore: { rules: RULES } });
});
test.after(async () => { await env.cleanup(); });
test.beforeEach(async () => { await env.clearFirestore(); });

// 1) REPRODUCE EL BUG: get() de un friendship INEXISTENTE → denegado.
test("get() de friendship inexistente → DENIED (reproduce el bug)", async () => {
  const alice = env.authenticatedContext(ALICE).firestore();
  await assertFails(alice.collection("friendships").doc(fid(ALICE, BOB)).get());
});

// 2) Pese al bug del get, el CREATE de la solicitud SÍ está permitido (el fix es
//    cliente: saltarse el get fallido y crear directo).
test("create solicitud pending por primera vez → SUCCEEDS", async () => {
  const alice = env.authenticatedContext(ALICE).firestore();
  await assertSucceeds(alice.collection("friendships").doc(fid(ALICE, BOB)).set(pendingFriendship(ALICE, ALICE, BOB)));
});

// 3) Tras crear, el participante SÍ puede leer (ya existe + es suyo).
test("read del friendship existente por participante → SUCCEEDS", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("friendships").doc(fid(ALICE, BOB)).set(pendingFriendship(ALICE, ALICE, BOB));
  });
  const bob = env.authenticatedContext(BOB).firestore();
  await assertSucceeds(bob.collection("friendships").doc(fid(ALICE, BOB)).get());
});

// 4) El otro participante puede ACEPTAR (update a accepted).
test("aceptar solicitud (update→accepted) por el destinatario → SUCCEEDS", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("friendships").doc(fid(ALICE, BOB)).set(pendingFriendship(ALICE, ALICE, BOB));
  });
  const bob = env.authenticatedContext(BOB).firestore();
  await assertSucceeds(bob.collection("friendships").doc(fid(ALICE, BOB)).update({ status: "accepted", acceptedAt: new Date() }));
});

// 5) Un tercero NO puede crear una amistad entre otros dos.
test("tercero crea amistad ajena → DENIED", async () => {
  const mallory = env.authenticatedContext("mallory").firestore();
  await assertFails(mallory.collection("friendships").doc(fid(ALICE, BOB)).set(pendingFriendship("mallory", ALICE, BOB)));
});
