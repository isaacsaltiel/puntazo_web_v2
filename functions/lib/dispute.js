"use strict";
/**
 * Lógica PURA de resolución/expiración de disputas (sin SDK). Unit-testeable.
 *
 * Contexto (auditoría 2026-06-09): `disputed` era un callejón sin salida — la UI
 * promete "hasta que se resuelva" y nada lo resolvía jamás. Salida server-side:
 *  - resolveDisputePatch: un admin decide `confirmed` (alimenta ranking vía el
 *    trigger onMatchConfirmed, porque marca ratingProcessed=false) o `void`.
 *  - DISPUTE_MAX_AGE_DAYS: pasado ese plazo sin resolución, el scheduler la
 *    void-ea automático (mismo destino que un pending vencido).
 *
 * Una disputa solo nace de un pending (las reglas niegan disputar un confirmed),
 * así que confirmarla aquí nunca re-procesa un ranking ya aplicado.
 */

const DISPUTE_MAX_AGE_DAYS = 30;

function resolveDisputePatch(match, outcome, nowMs) {
  if (!match) return { ok: false, error: "not-found" };
  if (match.status !== "disputed") return { ok: false, error: "not-disputed" };
  if (outcome !== "confirmed" && outcome !== "void") return { ok: false, error: "bad-outcome" };
  const patch = {
    status: outcome,
    "confirmation.resolution": outcome,
    "confirmation.resolvedAtMs": nowMs,
  };
  if (outcome === "confirmed") {
    patch.ratingProcessed = false; // el trigger onMatchConfirmed aplica el ranking
  }
  return { ok: true, patch: patch };
}

// ms en que se disputó: disputedAtMs (E-A, nuevo) con fallback a updatedAtMs
// (docs anteriores al campo). null = no determinable (no expirar a ciegas).
function disputedAtMsOf(match, updatedAtMs) {
  const c = (match && match.confirmation) || {};
  if (Number.isFinite(c.disputedAtMs)) return c.disputedAtMs;
  if (Number.isFinite(updatedAtMs)) return updatedAtMs;
  return null;
}

function disputeIsStale(match, nowMs, updatedAtMs) {
  if (!match || match.status !== "disputed") return false;
  const ms = disputedAtMsOf(match, updatedAtMs);
  if (ms == null) return false;
  return (nowMs - ms) > DISPUTE_MAX_AGE_DAYS * 86400000;
}

module.exports = {
  DISPUTE_MAX_AGE_DAYS: DISPUTE_MAX_AGE_DAYS,
  resolveDisputePatch: resolveDisputePatch,
  disputedAtMsOf: disputedAtMsOf,
  disputeIsStale: disputeIsStale,
};
