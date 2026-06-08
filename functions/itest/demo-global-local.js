/**
 * Demo en lenguaje humano de GLOBAL vs LOCAL (usa la lógica real del servidor,
 * functions/lib/rating.js). NO necesita emulador. Correr (desde functions/):
 *   npm run vendor && node itest/demo-global-local.js
 */
"use strict";
const { planRatingUpdate } = require("../lib/rating.js");

function established(n) {
  const rating = 800 + (n - 1) * 250 + 0.5 * 80;
  return { rating, RD: 80, volatility: 0.06, matchCount: 30, wins: 15, losses: 15, nivel: n, isCalibrating: false, recentOpponents: {}, conservativeRating: rating - 40 };
}
// Estado de niveles por jugador y por contexto
const byUid = {
  pedro: { uid: "pedro", displayName: "Pedro", byContext: { "global:padel": established(4.5) } },
  pablo: { uid: "pablo", displayName: "Pablo", byContext: { "global:padel": established(4.5) } },
  ricky: { uid: "ricky", displayName: "Ricky", byContext: { "global:padel": established(5.0) } },
  raul: { uid: "raul", displayName: "Raúl", byContext: { "global:padel": established(5.0) } },
};
function niv(uid, ctx) { const s = byUid[uid] && byUid[uid].byContext[ctx]; return s ? s.nivel : null; }

function jugar(loc, t1Wins, sets) {
  const match = {
    id: "x", deporte: "padel", loc, modo: "partido_5",
    jugadores: [
      { uid: "pedro", equipo: "team1" }, { uid: "pablo", equipo: "team1" },
      { uid: "ricky", equipo: "team2" }, { uid: "raul", equipo: "team2" },
    ],
    marcador: { sets, ganador: t1Wins ? "team1" : "team2" }, endedAt: new Date("2026-06-01"),
  };
  const plan = planRatingUpdate(match, byUid);
  Object.keys(plan.updatesByUid).forEach((uid) => {
    if (!byUid[uid]) byUid[uid] = { uid, byContext: {} };
    Object.assign(byUid[uid].byContext, plan.updatesByUid[uid]);
  });
}

const PIERDE = [{ team1: 3, team2: 6 }, { team1: 4, team2: 6 }];

console.log("=================================================");
console.log("  DEMO — tu nivel GLOBAL vs tu nivel en un CLUB");
console.log("=================================================");
console.log("\nPedro es 4.5 'nivel Puntazo' (global). Llega a 'ClubPro', donde");
console.log("los regulares (Ricky y Raúl) son 5.0 — un club durísimo para él.\n");

console.log("Nivel de Pedro:        GLOBAL (Puntazo)   LOCAL (ClubPro)");
console.log("   Antes de pisar ClubPro:   " + niv("pedro", "global:padel").toFixed(2) + "             — (aún no juega ahí)");

for (let i = 1; i <= 6; i++) {
  jugar("ClubPro", false, PIERDE); // Pedro y Pablo pierden contra los 5.0
  const g = niv("pedro", "global:padel"), l = niv("pedro", "club:ClubPro:padel");
  console.log("   Tras " + i + " partido(s) en ClubPro:  " + g.toFixed(2) + "             " + l.toFixed(2) +
    (i === 1 ? "   ← su local NACE sembrado de su global (4.5) y baja" : ""));
}

console.log("\n→ Pedro sigue siendo ~" + niv("pedro", "global:padel").toFixed(1) + " en general (nivel Puntazo),");
console.log("  pero en ClubPro es ~" + niv("pedro", "club:ClubPro:padel").toFixed(1) + ": ahí le toca jugar con cracks.");
console.log("  El local NACE de tu global (no en cero) y se adapta a cómo te va EN ESE lugar.");
console.log("  Si Pedro fuera a un club más flojo, su local ahí subiría por encima de 4.5.\n");
