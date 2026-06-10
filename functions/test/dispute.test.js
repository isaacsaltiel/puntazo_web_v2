"use strict";
/**
 * Tests de lib/dispute.js — resolución/expiración de disputas (E-A 2026-06-09).
 * Correr: node --test test/dispute.test.js (o npm test).
 */
const test = require("node:test");
const assert = require("node:assert");
const dispute = require("../lib/dispute.js");

const NOW = 1_900_000_000_000;
const DAY = 86400000;

test("resolveDisputePatch: confirmed → status + ratingProcessed=false (el trigger lo toma)", () => {
  const r = dispute.resolveDisputePatch({ status: "disputed" }, "confirmed", NOW);
  assert.ok(r.ok);
  assert.strictEqual(r.patch.status, "confirmed");
  assert.strictEqual(r.patch.ratingProcessed, false);
  assert.strictEqual(r.patch["confirmation.resolution"], "confirmed");
  assert.strictEqual(r.patch["confirmation.resolvedAtMs"], NOW);
});

test("resolveDisputePatch: void → status void SIN tocar ratingProcessed", () => {
  const r = dispute.resolveDisputePatch({ status: "disputed" }, "void", NOW);
  assert.ok(r.ok);
  assert.strictEqual(r.patch.status, "void");
  assert.ok(!("ratingProcessed" in r.patch));
});

test("resolveDisputePatch: rechaza match no-disputed, outcome inválido y match ausente", () => {
  assert.strictEqual(dispute.resolveDisputePatch({ status: "pending_confirmation" }, "void", NOW).error, "not-disputed");
  assert.strictEqual(dispute.resolveDisputePatch({ status: "confirmed" }, "confirmed", NOW).error, "not-disputed");
  assert.strictEqual(dispute.resolveDisputePatch({ status: "disputed" }, "expired", NOW).error, "bad-outcome");
  assert.strictEqual(dispute.resolveDisputePatch(null, "void", NOW).error, "not-found");
});

test("disputeIsStale: > 30 días por disputedAtMs → true; reciente → false", () => {
  const old = { status: "disputed", confirmation: { disputedAtMs: NOW - 31 * DAY } };
  const fresh = { status: "disputed", confirmation: { disputedAtMs: NOW - 2 * DAY } };
  assert.strictEqual(dispute.disputeIsStale(old, NOW, null), true);
  assert.strictEqual(dispute.disputeIsStale(fresh, NOW, null), false);
});

test("disputeIsStale: sin disputedAtMs cae a updatedAtMs; sin ninguno NO expira", () => {
  const m = { status: "disputed", confirmation: {} };
  assert.strictEqual(dispute.disputeIsStale(m, NOW, NOW - 40 * DAY), true);
  assert.strictEqual(dispute.disputeIsStale(m, NOW, NOW - 1 * DAY), false);
  assert.strictEqual(dispute.disputeIsStale(m, NOW, null), false, "sin fecha no se void-ea a ciegas");
});

test("disputeIsStale: solo aplica a status disputed", () => {
  const m = { status: "pending_confirmation", confirmation: { disputedAtMs: NOW - 99 * DAY } };
  assert.strictEqual(dispute.disputeIsStale(m, NOW, null), false);
});
