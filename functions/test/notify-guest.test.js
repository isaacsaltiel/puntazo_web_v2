"use strict";
// G1-B — tests puros de detectGuestClaims + guestClaimedPayload (sin emulador).
const test = require("node:test");
const assert = require("node:assert");
const notify = require("../lib/notify.js");

test("detecta un slot invitado que gana uid (reclamo)", function () {
  const before = { userId: "owner", jugadores: [
    { equipo: "team1", nombre: "Gabo", guestId: "g1", ownerUid: "owner", uid: null },
    { equipo: "team1", nombre: "Isaac", uid: "owner" },
  ] };
  const after = { userId: "owner", jugadores: [
    { equipo: "team1", nombre: "Gabo", guestId: "g1", ownerUid: "owner", uid: "claimer" },
    { equipo: "team1", nombre: "Isaac", uid: "owner" },
  ] };
  const r = notify.detectGuestClaims(before, after);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0], { guestId: "g1", ownerUid: "owner", claimerUid: "claimer", claimerName: "Gabo" });
});

test("NO detecta si el slot ya tenía uid antes", function () {
  const before = { jugadores: [{ guestId: "g1", ownerUid: "o", uid: "x" }] };
  const after = { jugadores: [{ guestId: "g1", ownerUid: "o", uid: "x" }] };
  assert.strictEqual(notify.detectGuestClaims(before, after).length, 0);
});

test("NO detecta auto-reclamo (dueño = claimer)", function () {
  const before = { jugadores: [{ guestId: "g1", ownerUid: "o", uid: null }] };
  const after = { jugadores: [{ guestId: "g1", ownerUid: "o", uid: "o" }] };
  assert.strictEqual(notify.detectGuestClaims(before, after).length, 0);
});

test("NO detecta slot sin guestId", function () {
  const before = { jugadores: [{ nombre: "x", uid: null }] };
  const after = { jugadores: [{ nombre: "x", uid: "claimer" }] };
  assert.strictEqual(notify.detectGuestClaims(before, after).length, 0);
});

test("usa after.userId como ownerUid si el slot no lo trae", function () {
  const before = { userId: "reg", jugadores: [{ guestId: "g2", uid: null }] };
  const after = { userId: "reg", jugadores: [{ guestId: "g2", uid: "claimer" }] };
  const r = notify.detectGuestClaims(before, after);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].ownerUid, "reg");
});

test("guestClaimedPayload: shape correcto, sin mojibake", function () {
  const p = notify.guestClaimedPayload("g1", "Gabo");
  assert.strictEqual(p.type, "guest_claimed");
  assert.strictEqual(p.refId, "g1");
  assert.strictEqual(p.href, "/amigos.html#invitados");
  assert.ok(p.subtitle.indexOf("Gabo") >= 0);
  assert.ok(!/�/.test(p.title + p.subtitle));
});
