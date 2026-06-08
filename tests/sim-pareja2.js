/**
 * Muestra el motor ACTUAL (mezcla equipo+individual): la pareja importa, manda el
 * promedio pero lo individual se considera, y dos inseparables convergen lento.
 * Correr:  node tests/sim-pareja2.js
 */
"use strict";
const PR = require("../assets/ranking.js");

function ratingForNivel(n) { return 800 + (n - 1) * 250 + 0.5 * 80; }
function established(n) { return { rating: ratingForNivel(n), RD: 80, volatility: 0.06, matchCount: 30, lastMatchAt: null, recentOpponents: {} }; }
function nivel(rating, rd) { return PR.nivelFromConservativeRating(PR.conservativeRating(rating, rd)); }
function f(x) { return (x >= 0 ? "+" : "") + x.toFixed(3); }
const WIN = [{ team1: 6, team2: 3 }, { team1: 6, team2: 4 }];
const LOSE = [{ team1: 3, team2: 6 }, { team1: 4, team2: 6 }];

function jugar(cur, t1Wins, sets) {
  const match = {
    id: "x", deporte: "padel", modo: "partido_5",
    jugadores: [
      { uid: "a", equipo: "team1" }, { uid: "b", equipo: "team1" },
      { uid: "c", equipo: "team2" }, { uid: "d", equipo: "team2" },
    ],
    marcador: { sets, ganador: t1Wins ? "team1" : "team2" }, endedAt: new Date("2026-06-01"),
  };
  return PR.applyMatchToRatings(match, cur, { skipAntifarm: true });
}

console.log("=== 1) La pareja IMPORTA (manda el promedio, lo individual se considera) ===");
[
  ["Parejo (todos 3.5), ganas", 3.5, 3.5, 3.5, 3.5, true, WIN],
  ["Cargas a un débil y ganan (tú 3.0 + 5.0 vs dos 4.0)", 3.0, 5.0, 4.0, 4.0, true, WIN],
  ["Te arrastra un débil y pierden (tú 5.0 + 3.0 vs dos 4.0)", 5.0, 3.0, 4.0, 4.0, false, LOSE],
].forEach(([t, a, b, c, dd, win, sets]) => {
  const cur = { a: established(a), b: established(b), c: established(c), d: established(dd) };
  const out = jugar(cur, win, sets);
  const dA = nivel(out.newRatings.a.rating, out.newRatings.a.RD) - nivel(cur.a.rating, cur.a.RD);
  const dB = nivel(out.newRatings.b.rating, out.newRatings.b.RD) - nivel(cur.b.rating, cur.b.RD);
  console.log("\n" + t);
  console.log("   jugador " + a + ": " + f(dA) + "    jugador " + b + ": " + f(dB) +
    "   (casi iguales, con un pelín de tilt individual)");
});

console.log("\n\n=== 2) CONVERGENCIA: A(3.0) y B(2.0) SIEMPRE juntos, resultados parejos ===");
console.log("(rivales 2.5, alternando ganar/perder → su 'nivel de equipo' real ~2.5)");
let A = established(3.0), B = established(2.0);
function snap(i) {
  const na = nivel(A.rating, A.RD), nb = nivel(B.rating, B.RD);
  console.log("   partido " + String(i).padStart(3) + "   A=" + na.toFixed(2) + "   B=" + nb.toFixed(2) + "   diferencia=" + (na - nb).toFixed(2));
}
snap(0);
for (let i = 1; i <= 40; i++) {
  const cur = { a: A, b: B, c: established(2.5), d: established(2.5) };
  const out = jugar(cur, i % 2 === 0, i % 2 === 0 ? WIN : LOSE);
  A = out.newRatings.a; B = out.newRatings.b;
  if ([5, 10, 20, 30, 40].indexOf(i) >= 0) snap(i);
}
console.log("\n→ Empiezan separados por 1.00 y se van acercando solos, lento, partido a");
console.log("  partido. Si jugaran con OTROS, su habilidad real los volvería a separar.\n");
