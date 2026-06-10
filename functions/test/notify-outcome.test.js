"use strict";
/**
 * Tests de los builders E-A — desenlace del registro hacia el REGISTRANTE
 * (match_confirmed / match_disputed) + playerName. Correr: npm test.
 */
const test = require("node:test");
const assert = require("node:assert");
const notify = require("../lib/notify.js");

const MATCH = {
  userId: "pedro",
  jugadores: [
    { uid: "pedro", equipo: "team1", nombre: "Pedro Páramo" },
    { uid: "ana", equipo: "team2", nombre: "Ana García" },
  ],
};

test("matchConfirmedPayload: id determinístico, href a confirmar, nombre del confirmador", () => {
  const p = notify.matchConfirmedPayload("m1", "Ana");
  assert.strictEqual(p.type, "match_confirmed");
  assert.strictEqual(p.refId, "m1");
  assert.strictEqual(notify.notifId(p.type, p.refId), "match_confirmed__m1");
  assert.strictEqual(p.href, "/confirmar.html?id=m1");
  assert.ok(p.subtitle.indexOf("Ana") === 0);
});

test("matchConfirmedPayload: sin nombre cae a 'Tu rival'", () => {
  const p = notify.matchConfirmedPayload("m1", null);
  assert.ok(p.subtitle.indexOf("Tu rival") === 0);
});

test("matchDisputedPayload: tipo/título de alerta + nombre del disputador", () => {
  const p = notify.matchDisputedPayload("m2", "Ana");
  assert.strictEqual(p.type, "match_disputed");
  assert.strictEqual(p.title, "Disputaron tu partido");
  assert.ok(p.subtitle.indexOf("Ana") === 0);
  assert.strictEqual(p.href, "/confirmar.html?id=m2");
});

test("playerName: primer nombre del uid en jugadores[]; null si no figura", () => {
  assert.strictEqual(notify.playerName(MATCH, "ana"), "Ana");
  assert.strictEqual(notify.playerName(MATCH, "pedro"), "Pedro");
  assert.strictEqual(notify.playerName(MATCH, "nadie"), null);
  assert.strictEqual(notify.playerName(null, "ana"), null);
});
