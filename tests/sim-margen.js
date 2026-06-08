/**
 * Simulación de diseño: margen por GAMES + efecto del nivel del rival.
 * Para discutir parámetros con Isaac ANTES de tocar el motor. Correr:
 *   node tests/sim-margen.js
 */
"use strict";
const PR = require("../assets/ranking.js");

// ── Modelo PROPUESTO de margen (tunable) ─────────────────────────────────────
// dec = decisividad por games, firmada por el GANADOR del partido:
//   dec = (gamesGanador - gamesPerdedor) / (gamesGanador + gamesPerdedor)
//   +1  = dominó todos los games ; 0 = empate de games ; negativo = el que ganó
//   el partido ganó MENOS games (tu caso 7-5 3-6 1-6 7-5 7-5).
// mov = multiplicador del CAMBIO de rating (se aplica a ganador Y perdedor):
//   mov = clamp(1 + SLOPE*(dec - PIVOT), MOV_MIN, MOV_MAX)
//   PIVOT = un partido "normal competido" (6-4 6-4) queda neutro (~1.0).
const PIVOT = 0.20, SLOPE = 0.8, MOV_MIN = 0.7, MOV_MAX = 1.4;
function movPorGames(gw, gl) {
  const dec = (gw - gl) / Math.max(1, gw + gl);
  const mov = 1 + SLOPE * (dec - PIVOT);
  return { dec: dec, mov: Math.max(MOV_MIN, Math.min(MOV_MAX, mov)) };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function ratingForNivel(n, rd) {
  rd = rd || 80;
  const cons = 800 + (n - 1) * 250; // inverso de nivelFromConservativeRating
  return cons + 0.5 * rd;
}
function established(n) {
  return { rating: ratingForNivel(n), RD: 80, volatility: 0.06, matchCount: 30, lastMatchAt: null, recentOpponents: {} };
}
function nivelDe(rating, rd) {
  return PR.nivelFromConservativeRating(PR.conservativeRating(rating, rd));
}
function sumaGames(sets) {
  let gw = 0, gl = 0; sets.forEach(s => { gw += s.team1; gl += s.team2; });
  return { gw, gl };
}

// Juega 1v1 y devuelve Δnivel de cada uno aplicando el margen PROPUESTO.
// youWin=true => team1 gana. sets en clave team1/team2 desde la óptica del que escribe.
function jugar(youNivel, oppNivel, youWin, sets) {
  const me = established(youNivel), op = established(oppNivel);
  const ratings = { yo: me, rival: op };
  const ganador = youWin ? "team1" : "team2";
  const match = {
    id: "x", deporte: "padel", modo: "partido_5",
    jugadores: [{ uid: "yo", equipo: "team1", nombre: "Yo" }, { uid: "rival", equipo: "team2", nombre: "Rival" }],
    marcador: { sets, ganador }, endedAt: new Date("2026-06-01T12:00:00Z"),
  };
  // delta CRUDO de Glicko (sin el MOV viejo)
  const res = PR.applyMatchToRatings(match, ratings, { skipMOV: true, skipAntifarm: true });
  // games del GANADOR vs PERDEDOR
  const g = sumaGames(sets);
  const gw = youWin ? g.gw : g.gl, gl = youWin ? g.gl : g.gw;
  const { dec, mov } = movPorGames(gw, gl);

  function deltaNivel(uid, base) {
    const raw = res.newRatings[uid];
    const finalRating = base.rating + mov * (raw.rating - base.rating); // escalar el delta
    const before = nivelDe(base.rating, base.RD);
    const after = nivelDe(finalRating, raw.RD);
    return after - before;
  }
  return { dec, mov, dYo: deltaNivel("yo", me), dRival: deltaNivel("rival", op) };
}

function f(x) { return (x >= 0 ? "+" : "") + x.toFixed(3); }

// ════════════════════════════════════════════════════════════════════════════
console.log("\n##### TABLA 1 — MISMO NIVEL (ambos 3.5). Cambia el marcador. #####");
console.log("Resultado                        games   decisiv.  mov    Δganador  Δperdedor");
[
  ["Paliza   6-2 6-1 6-0", [{ team1: 6, team2: 2 }, { team1: 6, team2: 1 }, { team1: 6, team2: 0 }]],
  ["Normal   6-4 6-4",     [{ team1: 6, team2: 4 }, { team1: 6, team2: 4 }]],
  ["Cerrado  7-5 6-4",     [{ team1: 7, team2: 5 }, { team1: 6, team2: 4 }]],
  ["Partidazo 7-5 3-6 1-6 7-5 7-5", [{ team1: 7, team2: 5 }, { team1: 3, team2: 6 }, { team1: 1, team2: 6 }, { team1: 7, team2: 5 }, { team1: 7, team2: 5 }]],
].forEach(([label, sets]) => {
  const r = jugar(3.5, 3.5, true, sets);
  const g = sumaGames(sets);
  console.log(
    label.padEnd(33) +
    (g.gw + "-" + g.gl).padEnd(8) +
    r.dec.toFixed(2).padEnd(10) +
    r.mov.toFixed(2).padEnd(7) +
    f(r.dYo).padEnd(10) + f(r.dRival)
  );
});
console.log("→ Fíjate en 'Partidazo': el ganador ganó MENOS games (25-27). El");
console.log("  perdedor casi no baja, y el ganador casi no sube. Nadie farmea:");
console.log("  el perdedor jamás suma, solo baja menos.");

console.log("\n##### TABLA 2 — TÚ ESTÁS EN 3.5. Marcador normal (6-3 6-4). #####");
console.log("Rival                         si GANAS    si PIERDES");
[
  ["Mucho peor   (2.0)", 2.0],
  ["Algo peor    (3.0)", 3.0],
  ["Igual        (3.5)", 3.5],
  ["Algo mejor   (4.0)", 4.0],
  ["Mucho mejor  (5.0)", 5.0],
].forEach(([label, opp]) => {
  const win = jugar(3.5, opp, true, [{ team1: 6, team2: 3 }, { team1: 6, team2: 4 }]);
  const lose = jugar(3.5, opp, false, [{ team1: 3, team2: 6 }, { team1: 4, team2: 6 }]);
  console.log(label.padEnd(30) + f(win.dYo).padEnd(12) + f(lose.dYo));
});
console.log("→ Ganarle a alguien mucho mejor = subes mucho; a alguien mucho");
console.log("  peor = casi nada. Perder con alguien mucho peor = caída fuerte;");
console.log("  con alguien mucho mejor = casi no bajas. (Esto es Glicko puro.)");
console.log("");
