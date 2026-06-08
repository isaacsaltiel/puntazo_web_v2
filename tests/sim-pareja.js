/**
 * Compara el modelo de HOY (cada quien vs promedio rival, ignora a tu pareja)
 * contra la PROPUESTA de Isaac (equipo-promedio vs equipo-promedio, ambos se
 * mueven IGUAL). Correr:  node tests/sim-pareja.js
 */
"use strict";
const PR = require("../assets/ranking.js");

const BONUS_MAX = 16;
function ratingForNivel(n) { return 800 + (n - 1) * 250 + 0.5 * 80; }
function established(n) { return { rating: ratingForNivel(n), RD: 80, volatility: 0.06, matchCount: 30, lastMatchAt: null, recentOpponents: {} }; }
function nivel(rating, rd) { return PR.nivelFromConservativeRating(PR.conservativeRating(rating, rd)); }
function teamAgg(players) {
  const r = players.reduce((a, p) => ({ rating: a.rating + p.rating, rdSq: a.rdSq + p.RD * p.RD }), { rating: 0, rdSq: 0 });
  return { rating: r.rating / players.length, rd: Math.sqrt(r.rdSq / players.length), vol: 0.06 };
}
function expected(aR, aRd, bR, bRd) { const a = PR._toGlicko2(aR, aRd), b = PR._toGlicko2(bR, bRd); return PR._E(a.mu, b.mu, b.phi); }
function games(sets) { let a = 0, b = 0; sets.forEach(s => { a += s.team1; b += s.team2; }); return { a, b }; }
function f(x) { return (x >= 0 ? "+" : "") + x.toFixed(3); }

// HOY: usa el motor real, devuelve Δnivel de cada jugador del team1.
function hoy(nA, nB, oppA, oppB, t1Wins, sets) {
  const cur = { a: established(nA), b: established(nB), c: established(oppA), d: established(oppB) };
  const match = {
    id: "x", deporte: "padel", modo: "partido_5",
    jugadores: [
      { uid: "a", equipo: "team1" }, { uid: "b", equipo: "team1" },
      { uid: "c", equipo: "team2" }, { uid: "d", equipo: "team2" },
    ],
    marcador: { sets, ganador: t1Wins ? "team1" : "team2" }, endedAt: new Date("2026-06-01"),
  };
  const out = PR.applyMatchToRatings(match, cur, { skipAntifarm: true });
  return {
    a: nivel(out.newRatings.a.rating, out.newRatings.a.RD) - nivel(cur.a.rating, cur.a.RD),
    b: nivel(out.newRatings.b.rating, out.newRatings.b.RD) - nivel(cur.b.rating, cur.b.RD),
  };
}

// PROPUESTA: equipo-promedio vs equipo-promedio, MISMO delta a los dos.
function propuesta(nA, nB, oppA, oppB, t1Wins, sets) {
  const me = [established(nA), established(nB)], op = [established(oppA), established(oppB)];
  const myAgg = teamAgg(me), opAgg = teamAgg(op);
  const g = games(sets);
  const gw = t1Wins ? g.a : g.b, gl = t1Wins ? g.b : g.a;
  const d = Math.max(0, Math.min(1, (gw - gl) / Math.max(1, gw + gl)));
  const soft = t1Wins ? 0.5 + 0.5 * d : 0.5 - 0.5 * d, closeness = 1 - d;
  const expTeam = expected(myAgg.rating, myAgg.rd, opAgg.rating, opAgg.rd);
  const teamUpd = PR._updatePlayer(myAgg.rating, myAgg.rd, myAgg.vol, [{ rating: opAgg.rating, rd: opAgg.rd, score: soft }]);
  let teamDelta = (teamUpd.rating - myAgg.rating) + BONUS_MAX * closeness * (1 - expTeam);
  if (t1Wins && teamDelta < 0) teamDelta = 1;
  // mismo delta (en pts) a los dos; RD evoluciona por jugador
  function dN(p) {
    const upd = PR._updatePlayer(p.rating, p.RD, p.volatility, [{ rating: opAgg.rating, rd: opAgg.rd, score: soft }]);
    return nivel(p.rating + teamDelta, upd.rd) - nivel(p.rating, p.RD);
  }
  return { a: dN(me[0]), b: dN(me[1]) };
}

function caso(titulo, nA, nB, oppA, oppB, t1Wins, sets) {
  const h = hoy(nA, nB, oppA, oppB, t1Wins, sets), p = propuesta(nA, nB, oppA, oppB, t1Wins, sets);
  console.log("\n" + titulo);
  console.log("   Tu equipo: " + nA + " + " + nB + "   vs   Rival: " + oppA + " + " + oppB + "   (" + (t1Wins ? "GANAS" : "PIERDES") + ")");
  console.log("                       jugador " + nA + "      jugador " + nB);
  console.log("   HOY (ignora pareja) " + f(h.a).padEnd(13) + f(h.b));
  console.log("   PROPUESTA (igual)   " + f(p.a).padEnd(13) + f(p.b));
}

const WIN = [{ team1: 6, team2: 3 }, { team1: 6, team2: 4 }];
const LOSE = [{ team1: 3, team2: 6 }, { team1: 4, team2: 6 }];

console.log("=== HOY vs PROPUESTA (compañero importa) ===");
caso("CASO 1 — Parejo (todos 3.5)", 3.5, 3.5, 3.5, 3.5, true, WIN);
caso("CASO 2 — CARGAS a un débil y GANAN (tú 3.0 con 5.0 vs dos 4.0)", 3.0, 5.0, 4.0, 4.0, true, WIN);
caso("CASO 3 — Te ARRASTRA un débil y PIERDEN (tú 5.0 con 3.0 vs dos 4.0)", 5.0, 3.0, 4.0, 4.0, false, LOSE);
console.log("");
