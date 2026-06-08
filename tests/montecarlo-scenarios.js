/**
 * Escenarios de estrés del modelo de ranking (complementa montecarlo.js).
 *   A) Smurf: ¿qué tan rápido un crack que entra en 1500 llega a su nivel real?
 *   B) Sandbagging: ¿tirar partidos a propósito te deja MÁS ALTO? (no debe)
 *   C) Win-trading / anti-farm: 2 que solo juegan entre ellos, ¿se inflan? (no debe)
 *   D) Calibración: ¿las probabilidades implícitas aciertan? (tabla predicho vs real)
 * Correr:  node tests/montecarlo-scenarios.js
 */
"use strict";
const PR = require("../assets/ranking.js");
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(424242);
function randn() { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function pElo(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
const DATE = new Date("2026-06-01T12:00:00Z");
function nivel(r) { return PR.nivelFromConservativeRating(PR.conservativeRating(r.rating, r.RD)); }
function establishedR(rating) { return { rating, RD: 80, volatility: 0.06, matchCount: 30, lastMatchAt: null, recentOpponents: {} }; }

// Juega 1v1 dados estados; devuelve nuevos estados. Resultado por TRUE elo + games.
function play1v1(sA, sB, trueA, trueB, opts) {
  const p = pElo(trueA, trueB), aWins = rng() < p, gap = Math.abs(2 * p - 1);
  const dAct = clamp(gap * 0.9 + randn() * 0.18, 0.02, 0.92), total = 16 + Math.floor(rng() * 8);
  const gW = Math.max(1, Math.round(total * (0.5 + 0.5 * dAct))), gL = total - gW;
  const match = {
    id: "x", deporte: "padel", modo: "partido_3",
    jugadores: [{ uid: "a", equipo: "team1" }, { uid: "b", equipo: "team2" }],
    marcador: { sets: [aWins ? { team1: gW, team2: gL } : { team1: gL, team2: gW }], ganador: aWins ? "team1" : "team2" },
    endedAt: DATE,
  };
  const cur = {}; if (sA) cur.a = sA; if (sB) cur.b = sB;
  const out = PR.applyMatchToRatings(match, cur, opts || {});
  return { a: out.newRatings.a, b: out.newRatings.b, aWins };
}
function forcedResult(sA, sB, aWins, sets) {
  const match = {
    id: "x", deporte: "padel", modo: "partido_3",
    jugadores: [{ uid: "a", equipo: "team1" }, { uid: "b", equipo: "team2" }],
    marcador: { sets, ganador: aWins ? "team1" : "team2" }, endedAt: DATE,
  };
  const cur = {}; if (sA) cur.a = sA; if (sB) cur.b = sB;
  const out = PR.applyMatchToRatings(match, cur, { skipAntifarm: true });
  return { a: out.newRatings.a, b: out.newRatings.b };
}

// ── A) SMURF ─────────────────────────────────────────────────────────────────
console.log("A) SMURF — un crack (real ~5.5 / ~2050) entra en 1500 y juega vs ~4.3 (1825)");
(function () {
  let smurf = null; const trueSmurf = 2050, trueOpp = 1825;
  let reached = -1;
  for (let i = 1; i <= 40; i++) {
    const r = play1v1(smurf, establishedR(trueOpp), trueSmurf, trueOpp, { skipAntifarm: true });
    smurf = r.a;
    if (reached < 0 && smurf.rating >= 1950) reached = i; // dentro de ~0.4 niveles del real
    if ([3, 5, 10, 20, 40].indexOf(i) >= 0) console.log("   tras " + String(i).padStart(2) + " partidos: nivel " + nivel(smurf).toFixed(2) + (smurf.isCalibrating ? " (calibrando)" : ""));
  }
  console.log("   → llegó a ~su nivel real en " + reached + " partidos. " + (reached <= 12 ? "✔ rápido" : "⚠ lento"));
})();

// ── B) SANDBAGGING ───────────────────────────────────────────────────────────
console.log("\nB) SANDBAGGING — ¿tirar 8 partidos a propósito te deja MÁS ALTO al final?");
(function () {
  const trueP = 1900, trueOpp = 1700;
  // honesto: juega 30 partidos honestos
  let honest = null;
  for (let i = 0; i < 30; i++) honest = play1v1(honest, establishedR(trueOpp), trueP, trueOpp, { skipAntifarm: true }).a;
  // tramposo: tira 8 (pierde 0-6 0-6), luego 30 honestos
  let cheat = null;
  for (let i = 0; i < 8; i++) cheat = forcedResult(cheat, null, false, [{ team1: 0, team2: 6 }, { team1: 0, team2: 6 }]).a;
  for (let i = 0; i < 30; i++) cheat = play1v1(cheat, establishedR(trueOpp), trueP, trueOpp, { skipAntifarm: true }).a;
  console.log("   honesto: nivel " + nivel(honest).toFixed(2) + "   |   tramposo (tiró 8): nivel " + nivel(cheat).toFixed(2));
  console.log("   → " + (nivel(cheat) <= nivel(honest) + 0.05 ? "✔ tirar partidos NO te deja más alto (no hay exploit)" : "✗ EXPLOIT: el tramposo quedó más alto"));
})();

// ── C) WIN-TRADING / ANTI-FARM ───────────────────────────────────────────────
console.log("\nC) WIN-TRADING — A y B (iguales, ~1700) solo juegan entre ellos, 60 veces");
(function () {
  let A = null, B = null;
  // inicializar a 1700 estable
  A = { rating: 1700, RD: 90, volatility: 0.06, matchCount: 25, lastMatchAt: null, recentOpponents: {} };
  B = { rating: 1700, RD: 90, volatility: 0.06, matchCount: 25, lastMatchAt: null, recentOpponents: {} };
  for (let i = 1; i <= 60; i++) {
    // alternan palizas (intento de win-trade para inflarse)
    const aWins = i % 2 === 0;
    const match = {
      id: "x", deporte: "padel", modo: "partido_3",
      jugadores: [{ uid: "a", equipo: "team1" }, { uid: "b", equipo: "team2" }],
      marcador: { sets: [aWins ? { team1: 6, team2: 1 } : { team1: 1, team2: 6 }], ganador: aWins ? "team1" : "team2" }, endedAt: DATE,
    };
    const out = PR.applyMatchToRatings(match, { a: A, b: B }, {}); // anti-farm ON
    A = out.newRatings.a; B = out.newRatings.b;
  }
  console.log("   Tras 60 win-trades: A nivel " + nivel(A).toFixed(2) + "  B nivel " + nivel(B).toFixed(2) + "  (media empezó en ~" + nivel({ rating: 1700, RD: 90 }).toFixed(2) + ")");
  const meanNivel = (nivel(A) + nivel(B)) / 2, start = nivel({ rating: 1700, RD: 90 });
  console.log("   → " + (Math.abs(meanNivel - start) < 0.15 ? "✔ no se inflan (anti-farm aguanta)" : "✗ se movieron de más"));
})();

// ── D) CALIBRACIÓN ───────────────────────────────────────────────────────────
console.log("\nD) CALIBRACIÓN — predicho vs real (población 40, 3000 partidos)");
(function () {
  const N = 40, M = 3000, players = {}, trueR = {};
  for (let i = 0; i < N; i++) { trueR["p" + i] = clamp(1500 + randn() * 300, 800, 2300); players["p" + i] = null; }
  const ids = Object.keys(players), est = (u) => players[u] ? players[u].rating : 1500;
  const bins = Array.from({ length: 10 }, () => ({ pred: 0, win: 0, n: 0 }));
  for (let m = 1; m <= M; m++) {
    const anchor = ids[Math.floor(rng() * ids.length)];
    const near = ids.filter((x) => x !== anchor).sort((a, b) => Math.abs(est(a) - est(anchor)) - Math.abs(est(b) - est(anchor))).slice(0, 6);
    const opp = near[Math.floor(rng() * near.length)];
    const pHat = pElo(est(anchor), est(opp));
    const aWins = rng() < pElo(trueR[anchor], trueR[opp]);
    if (m > 500) { const bi = Math.min(9, Math.floor(pHat * 10)); bins[bi].pred += pHat; bins[bi].win += aWins ? 1 : 0; bins[bi].n++; }
    const total = 18, gW = 11, gL = 7;
    const match = { id: "m", deporte: "padel", modo: "partido_3", jugadores: [{ uid: anchor, equipo: "team1" }, { uid: opp, equipo: "team2" }], marcador: { sets: [aWins ? { team1: gW, team2: gL } : { team1: gL, team2: gW }], ganador: aWins ? "team1" : "team2" }, endedAt: DATE };
    const cur = {}; if (players[anchor]) cur[anchor] = players[anchor]; if (players[opp]) cur[opp] = players[opp];
    const out = PR.applyMatchToRatings(match, cur, { skipAntifarm: true });
    Object.keys(out.newRatings).forEach((u) => players[u] = out.newRatings[u]);
  }
  console.log("   prob predicha → tasa real de victoria (deben parecerse):");
  bins.forEach((b, i) => { if (b.n > 20) console.log("     " + (i * 10) + "-" + (i * 10 + 10) + "%  predicho " + (100 * b.pred / b.n).toFixed(0) + "%  real " + (100 * b.win / b.n).toFixed(0) + "%   (" + b.n + " partidos)"); });
})();
console.log("");
