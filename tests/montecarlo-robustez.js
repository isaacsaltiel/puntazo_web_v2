/**
 * Robustez: corre la temporada con varias SEMILLAS y el doble de partidos, para
 * confirmar que la estabilidad/precisión no fue suerte de un universo.
 * Correr:  node tests/montecarlo-robustez.js
 */
"use strict";
const PR = require("../assets/ranking.js");
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function pElo(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
function pearson(xs, ys) { const mx = avg(xs), my = avg(ys); let n = 0, dx = 0, dy = 0; for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; } return n / Math.sqrt(dx * dy); }
const DATE = new Date("2026-06-01T12:00:00Z");

function season(seed, N, M) {
  const rng = mulberry32(seed);
  const randn = () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const players = {}, trueR = {};
  for (let i = 0; i < N; i++) { trueR["p" + i] = clamp(1500 + randn() * 320, 700, 2400); players["p" + i] = null; }
  const ids = Object.keys(players), est = (u) => players[u] ? players[u].rating : 1500;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (let m = 1; m <= M; m++) {
    const anchor = ids[Math.floor(rng() * ids.length)];
    const near = ids.filter((x) => x !== anchor).sort((a, b) => Math.abs(est(a) - est(anchor)) - Math.abs(est(b) - est(anchor))).slice(0, 9);
    shuffle(near);
    const four = [anchor, near[0], near[1], near[2]].sort((a, b) => est(a) - est(b));
    const t1 = [four[0], four[3]], t2 = [four[1], four[2]];
    const p = pElo(avg(t1.map((u) => trueR[u])), avg(t2.map((u) => trueR[u]))), t1w = rng() < p;
    const gap = Math.abs(2 * p - 1), dAct = clamp(gap * 0.9 + randn() * 0.18, 0.02, 0.92), total = 16 + Math.floor(rng() * 8);
    const gW = Math.max(1, Math.round(total * (0.5 + 0.5 * dAct))), gL = total - gW;
    const match = { id: "m", deporte: "padel", modo: "partido_3", jugadores: [{ uid: t1[0], equipo: "team1" }, { uid: t1[1], equipo: "team1" }, { uid: t2[0], equipo: "team2" }, { uid: t2[1], equipo: "team2" }], marcador: { sets: [t1w ? { team1: gW, team2: gL } : { team1: gL, team2: gW }], ganador: t1w ? "team1" : "team2" }, endedAt: DATE };
    const cur = {};[...t1, ...t2].forEach((u) => { if (players[u]) cur[u] = players[u]; });
    const out = PR.applyMatchToRatings(match, cur, { skipAntifarm: true });
    Object.keys(out.newRatings).forEach((u) => players[u] = out.newRatings[u]);
  }
  const ratings = ids.map(est);
  return { mean: avg(ratings), drift: avg(ratings) - 1500, corr: pearson(ids.map((u) => trueR[u]), ratings) };
}

console.log("ROBUSTEZ — 4 semillas × 40 jugadores × 6000 partidos");
console.log("  semilla |  media  | deriva | corr(real,est)");
let allStable = true;
[111, 222, 333, 444].forEach((seed) => {
  const r = season(seed, 40, 6000);
  if (Math.abs(r.drift) >= 60) allStable = false;
  console.log("  " + String(seed).padStart(7) + " |  " + r.mean.toFixed(0).padStart(5) + "  | " + (r.drift >= 0 ? "+" : "") + r.drift.toFixed(0).padStart(4) + "   | " + r.corr.toFixed(3));
});
console.log("\n  → " + (allStable ? "✔ ESTABLE en todos los universos (deriva < 60 pts en 6000 partidos)" : "✗ algún universo derivó"));
