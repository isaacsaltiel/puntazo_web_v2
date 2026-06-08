/**
 * Demo en lenguaje humano del "cerebro" de niveles (assets/ranking.js).
 * NO necesita internet ni emulador. Correr:  node tests/demo.js
 */
"use strict";
const PR = require("../assets/ranking.js");

let ratings = {}; // estado de niveles de todos

function nivelDe(uid) {
  const r = ratings[uid];
  if (!r) return "3.1 🐥 (nuevo, calibrando)";
  const cons = PR.conservativeRating(r.rating, r.RD);
  const b = PR.bucketForRating(cons);
  const cal = r.isCalibrating ? " (calibrando)" : "";
  return b.nivel.toFixed(1) + " " + b.emoji + " " + b.name + cal;
}

function jugar(titulo, nombres, equipos, ganador, marcador) {
  const jugadores = nombres.map((n, i) => ({ uid: n, nombre: cap(n), equipo: equipos[i] }));
  const antes = {};
  nombres.forEach((n) => (antes[n] = nivelDe(n)));
  const match = {
    id: titulo, deporte: "padel", modo: "partido_3",
    jugadores,
    marcador: { sets: marcador, ganador },
    endedAt: new Date("2026-06-01T12:00:00Z"),
  };
  const res = PR.applyMatchToRatings(match, ratings);
  Object.keys(res.newRatings).forEach((u) => (ratings[u] = res.newRatings[u]));

  const eq1 = nombres.filter((_, i) => equipos[i] === "team1").map(cap).join(" y ");
  const eq2 = nombres.filter((_, i) => equipos[i] === "team2").map(cap).join(" y ");
  const sets = marcador.map((s) => s.team1 + "-" + s.team2).join("  ");
  console.log("\n──────────────────────────────────────────────");
  console.log("🎾 " + titulo);
  console.log("   " + eq1 + "   vs   " + eq2 + "     (" + sets + ")");
  console.log("   Ganaron: " + (ganador === "team1" ? eq1 : eq2));
  console.log("   Niveles:");
  nombres.forEach((n) => {
    const flecha = (antes[n] === nivelDe(n)) ? "  =" :
      (parseFloat(nivelDe(n)) > parseFloat(antes[n]) ? "  ▲ subió" : "  ▼ bajó");
    console.log("     " + cap(n).padEnd(8) + antes[n] + "   →   " + nivelDe(n) + flecha);
  });
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

console.log("=================================================");
console.log("  DEMO PUNTAZO — cómo se mueven los niveles");
console.log("  (todos empiezan 'nuevos'; el nivel va del 1.0 al 7.0)");
console.log("=================================================");

jugar("Partido 1 — Ana y Beto ganan cómodo",
  ["ana", "beto", "caro", "dani"], ["team1", "team1", "team2", "team2"],
  "team1", [{ team1: 6, team2: 2 }, { team1: 6, team2: 3 }]);

jugar("Partido 2 — la revancha: Caro y Dani se la devuelven",
  ["ana", "beto", "caro", "dani"], ["team1", "team1", "team2", "team2"],
  "team2", [{ team1: 4, team2: 6 }, { team1: 3, team2: 6 }]);

jugar("Partido 3 — Ana y Beto vuelven a ganar (ya salen de 'calibrando')",
  ["ana", "beto", "caro", "dani"], ["team1", "team1", "team2", "team2"],
  "team1", [{ team1: 6, team2: 4 }, { team1: 7, team2: 5 }]);

console.log("\n──────────────────────────────────────────────");
console.log("✔ El que gana sube, el que pierde baja, y el sistema");
console.log("  pide 3 partidos antes de fiarse del nivel ('calibrando').");
console.log("  Le ganas a alguien más fuerte = subes más. Así de simple.\n");
