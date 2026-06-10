"use strict";
/**
 * Tests de los loops sociales (2026-06-10): friend_accepted y group_joined.
 */
const test = require("node:test");
const assert = require("node:assert");
const notify = require("../lib/notify.js");

test("friendAcceptedPayload: al solicitante, con nombre del que aceptó", () => {
  const p = notify.friendAcceptedPayload("f1", "Ana");
  assert.strictEqual(p.type, "friend_accepted");
  assert.strictEqual(p.refId, "f1");
  assert.ok(p.subtitle.indexOf("Ana") === 0);
  assert.strictEqual(p.href, "/amigos.html");
});

test("groupJoinedPayload: liga vs grupo cambia icono/href/subtítulo", () => {
  const liga = notify.groupJoinedPayload("g1", { groupName: "Liga Pumas", isLiga: true });
  assert.strictEqual(liga.type, "group_joined");
  assert.strictEqual(liga.href, "/liga.html?id=g1");
  assert.ok(liga.title.indexOf("Liga Pumas") >= 0);
  const grupo = notify.groupJoinedPayload("g2", { groupName: "Los viernes", isLiga: false });
  assert.strictEqual(grupo.href, "/grupo.html?id=g2");
});

test("newGroupMembers: diff de memberUids; create no notifica al creador", () => {
  // update: entra "carlos"
  assert.deepStrictEqual(
    notify.newGroupMembers({ memberUids: ["ana"] }, { memberUids: ["ana", "carlos"], creatorUid: "ana" }),
    ["carlos"]
  );
  // create del grupo: creador fuera, invitado inicial sí
  assert.deepStrictEqual(
    notify.newGroupMembers(null, { memberUids: ["ana", "beto"], creatorUid: "ana" }),
    ["beto"]
  );
  // sin cambios → vacío; delete → vacío
  assert.deepStrictEqual(notify.newGroupMembers({ memberUids: ["ana"] }, { memberUids: ["ana"] }), []);
  assert.deepStrictEqual(notify.newGroupMembers({ memberUids: ["ana"] }, null), []);
});
