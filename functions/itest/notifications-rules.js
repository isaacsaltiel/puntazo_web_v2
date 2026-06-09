/**
 * EN2a — Tests de la colección notifications/{ownerUid}/items/{notifId}.
 *
 *  (A) REGLAS Firestore (emulador @firebase/rules-unit-testing):
 *      dueño lee ✓ · otro no ✗ · dueño marca read ✓ · dueño cambia title ✗ ·
 *      cliente create ✗ · cliente delete ✗.
 *  (B) LÓGICA PURA del fan-out (sin emulador): computeMatchTargets / friendReceptor /
 *      pulseIsReady / notifId / registrantName — el "set objetivo" que usan los triggers.
 *
 * Correr: firebase emulators:exec --only firestore --project puntazo-rules-test \
 *         "node --test itest/notifications-rules.js"
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const notify = require("../lib/notify.js");

const RULES = fs.readFileSync(path.resolve(__dirname, "..", "..", "firestore.rules"), "utf8");
let env;
const OWNER = "owner", OTHER = "other";

function notifDoc() {
  return {
    type: "friend_request", refId: "f1",
    icon: "🤝", title: "Te mandó solicitud de amistad", subtitle: "Alguien",
    href: "/amigos.html", createdAt: new Date(), read: false, readAt: null,
  };
}
function itemRef(ctx, owner, id) {
  return ctx.firestore().collection("notifications").doc(owner).collection("items").doc(id);
}
async function seed(owner, id, doc) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("notifications").doc(owner).collection("items").doc(id).set(doc);
  });
}

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "puntazo-rules-test", firestore: { rules: RULES } });
});
test.after(async () => { await env.cleanup(); });
test.beforeEach(async () => { await env.clearFirestore(); });

// ── (A) REGLAS ──────────────────────────────────────────────────────────────
test("dueño LEE sus notifs → SUCCEEDS", async () => {
  await seed(OWNER, "n1", notifDoc());
  const owner = env.authenticatedContext(OWNER);
  await assertSucceeds(itemRef(owner, OWNER, "n1").get());
});

test("otro usuario NO lee notifs ajenas → DENIED", async () => {
  await seed(OWNER, "n1", notifDoc());
  const other = env.authenticatedContext(OTHER);
  await assertFails(itemRef(other, OWNER, "n1").get());
});

test("dueño marca read:true/readAt → SUCCEEDS", async () => {
  await seed(OWNER, "n1", notifDoc());
  const owner = env.authenticatedContext(OWNER);
  await assertSucceeds(itemRef(owner, OWNER, "n1").update({ read: true, readAt: new Date() }));
});

test("dueño intenta cambiar title → DENIED (sólo read/readAt)", async () => {
  await seed(OWNER, "n1", notifDoc());
  const owner = env.authenticatedContext(OWNER);
  await assertFails(itemRef(owner, OWNER, "n1").update({ title: "hackeado" }));
});

test("otro usuario marca read en notif ajena → DENIED", async () => {
  await seed(OWNER, "n1", notifDoc());
  const other = env.authenticatedContext(OTHER);
  await assertFails(itemRef(other, OWNER, "n1").update({ read: true }));
});

test("cliente CREATE un notif → DENIED (sólo Admin SDK)", async () => {
  const owner = env.authenticatedContext(OWNER);
  await assertFails(itemRef(owner, OWNER, "n2").set(notifDoc()));
});

test("cliente DELETE un notif → DENIED (sólo Admin SDK)", async () => {
  await seed(OWNER, "n1", notifDoc());
  const owner = env.authenticatedContext(OWNER);
  await assertFails(itemRef(owner, OWNER, "n1").delete());
});

// ── (B) LÓGICA PURA del fan-out (sin emulador) ───────────────────────────────
test("computeMatchTargets: pending → ensure rivales sin aceptar; remove registrante+aceptados", () => {
  const match = {
    status: "pending_confirmation", userId: "pedro",
    playerUids: ["pedro", "carlos", "diana"],
    scoreAcceptedBy: { pedro: true, carlos: true },
  };
  const t = notify.computeMatchTargets(match);
  assert.deepStrictEqual(t.ensure, ["diana"]);
  assert.deepStrictEqual(t.remove.slice().sort(), ["carlos", "pedro"]);
});

test("computeMatchTargets: status != pending → remove TODOS", () => {
  const t = notify.computeMatchTargets({ status: "confirmed", userId: "pedro", playerUids: ["pedro", "carlos"] });
  assert.deepStrictEqual(t.ensure, []);
  assert.deepStrictEqual(t.remove, ["pedro", "carlos"]);
});

test("friendReceptor: el receptor es el participante que NO mandó la solicitud", () => {
  assert.strictEqual(notify.friendReceptor({ uidA: "a", uidB: "b", requesterUid: "a" }), "b");
  assert.strictEqual(notify.friendReceptor({ uidA: "a", uidB: "b", requesterUid: "b" }), "a");
  assert.strictEqual(notify.friendReceptor({ uidA: "a", uidB: "b", requesterUid: "z" }), null);
});

test("pulseIsReady: consumed_at && !error_reason", () => {
  assert.strictEqual(notify.pulseIsReady({ consumed_at: 123 }), true);
  assert.strictEqual(notify.pulseIsReady({ consumed_at: 123, error_reason: "x" }), false);
  assert.strictEqual(notify.pulseIsReady({ consumed_at: null }), false);
  assert.strictEqual(notify.pulseIsReady(null), false);
});

test("notifId determinístico = type__refId", () => {
  assert.strictEqual(notify.notifId("friend_request", "f1"), "friend_request__f1");
  assert.strictEqual(notify.notifId("match_confirm", "m9"), "match_confirm__m9");
});

test("registrantName: primer nombre del registrante; fallback Alguien", () => {
  assert.strictEqual(notify.registrantName({ userId: "p", jugadores: [{ uid: "p", nombre: "Pedro Pérez" }] }), "Pedro");
  assert.strictEqual(notify.registrantName({ userId: "p", jugadores: [] }), "Alguien");
});
