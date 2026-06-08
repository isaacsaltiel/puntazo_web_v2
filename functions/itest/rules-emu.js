/**
 * Tests de REGLAS Firestore (firestore.rules) con @firebase/rules-unit-testing.
 * Valida la superficie de seguridad del sistema de ranking/confirmación.
 *
 * Correr: firebase emulators:exec --only firestore "node --test itest/rules.test.js"
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

const RULES = fs.readFileSync(path.resolve(__dirname, "..", "..", "firestore.rules"), "utf8");
let env;

function pendingMatchDoc() {
  return {
    userId: "pedro",
    status: "pending_confirmation",
    version: 1,
    deporte: "padel", loc: "BreakPoint", modo: "partido_3", sourceMode: "manual",
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
    ],
    playerUids: ["pedro", "carlos"],
    marcador: { sets: [{ team1: 6, team2: 3 }], ganador: "team1" },
    scoreAcceptedBy: { pedro: true },
    confirmation: { required: true, registeredBy: "pedro", confirmedByUid: null, expiresAtMs: 9e15 },
    ratingProcessed: false,
  };
}

// Pending con 2 reales (pedro/carlos) + 2 dummies (slots reclamables). E3a.
function pendingMatchWithDummyDoc() {
  return {
    userId: "pedro",
    status: "pending_confirmation",
    version: 1,
    deporte: "padel", loc: "BreakPoint", modo: "partido_3", sourceMode: "manual",
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { nombre: "Gabo", equipo: "team1", guestId: "g1", ownerUid: "pedro", uid: null },
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
      { nombre: "Invitado", equipo: "team2", guestId: "g2", ownerUid: "pedro", uid: null },
    ],
    playerUids: ["pedro", "carlos"],
    marcador: { sets: [{ team1: 6, team2: 3 }], ganador: "team1" },
    scoreAcceptedBy: { pedro: true },
    confirmation: { required: true, registeredBy: "pedro", confirmedByUid: null, expiresAtMs: 9e15 },
    ratingProcessed: false,
  };
}

// Pending con 3 reales (pedro registrante + bruno compañero + carlos rival). E3a decline.
function pendingMatchTrioDoc() {
  return {
    userId: "pedro",
    status: "pending_confirmation",
    version: 1,
    deporte: "padel", loc: "BreakPoint", modo: "partido_3", sourceMode: "manual",
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { uid: "bruno", equipo: "team1", nombre: "Bruno" },
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
    ],
    playerUids: ["pedro", "bruno", "carlos"],
    marcador: { sets: [{ team1: 6, team2: 3 }], ganador: "team1" },
    scoreAcceptedBy: { pedro: true },
    confirmation: { required: true, registeredBy: "pedro", confirmedByUid: null, expiresAtMs: 9e15 },
    ratingProcessed: false,
  };
}

function activeMatchDoc(now) {
  return {
    userId: "pedro",
    status: "active",
    loc: "BreakPoint", can: "1", lado: "A",
    jugadores: [{ uid: "pedro", equipo: "team1", nombre: "Pedro" }],
    startedAt: now, createdAt: now,
    endedAt: null, // matches.js lo escribe como null al crear; la regla v100 lo lee
  };
}

test("setup", async () => {
  env = await initializeTestEnvironment({
    projectId: "puntazo-rules-test",
    firestore: { rules: RULES },
  });
});

test("ratings: signedIn lee, nadie escribe desde cliente; unauth no lee", async () => {
  // sembrar con contexto privilegiado (omite reglas)
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("ratings").doc("pedro").set({ uid: "pedro", byContext: {} });
  });
  const auth = env.authenticatedContext("alguien").firestore();
  const unauth = env.unauthenticatedContext().firestore();
  await assertSucceeds(auth.collection("ratings").doc("pedro").get());
  await assertFails(unauth.collection("ratings").doc("pedro").get());
  await assertFails(auth.collection("ratings").doc("pedro").set({ hacked: true }, { merge: true }));
});

test("processedMatches: cliente no lee ni escribe", async () => {
  const auth = env.authenticatedContext("pedro").firestore();
  await assertFails(auth.collection("processedMatches").doc("m1").get());
  await assertFails(auth.collection("processedMatches").doc("m1").set({ x: 1 }));
});

test("matches create: solo el dueño con su userId", async () => {
  const pedro = env.authenticatedContext("pedro").firestore();
  const otro = env.authenticatedContext("mallory").firestore();
  await assertSucceeds(pedro.collection("matches").doc("c1").set(pendingMatchDoc()));
  // mallory intenta crear un match a nombre de pedro
  await assertFails(otro.collection("matches").doc("c2").set(pendingMatchDoc()));
});

test("matches update: un RIVAL confirma (campos acotados) ✓", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("u1").set(pendingMatchDoc());
  });
  const carlos = env.authenticatedContext("carlos").firestore();
  await assertSucceeds(carlos.collection("matches").doc("u1").update({
    "scoreAcceptedBy.carlos": true,
    status: "confirmed",
    "confirmation.confirmedByUid": "carlos",
    ratingProcessed: false,
    version: 2,
    updatedAt: Date.now(),
  }));
});

test("matches update: el rival NO puede tocar el marcador", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("u2").set(pendingMatchDoc());
  });
  const carlos = env.authenticatedContext("carlos").firestore();
  await assertFails(carlos.collection("matches").doc("u2").update({
    marcador: { sets: [{ team1: 0, team2: 6 }], ganador: "team2" }, // intenta voltear el resultado
    status: "confirmed",
  }));
});

test("matches update: un intruso (no jugador) no puede confirmar", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("u3").set(pendingMatchDoc());
  });
  const mallory = env.authenticatedContext("mallory").firestore();
  await assertFails(mallory.collection("matches").doc("u3").update({
    "scoreAcceptedBy.mallory": true, status: "confirmed", ratingProcessed: false,
  }));
});

test("matches update: un jugador NO puede marcar ratingProcessed=true (solo el server)", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("u4").set(pendingMatchDoc());
  });
  const carlos = env.authenticatedContext("carlos").firestore();
  await assertFails(carlos.collection("matches").doc("u4").update({
    status: "confirmed", ratingProcessed: true, // intenta saltarse el trigger
  }));
});

// ── Anti-autoconfirmación (decisión Isaac 7-jun: el rival SIEMPRE confirma) ──
test("matches: el DUEÑO no puede autoconfirmar su propio partido pending", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("self1").set(pendingMatchDoc());
  });
  const pedro = env.authenticatedContext("pedro").firestore(); // pedro = registrante
  await assertFails(pedro.collection("matches").doc("self1").update({
    "scoreAcceptedBy.pedro": true, status: "confirmed",
    "confirmation.confirmedByUid": "pedro", ratingProcessed: false, version: 2,
  }));
});

test("matches create: NO se puede crear ya 'confirmed' desde cliente", async () => {
  const pedro = env.authenticatedContext("pedro").firestore();
  const doc = Object.assign(pendingMatchDoc(), { status: "confirmed" });
  await assertFails(pedro.collection("matches").doc("cf1").set(doc));
});

// ── Flujo legacy in-club (no debe romperse) ──
test("matches legacy: dueño crea 'active' con timestamps ✓", async () => {
  const pedro = env.authenticatedContext("pedro");
  const now = pedro.firestore ? null : null;
  // request.time se evalúa en el server; usamos serverTimestamp via FieldValue del SDK de test
  const { serverTimestamp } = require("firebase/firestore");
  await assertSucceeds(
    pedro.firestore().collection("matches").doc("leg1")
      .set(activeMatchDoc(serverTimestamp()))
  );
});

test("matches legacy: invitado edita solo jugadores en 'active' ✓; tocar loc ✗", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    // Reglas desactivadas: no necesita request.time; fecha plana evita el sentinel cross-SDK.
    await ctx.firestore().collection("matches").doc("leg2").set(activeMatchDoc(new Date(1700000000000)));
  });
  const invitado = env.authenticatedContext("guest9").firestore();
  await assertSucceeds(invitado.collection("matches").doc("leg2").update({
    jugadores: [{ uid: "pedro", equipo: "team1", nombre: "Pedro" }, { equipo: "team2", nombre: "Invitado" }],
    updatedAt: Date.now(),
  }));
  await assertFails(invitado.collection("matches").doc("leg2").update({ loc: "OtroClub" }));
});

// ── Cancelar registro pending ──
test("matches delete: el dueño cancela su pending ✓; un extraño ✗", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("del1").set(pendingMatchDoc());
    await ctx.firestore().collection("matches").doc("del2").set(pendingMatchDoc());
  });
  const mallory = env.authenticatedContext("mallory").firestore();
  await assertFails(mallory.collection("matches").doc("del1").delete());
  const pedro = env.authenticatedContext("pedro").firestore();
  await assertSucceeds(pedro.collection("matches").doc("del2").delete());
});

// ── Leaderboards: lectura signedIn, escritura denegada ──
test("leaderboards: signedIn lee, cliente no escribe", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("leaderboards").doc("global:padel")
      .collection("entries").doc("pedro").set({ uid: "pedro", nivel: 3.5 });
  });
  const auth = env.authenticatedContext("x").firestore();
  await assertSucceeds(auth.collection("leaderboards").doc("global:padel").collection("entries").doc("pedro").get());
  await assertFails(auth.collection("leaderboards").doc("global:padel").collection("entries").doc("pedro").set({ nivel: 7 }, { merge: true }));
});

// ════════════════════════════════════════════════════
// E3a — CLAIM / DECLINE / guests
// ════════════════════════════════════════════════════

test("CLAIM: un usuario nuevo (no en playerUids) se agrega a sí mismo a un pending ✓", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("clm1").set(pendingMatchWithDummyDoc());
  });
  const diana = env.authenticatedContext("diana").firestore();
  await assertSucceeds(diana.collection("matches").doc("clm1").update({
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { uid: "diana", equipo: "team1", nombre: "Diana" }, // reclama el slot dummy "Gabo"
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
      { nombre: "Invitado", equipo: "team2", guestId: "g2", ownerUid: "pedro", uid: null },
    ],
    playerUids: ["pedro", "carlos", "diana"],
    updatedAt: Date.now(),
    version: 2,
  }));
});

test("CLAIM: agregarse PERO tocando el marcador ✗", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("clm2").set(pendingMatchWithDummyDoc());
  });
  const diana = env.authenticatedContext("diana").firestore();
  await assertFails(diana.collection("matches").doc("clm2").update({
    playerUids: ["pedro", "carlos", "diana"],
    marcador: { sets: [{ team1: 0, team2: 6 }], ganador: "team2" }, // voltea el resultado
    updatedAt: Date.now(),
  }));
});

test("CLAIM: un jugador existente no puede inflar playerUids (claim agrega a un tercero, no a sí mismo) ✗", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("clm3").set(pendingMatchWithDummyDoc());
  });
  // carlos ya está en playerUids; intenta una operación claim-shaped (cambia playerUids)
  // metiendo a un tercero "eve". La regla de claim sólo permite agregarte EXACTAMENTE a ti.
  const carlos = env.authenticatedContext("carlos").firestore();
  await assertFails(carlos.collection("matches").doc("clm3").update({
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { uid: "eve", equipo: "team1", nombre: "Eve" },
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
      { nombre: "Invitado", equipo: "team2", guestId: "g2", ownerUid: "pedro", uid: null },
    ],
    playerUids: ["pedro", "carlos", "eve"], // agrega a eve, no a carlos
    updatedAt: Date.now(),
  }));
});

test("CLAIM: agregarse PERO marcando ratingProcessed=true ✗", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("clm4").set(pendingMatchWithDummyDoc());
  });
  const diana = env.authenticatedContext("diana").firestore();
  await assertFails(diana.collection("matches").doc("clm4").update({
    playerUids: ["pedro", "carlos", "diana"],
    ratingProcessed: true, // intenta saltarse el trigger del server
    updatedAt: Date.now(),
  }));
});

test("DECLINE: un compañero (en playerUids) se remueve a sí mismo ✓", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("dec1").set(pendingMatchTrioDoc());
  });
  const bruno = env.authenticatedContext("bruno").firestore();
  await assertSucceeds(bruno.collection("matches").doc("dec1").update({
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { nombre: "Bruno", equipo: "team1", guestId: "gb", ownerUid: "pedro", uid: null }, // slot vuelve a dummy
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
    ],
    playerUids: ["pedro", "carlos"],
    updatedAt: Date.now(),
    version: 2,
  }));
});

test("DECLINE: removiendo a OTRO jugador (no a ti) ✗", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("matches").doc("dec2").set(pendingMatchTrioDoc());
  });
  const bruno = env.authenticatedContext("bruno").firestore();
  await assertFails(bruno.collection("matches").doc("dec2").update({
    jugadores: pendingMatchTrioDoc().jugadores,
    playerUids: ["pedro", "bruno"], // quita a carlos, no a sí mismo
    updatedAt: Date.now(),
  }));
});

test("guests: el dueño lee/escribe su invitado ✓; otro usuario ✗", async () => {
  const pedro = env.authenticatedContext("pedro").firestore();
  const ref = pedro.collection("users").doc("pedro").collection("guests").doc("g1");
  await assertSucceeds(ref.set({
    name: "Gabo", searchName: "gabo",
    createdAt: Date.now(), lastUsedAt: Date.now(), claimedByUid: null,
  }));
  await assertSucceeds(ref.get());
  const mallory = env.authenticatedContext("mallory").firestore();
  const malRef = mallory.collection("users").doc("pedro").collection("guests").doc("g1");
  await assertFails(malRef.get());
  await assertFails(malRef.set({ name: "hack" }));
});

test("teardown", async () => { await env.cleanup(); });
