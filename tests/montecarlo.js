/**
 * MONTE CARLO — temporada completa, para estresar el modelo de ranking.
 * 40 jugadores con HABILIDAD REAL oculta (generada con un modelo Elo distinto al
 * Glicko que estima, para no "probar el modelo consigo mismo"). Miles de partidos
 * con emparejamiento competitivo (juegas con/contra gente de tu nivel estimado).
 *
 * Mide:
 *   - INFLACIÓN: ¿la media del rating se mantiene estable en el tiempo?
 *   - PRECISIÓN: ¿el rating estimado correlaciona con la habilidad real?
 *   - CALIBRACIÓN: ¿las probabilidades implícitas aciertan? (Brier score)
 *   - RANKING: ¿los mejores reales terminan arriba? (overlap del top-10)
 *
 * Correr:  node tests/montecarlo.js
 */
"use strict";
const PR = require("../assets/ranking.js");

// ── RNG reproducible ─────────────────────────────────────────────────────────
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(987654321);
function randn() { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

// ── Población: habilidad REAL (oculta) ───────────────────────────────────────
const N = 40, MATCHES = 4000, FIXED_DATE = new Date("2026-06-01T12:00:00Z");
const players = {}; // uid → estado del motor
const trueRating = {}; // uid → habilidad real (Elo)
for (let i = 0; i < N; i++) {
  const uid = "p" + i;
  trueRating[uid] = clamp(1500 + randn() * 320, 700, 2400); // sd ~1.3 nivel
  players[uid] = null; // el motor lo inicializa a 1500/350
}
const ids = Object.keys(players);
function est(uid) { return players[uid] ? players[uid].rating : PR.INITIAL_RATING; }
function pElo(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); } // modelo GENERADOR (distinto a Glicko)

// ── Emparejamiento competitivo + simulación de un partido ────────────────────
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function pickFour() {
  const anchor = ids[Math.floor(rng() * ids.length)];
  const near = ids.filter((x) => x !== anchor).sort((a, b) => Math.abs(est(a) - est(anchor)) - Math.abs(est(b) - est(anchor))).slice(0, 9);
  shuffle(near);
  const four = [anchor, near[0], near[1], near[2]];
  four.sort((a, b) => est(a) - est(b)); // equipos balanceados: (más bajo + más alto) vs (medios)
  return { team1: [four[0], four[3]], team2: [four[1], four[2]] };
}
function simulateResult(team1, team2) {
  const t1 = avg(team1.map((u) => trueRating[u])), t2 = avg(team2.map((u) => trueRating[u]));
  const p = pElo(t1, t2);
  const t1Wins = rng() < p;
  const gap = Math.abs(2 * p - 1);
  const dAct = clamp(gap * 0.9 + randn() * 0.18, 0.02, 0.92); // decisividad real
  const total = 16 + Math.floor(rng() * 8);
  const gW = Math.max(1, Math.round(total * (0.5 + 0.5 * dAct))), gL = Math.max(0, total - gW);
  return { ganador: t1Wins ? "team1" : "team2", sets: [t1Wins ? { team1: gW, team2: gL } : { team1: gL, team2: gW }], t1Wins: t1Wins, pHat: pElo(avg(team1.map(est)), avg(team2.map(est))) };
}

// ── Métricas ─────────────────────────────────────────────────────────────────
function pearson(xs, ys) {
  const mx = avg(xs), my = avg(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}
function topOverlap(k) {
  const byTrue = ids.slice().sort((a, b) => trueRating[b] - trueRating[a]).slice(0, k);
  const byEst = ids.slice().sort((a, b) => est(b) - est(a)).slice(0, k);
  return byTrue.filter((x) => byEst.indexOf(x) >= 0).length;
}
function report(n, brierSum, brierCount) {
  const ratings = ids.map(est);
  const corr = pearson(ids.map((u) => trueRating[u]), ratings);
  const meanR = avg(ratings);
  const sd = Math.sqrt(avg(ratings.map((r) => (r - meanR) ** 2)));
  const brier = brierSum / Math.max(1, brierCount);
  console.log(
    "  " + String(n).padStart(5) + " | media " + meanR.toFixed(0).padStart(5) +
    " | sd " + sd.toFixed(0).padStart(4) +
    " | corr(real,est) " + corr.toFixed(3) +
    " | Brier " + brier.toFixed(4) +
    " | top10 " + topOverlap(10) + "/10"
  );
}

// ── Correr la temporada ──────────────────────────────────────────────────────
console.log("MONTE CARLO — " + N + " jugadores, " + MATCHES + " partidos, habilidad real oculta");
console.log("  (media≈1500 sano = sin inflación; corr→1 = recupera habilidad; Brier↓ = mejor predicción)");
console.log("  match | media rating | sd | corr(real,est) | Brier | top10");
let brierSum = 0, brierCount = 0;
for (let m = 1; m <= MATCHES; m++) {
  const { team1, team2 } = pickFour();
  const res = simulateResult(team1, team2);
  brierSum += (res.pHat - (res.t1Wins ? 1 : 0)) ** 2; brierCount++;
  const cur = {};
  [...team1, ...team2].forEach((u) => { if (players[u]) cur[u] = players[u]; });
  const match = {
    id: "m" + m, deporte: "padel", modo: "partido_3",
    jugadores: [
      { uid: team1[0], equipo: "team1" }, { uid: team1[1], equipo: "team1" },
      { uid: team2[0], equipo: "team2" }, { uid: team2[1], equipo: "team2" },
    ],
    marcador: { sets: res.sets, ganador: res.ganador }, endedAt: FIXED_DATE,
  };
  const out = PR.applyMatchToRatings(match, cur, { skipAntifarm: true });
  Object.keys(out.newRatings).forEach((u) => { players[u] = out.newRatings[u]; });
  if (m % 500 === 0) { report(m, brierSum, brierCount); brierSum = 0; brierCount = 0; }
}

// ── Diagnóstico final ────────────────────────────────────────────────────────
const finalMean = avg(ids.map(est));
console.log("\nDIAGNÓSTICO:");
console.log("  Inflación: media final " + finalMean.toFixed(0) + " (sano ≈ 1500; deriva = " + (finalMean - 1500).toFixed(0) + " pts)");
console.log("  Precisión: corr(real, est) = " + pearson(ids.map((u) => trueRating[u]), ids.map(est)).toFixed(3) + " (→1 ideal)");
console.log("  Ranking:   top-10 real correctamente en top-10 est = " + topOverlap(10) + "/10");
const drift = Math.abs(finalMean - 1500);
console.log("\n  VEREDICTO INFLACIÓN: " + (drift < 40 ? "✔ estable" : drift < 120 ? "⚠ deriva moderada (" + (finalMean - 1500).toFixed(0) + ")" : "✗ INFLACIÓN FUERTE (" + (finalMean - 1500).toFixed(0) + ") — hay que corregir"));
