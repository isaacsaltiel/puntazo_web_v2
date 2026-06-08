/**
 * Demo en lenguaje humano del "árbitro" de confirmación (jornada SIN cámara).
 * Usa la MISMA lógica que la app (assets/match-confirmation.js). NO necesita
 * internet ni emulador. Correr:  node tests/demo-confirmacion.js
 */
"use strict";
const MC = require("../assets/match-confirmation.js");

function linea() { console.log("──────────────────────────────────────────────"); }
const AHORA = 1000000000000; // un "ahora" fijo

// Pedro (con Maria) registró un partido contra Carlos y Ana. Pedro auto-aceptó su lado.
let partido = {
  id: "p1",
  userId: "pedro",
  status: MC.STATUS.PENDING,
  jugadores: [
    { uid: "pedro", equipo: "team1", nombre: "Pedro" },
    { uid: "maria", equipo: "team1", nombre: "María" },
    { uid: "carlos", equipo: "team2", nombre: "Carlos" },
    { uid: "ana", equipo: "team2", nombre: "Ana" },
  ],
  marcador: { sets: [{ team1: 6, team2: 4 }, { team1: 6, team2: 3 }], ganador: "team1" },
  scoreAcceptedBy: { pedro: true },
  confirmation: MC.buildPendingConfirmation("pedro", AHORA, 7),
};

console.log("=================================================");
console.log("  DEMO PUNTAZO — el árbitro de confirmación");
console.log("=================================================");
linea();
console.log("📝 Pedro registró: 'Pedro y María 6-4 6-3 a Carlos y Ana'.");
console.log("   Le llega a los otros 3. Estado: PENDIENTE (todavía NO cuenta).");
console.log("   Regla: para que cuente, lo confirma 1 jugador del equipo RIVAL.");
linea();

function intento(quien, uid) {
  const r = MC.computeConfirm(partido, uid, AHORA + 1000);
  if (r.ok && r.becameConfirmed) {
    // aplicar el cambio
    partido.status = MC.STATUS.CONFIRMED;
    console.log("✅ " + quien);
    console.log("   → ¡CUENTA! El partido pasa a CONFIRMADO y se calcula el ranking de los 4.");
  } else if (r.ok) {
    console.log("🟡 " + quien + "  → registrado, pero aún falta que cierre.");
  } else {
    console.log("⛔ " + quien);
    console.log("   → Bloqueado: " + r.reason + ".");
  }
}

console.log("Veamos quién PUEDE y quién NO puede confirmar:\n");
intento("Pedro intenta confirmar su PROPIO partido", "pedro");
intento("María (compañera de Pedro) intenta confirmar", "maria");
intento("Un desconocido (que no jugó) intenta confirmar", "mallory");
intento("Carlos (RIVAL) confirma", "carlos");

linea();
console.log("🛡️  ¿Y si un tramposo quiere CAMBIAR el marcador al confirmar?");
console.log("   El 'guardia de seguridad' (reglas del servidor) solo deja tocar la");
console.log("   confirmación — NO el marcador ni los jugadores. Probado aparte (9/9).");
linea();

// Disputa
console.log("⚖️  Otro caso: Ana dice que el marcador está mal.");
const dis = MC.computeDispute(partido, "ana", "Ese set lo ganamos nosotros");
console.log(dis.ok
  ? "   → El partido pasa a DISPUTADO; el ranking aplicado se revisa/revierte."
  : "   → " + dis.reason);
linea();

// Expiración
console.log("⏳ Y si NADIE confirma en 7 días:");
const viejo = {
  status: MC.STATUS.PENDING,
  confirmation: MC.buildPendingConfirmation("pedro", AHORA, 7),
  jugadores: partido.jugadores,
};
const vencido = MC.isExpired(viejo, AHORA + 8 * 24 * 60 * 60 * 1000);
console.log("   A los 8 días → " + (vencido ? "VENCIDO: el partido NO cuenta para el ranking." : "(sigue vigente)"));
linea();
console.log("Resumen: solo cuenta cuando un RIVAL confirma. Nadie se inventa un");
console.log("resultado solo, nadie cambia el marcador, y lo no confirmado caduca.\n");
