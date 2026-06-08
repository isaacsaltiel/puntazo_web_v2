/**
 * Global/Local a escala (usa la lógica real de contextos, functions/lib/rating.js).
 * 3 clubes de distinta fuerza que CASI no se cruzan. Pregunta:
 *   - ¿El GLOBAL sigue comparable entre clubes con poco cruce? (pools conectados)
 *   - ¿El LOCAL de cada club ordena bien a sus miembros?
 * Correr (desde functions/):  npm run vendor && node itest/montecarlo-global-local.js
 */
"use strict";
const { planRatingUpdate } = require("../lib/rating.js");
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(20260607);
function randn() { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function pElo(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
function pearson(xs, ys) { const mx = avg(xs), my = avg(ys); let n = 0, dx = 0, dy = 0; for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; } return n / Math.sqrt(dx * dy); }
const DATE = new Date("2026-06-01");

const CLUBS = [{ id: "Norte", bias: 250 }, { id: "Centro", bias: 0 }, { id: "Sur", bias: -250 }];
const PER = 10, players = {}, trueR = {}, club = {};
CLUBS.forEach((c) => { for (let i = 0; i < PER; i++) { const uid = c.id + i; trueR[uid] = clamp(1500 + c.bias + randn() * 180, 700, 2400); club[uid] = c.id; players[uid] = { uid, byContext: {} }; } });
const ids = Object.keys(players);
const gctx = "global:padel";
function gRating(uid) { const s = players[uid].byContext[gctx]; return s ? s.rating : 1500; }
function lRating(uid, c) { const s = players[uid].byContext["club:" + c + ":padel"]; return s ? s.rating : null; }

function pickFrom(pool) { const a = pool.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, 4); }
function playMatch(four, loc) {
  four.sort((a, b) => gRating(a) - gRating(b));
  const t1 = [four[0], four[3]], t2 = [four[1], four[2]];
  const p = pElo(avg(t1.map((u) => trueR[u])), avg(t2.map((u) => trueR[u]))), t1w = rng() < p;
  const gap = Math.abs(2 * p - 1), dA = clamp(gap * 0.9 + randn() * 0.18, 0.02, 0.92), tot = 16 + Math.floor(rng() * 8);
  const gW = Math.max(1, Math.round(tot * (0.5 + 0.5 * dA))), gL = tot - gW;
  const match = { id: "m", deporte: "padel", loc, modo: "partido_3", jugadores: [{ uid: t1[0], equipo: "team1" }, { uid: t1[1], equipo: "team1" }, { uid: t2[0], equipo: "team2" }, { uid: t2[1], equipo: "team2" }], marcador: { sets: [t1w ? { team1: gW, team2: gL } : { team1: gL, team2: gW }], ganador: t1w ? "team1" : "team2" }, endedAt: DATE };
  const plan = planRatingUpdate(match, players);
  Object.keys(plan.updatesByUid).forEach((u) => Object.assign(players[u].byContext, plan.updatesByUid[u]));
}

const CROSS = 0.12; // 12% de partidos son inter-club
for (let m = 1; m <= 6000; m++) {
  if (rng() < CROSS) { playMatch(pickFrom(ids), CLUBS[Math.floor(rng() * 3)].id); }
  else { const c = CLUBS[Math.floor(rng() * 3)]; playMatch(pickFrom(ids.filter((u) => club[u] === c.id)), c.id); }
}

console.log("GLOBAL/LOCAL a escala — 3 clubes (Norte fuerte, Sur flojo), 12% cruce, 6000 partidos\n");
console.log("  corr(GLOBAL estimado, habilidad real) en TODA la población = " + pearson(ids.map((u) => trueR[u]), ids.map(gRating)).toFixed(3));
console.log("  → si es alto, los pools quedaron CONECTADOS pese al poco cruce.\n");
CLUBS.forEach((c) => {
  const mem = ids.filter((u) => club[u] === c.id && lRating(u, c.id) != null);
  const corr = pearson(mem.map((u) => trueR[u]), mem.map((u) => lRating(u, c.id)));
  console.log("  Club " + c.id.padEnd(7) + " corr(local, habilidad real entre sus miembros) = " + corr.toFixed(3) + "  | nivel global medio del club = " + (avg(ids.filter((u) => club[u] === c.id).map(gRating)) / 1).toFixed(0));
});
// ¿un fuerte del Sur destaca localmente?
const surSorted = ids.filter((u) => club[u] === "Sur").sort((a, b) => trueR[b] - trueR[a]);
console.log("\n  El mejor del Sur (" + surSorted[0] + "): global " + gRating(surSorted[0]).toFixed(0) + " | local en Sur " + (lRating(surSorted[0], "Sur") || 0).toFixed(0) + " (alto entre los suyos)");
console.log("");
