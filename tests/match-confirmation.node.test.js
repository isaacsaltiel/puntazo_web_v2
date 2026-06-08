/**
 * Tests de la máquina de confirmación (assets/match-confirmation.js).
 * El corazón anti-trampa de la jornada sin hardware (spec §4/§6, D5).
 * Correr: node --test tests/match-confirmation.node.test.js
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const MC = require("../assets/match-confirmation.js");

// Partido registrado por "pedro" (team1). Al registrar, pedro auto-acepta su lado.
function pendingMatch(extra) {
  return Object.assign({
    id: "m1",
    userId: "pedro",
    status: MC.STATUS.PENDING,
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { uid: "maria", equipo: "team1", nombre: "Maria" },
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
      { uid: "ana", equipo: "team2", nombre: "Ana" },
    ],
    marcador: { sets: [{ team1: 6, team2: 4 }], ganador: "team1" },
    scoreAcceptedBy: { pedro: true }, // registrante auto-aceptó
    confirmation: MC.buildPendingConfirmation("pedro", 1_000_000, 7),
  }, extra || {});
}

test("buildPendingConfirmation: ventana 7 días, registrante seteado", () => {
  const c = MC.buildPendingConfirmation("pedro", 1000, 7);
  assert.strictEqual(c.required, true);
  assert.strictEqual(c.registeredBy, "pedro");
  assert.strictEqual(c.expiresAtMs, 1000 + 7 * 86400000);
  assert.strictEqual(c.confirmedByUid, null);
});

test("un RIVAL confirma → flota a confirmed (1 de cada equipo)", () => {
  const m = pendingMatch();
  const r = MC.computeConfirm(m, "carlos", 2_000_000);
  assert.ok(r.ok);
  assert.strictEqual(r.becameConfirmed, true);
  assert.strictEqual(r.patch.status, MC.STATUS.CONFIRMED);
  assert.strictEqual(r.patch["confirmation.confirmedByUid"], "carlos");
  assert.strictEqual(r.patch["scoreAcceptedBy.carlos"], true);
  assert.strictEqual(r.patch.ratingProcessed, false, "marca para que el trigger lo tome");
});

test("el COMPAÑERO del registrante NO puede confirmar (mismo equipo)", () => {
  const m = pendingMatch();
  const r = MC.computeConfirm(m, "maria", 2_000_000);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /equipo rival/i);
});

test("el propio registrante NO puede auto-confirmar el partido", () => {
  const m = pendingMatch();
  const r = MC.computeConfirm(m, "pedro", 2_000_000);
  assert.strictEqual(r.ok, false, "pedro es team1, no puede ser el rival que confirma");
});

test("alguien que no jugó NO puede confirmar", () => {
  const m = pendingMatch();
  const r = MC.computeConfirm(m, "intruso", 2_000_000);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /no figuras/i);
});

test("no se puede confirmar un partido que no está pending", () => {
  const m = pendingMatch({ status: MC.STATUS.CONFIRMED });
  const r = MC.computeConfirm(m, "carlos", 2_000_000);
  assert.strictEqual(r.ok, false);
});

test("sin auto-aceptación del registrante, 1 rival NO basta (necesita 1 de CADA equipo)", () => {
  // edge defensivo: si por algún motivo el registrante no auto-aceptó,
  // confirmar solo team2 deja team1 sin aceptar → sigue pendiente.
  const m = pendingMatch({ scoreAcceptedBy: {} });
  const r = MC.computeConfirm(m, "carlos", 2_000_000);
  assert.ok(r.ok);
  assert.strictEqual(r.becameConfirmed, false, "team1 aún sin aceptar → no confirma");
  assert.strictEqual(r.patch.status, undefined);
});

test("disputa: cualquier jugador puede disputar pending o confirmed → disputed", () => {
  const m = pendingMatch();
  const r = MC.computeDispute(m, "ana", "El marcador está mal, ganamos nosotros");
  assert.ok(r.ok);
  assert.strictEqual(r.patch.status, MC.STATUS.DISPUTED);
  assert.strictEqual(r.patch["confirmation.disputedByUid"], "ana");
  assert.ok(r.patch["confirmation.disputeReason"].length > 0);
  assert.strictEqual(r.patch.ratingProcessed, false, "fuerza recompute/reversión");
});

test("disputa: un intruso no puede disputar", () => {
  const m = pendingMatch();
  const r = MC.computeDispute(m, "intruso", "mentira");
  assert.strictEqual(r.ok, false);
});

test("isExpired: vencido vs vigente", () => {
  const m = pendingMatch(); // expiresAtMs = 1_000_000 + 7d
  assert.strictEqual(MC.isExpired(m, 1_000_000 + 1000), false, "aún vigente");
  assert.strictEqual(MC.isExpired(m, 1_000_000 + 8 * 86400000), true, "vencido");
  assert.strictEqual(MC.isExpired(pendingMatch({ status: MC.STATUS.CONFIRMED }), 9e15), false, "confirmed no expira");
});
