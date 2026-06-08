/**
 * PROPUESTA v2 del modelo de cambio de nivel (para discutir con Isaac).
 * Reestructura: "resultado suave" + "bono de competitividad" + freno anti-farm.
 * Correr:  node tests/sim-margen2.js
 *
 *  d         = decisividad por games del GANADOR del partido, en [0,1].
 *              0 = partidazo/parejo (incluye 'ganó el partido pero menos games').
 *              1 = paliza total.
 *  softWin   = 0.5 + 0.5*d   softLose = 0.5 - 0.5*d   (en un partidazo, ~0.5 = "casi empate")
 *  expected  = probabilidad de ganar según ranking (Glicko).  underdog bajo, favorito alto.
 *  coreDelta = update Glicko alimentando softWin/softLose como "score".
 *  bonus     = BONUS_MAX * (1-d) * (1 - expected)   // competitividad, pesa más para el underdog
 *  antifarm  = 1/(1 + 0.5*n)  con n = partidos vs el MISMO rival en los últimos 3 días
 *  ΔratingFinal = antifarm * (coreDelta + bonus)    // piso: el ganador del partido nunca baja
 */
"use strict";
const PR = require("../assets/ranking.js");

const BONUS_MAX = 16;     // puntos de rating (≈0.064 de nivel). TUNABLE.
const ANTIFARM = (n) => 1 / (1 + 0.5 * n);

function ratingForNivel(n, rd) { rd = rd || 80; return (800 + (n - 1) * 250) + 0.5 * rd; }
function established(n) { return { rating: ratingForNivel(n), RD: 80, volatility: 0.06 }; }
function nivel(rating, rd) { return PR.nivelFromConservativeRating(PR.conservativeRating(rating, rd)); }
function expected(myR, myRd, opR, opRd) {
  const me = PR._toGlicko2(myR, myRd), op = PR._toGlicko2(opR, opRd);
  return PR._E(me.mu, op.mu, op.phi);
}
function sumaGames(sets) { let gw = 0, gl = 0; sets.forEach(s => { gw += s.team1; gl += s.team2; }); return { gw, gl }; }
function f(x) { return (x >= 0 ? "+" : "") + x.toFixed(3); }

// 1v1. team1 = "yo". youWin define ganador. n = repeticiones vs mismo rival (anti-farm).
function jugar(youNivel, oppNivel, youWin, sets, n) {
  n = n || 0;
  const me = established(youNivel), op = established(oppNivel);
  const g = sumaGames(sets);
  const gw = youWin ? g.gw : g.gl, gl = youWin ? g.gl : g.gw;     // games del ganador/perdedor
  const d = Math.max(0, Math.min(1, (gw - gl) / Math.max(1, gw + gl)));
  const softWin = 0.5 + 0.5 * d, softLose = 0.5 - 0.5 * d, closeness = 1 - d;

  function calc(meSt, opSt, won) {
    const exp = expected(meSt.rating, meSt.RD, opSt.rating, opSt.RD);
    const sr = won ? softWin : softLose;
    const upd = PR._updatePlayer(meSt.rating, meSt.RD, meSt.volatility, [{ rating: opSt.rating, rd: opSt.RD, score: sr }]);
    const coreDelta = upd.rating - meSt.rating;
    const bonus = BONUS_MAX * closeness * (1 - exp);
    let finalRating = meSt.rating + ANTIFARM(n) * (coreDelta + bonus);
    if (won && finalRating < meSt.rating) finalRating = meSt.rating + 1; // piso: el ganador nunca baja
    return { exp, dNivel: nivel(finalRating, upd.rd) - nivel(meSt.rating, meSt.RD) };
  }
  const yo = calc(me, op, youWin), rv = calc(op, me, !youWin);
  return { d: d, dYo: yo.dNivel, dRival: rv.dNivel, expYo: yo.exp };
}

console.log("\n##### TABLA A — MISMO NIVEL (3.5 vs 3.5). El ganador del partido es 'Yo'. #####");
console.log("Marcador                          games   d     Δyo(gano)  Δrival(pierde)");
[
  ["Paliza    6-1 6-2",            [{ team1: 6, team2: 1 }, { team1: 6, team2: 2 }]],
  ["Normal    6-4 6-4",            [{ team1: 6, team2: 4 }, { team1: 6, team2: 4 }]],
  ["Partidazo 7-6 6-7 7-5",        [{ team1: 7, team2: 6 }, { team1: 6, team2: 7 }, { team1: 7, team2: 5 }]],
  ["Partidazo gano menos games 7-5 3-6 1-6 7-5 7-5", [{ team1: 7, team2: 5 }, { team1: 3, team2: 6 }, { team1: 1, team2: 6 }, { team1: 7, team2: 5 }, { team1: 7, team2: 5 }]],
].forEach(([label, sets]) => {
  const r = jugar(3.5, 3.5, true, sets, 0);
  const g = sumaGames(sets);
  console.log(label.padEnd(34) + (g.gw + "-" + g.gl).padEnd(8) + r.d.toFixed(2).padEnd(6) + f(r.dYo).padEnd(11) + f(r.dRival));
});
console.log("→ Partidazo: SÍ suben los dos (yo más, el rival también un poco).");
console.log("  Paliza: yo subo fuerte, el rival baja.");

console.log("\n##### TABLA B — TÚ (3.5) PIERDES UN PARTIDAZO (7-6 6-7 7-5). ¿Te dan mérito? #####");
console.log("Rival que te ganó             Δ tuyo (perdiste el partido)");
[
  ["Mucho mejor  (5.0)", 5.0],
  ["Algo mejor   (4.0)", 4.0],
  ["Igual        (3.5)", 3.5],
  ["Algo peor    (3.0)", 3.0],
  ["Mucho peor   (2.0)", 2.0],
].forEach(([label, opp]) => {
  const r = jugar(3.5, opp, false, [{ team1: 6, team2: 7 }, { team1: 7, team2: 6 }, { team1: 5, team2: 7 }], 0);
  console.log(label.padEnd(30) + f(r.dYo));
});
console.log("→ Perder un PARTIDAZO contra alguien mucho mejor te SUBE (mérito).");
console.log("  Perder un partidazo contra alguien mucho peor te BAJA (no hay mérito).");

console.log("\n##### TABLA C — ANTI-FARM: el MISMO partidazo (mismo nivel) repetido en 3 días #####");
console.log("Vez (vs mismo rival)          Δ ganador    Δ perdedor");
[0, 1, 2, 3, 4].forEach((n) => {
  const r = jugar(3.5, 3.5, true, [{ team1: 7, team2: 6 }, { team1: 6, team2: 7 }, { team1: 7, team2: 5 }], n);
  console.log(("#" + (n + 1) + (n === 0 ? "  (primera)" : "")).padEnd(30) + f(r.dYo).padEnd(13) + f(r.dRival));
});
console.log("→ La 1ª vez suma completo; cada repetición vs el mismo rival suma menos.");
console.log("");
