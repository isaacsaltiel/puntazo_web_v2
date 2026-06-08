/* ══════════════════════════════════════════════════════════════
   PUNTAZO — match-confirmation.js  (F2 · spec §4/§6)

   Lógica PURA de la máquina de estados de confirmación de partidos
   (jornada SIN hardware). Sin Firestore: funciones puras sobre el doc
   del match. Los wrappers async (register/confirm/dispute) viven en
   matches.js y llaman estas funciones dentro de transacciones.

   Reusa la semántica de `scoreAcceptedBy` ya existente en matches.js:
   un map { uid: true } de quién aceptó. Regla de confirmación (D5):
   "1 de cada equipo". Quien registra auto-acepta su lado; basta que
   1 jugador del equipo RIVAL acepte para que el partido CUENTE.

   Estados: borrador → en_juego(active) → terminado(ended) →
            pending_confirmation → confirmed | disputed | void

   Export dual browser (window.PuntazoMatchConfirmation) + Node.
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var root = (typeof window !== "undefined")
    ? window
    : (typeof globalThis !== "undefined" ? globalThis : this);
  if (root.PuntazoMatchConfirmation) {
    if (typeof module !== "undefined" && module.exports) module.exports = root.PuntazoMatchConfirmation;
    return;
  }

  var STATUS = {
    ACTIVE: "active",
    ENDED: "ended",
    PENDING: "pending_confirmation",
    CONFIRMED: "confirmed",
    DISPUTED: "disputed",
    VOID: "void",
    CANCELLED: "cancelled",
  };

  var DEFAULT_WINDOW_DAYS = 7; // D5
  var DAY_MS = 24 * 60 * 60 * 1000;

  // uids reales por equipo
  function teamUids(match) {
    var js = Array.isArray(match && match.jugadores) ? match.jugadores : [];
    var t1 = [], t2 = [];
    js.forEach(function (j) {
      if (!j || !j.uid) return;
      if (j.equipo === "team1") t1.push(j.uid);
      else if (j.equipo === "team2") t2.push(j.uid);
    });
    return { team1: t1, team2: t2 };
  }

  // equipo de un uid ("team1" | "team2" | null)
  function teamOf(match, uid) {
    var t = teamUids(match);
    if (t.team1.indexOf(uid) >= 0) return "team1";
    if (t.team2.indexOf(uid) >= 0) return "team2";
    return null;
  }

  function registrantUid(match) {
    return (match && match.confirmation && match.confirmation.registeredBy) ||
           (match && match.userId) || null;
  }

  // Estado de aceptación dado un map scoreAcceptedBy (mismo cómputo que matches.js)
  function acceptanceState(match, accBy) {
    accBy = accBy || (match && match.scoreAcceptedBy) || {};
    var accepted = Object.keys(accBy).filter(function (k) { return !!accBy[k]; });
    var t = teamUids(match);
    var byT1 = t.team1.some(function (u) { return accepted.indexOf(u) >= 0; });
    var byT2 = t.team2.some(function (u) { return accepted.indexOf(u) >= 0; });
    return {
      acceptedUids: accepted,
      acceptedByTeam1: byT1,
      acceptedByTeam2: byT2,
      bothTeamsAccepted: byT1 && byT2,
    };
  }

  // Bloque confirmation inicial para un registro (jornada B).
  function buildPendingConfirmation(registeredByUid, nowMs, windowDays) {
    var days = Number.isFinite(windowDays) ? windowDays : DEFAULT_WINDOW_DAYS;
    return {
      required: true,
      registeredBy: registeredByUid,
      confirmedByUid: null,
      confirmedAt: null,
      expiresAtMs: nowMs + days * DAY_MS,
      disputedByUid: null,
      disputeReason: null,
    };
  }

  // ¿Puede `uid` CONFIRMAR este partido? (debe ser jugador del equipo RIVAL al
  // registrante, el partido debe estar pending, y no haber confirmado ya su lado)
  function canConfirm(match, uid) {
    if (!match || match.status !== STATUS.PENDING) return { ok: false, reason: "El partido no está pendiente de confirmación" };
    if (!uid) return { ok: false, reason: "Sin usuario" };
    var reg = registrantUid(match);
    var myTeam = teamOf(match, uid);
    if (!myTeam) return { ok: false, reason: "No figuras como jugador de este partido" };
    var regTeam = teamOf(match, reg);
    if (regTeam && myTeam === regTeam) return { ok: false, reason: "Te toca confirmar a un jugador del equipo rival" };
    return { ok: true };
  }

  // Calcula la transición al CONFIRMAR. Devuelve el patch a aplicar (campos a
  // escribir) o { ok:false, reason }. Pura: no escribe nada.
  function computeConfirm(match, uid, nowMs) {
    var can = canConfirm(match, uid);
    if (!can.ok) return can;
    var accBy = Object.assign({}, (match && match.scoreAcceptedBy) || {});
    accBy[uid] = true;
    var st = acceptanceState(match, accBy);
    var patch = {};
    patch["scoreAcceptedBy." + uid] = true;
    if (st.bothTeamsAccepted) {
      patch.status = STATUS.CONFIRMED;
      patch["confirmation.confirmedByUid"] = uid;
      patch["confirmation.confirmedAtMs"] = nowMs;
      patch.ratingProcessed = false; // que el trigger lo tome
    }
    return { ok: true, patch: patch, becameConfirmed: !!st.bothTeamsAccepted };
  }

  // ¿Puede `uid` DISPUTAR? (cualquier jugador con uid, mientras esté pending o
  // recién confirmed). Marca disputed para revisión humana → void si no concilia.
  function canDispute(match, uid) {
    if (!match) return { ok: false, reason: "Sin partido" };
    if (match.status !== STATUS.PENDING && match.status !== STATUS.CONFIRMED) {
      return { ok: false, reason: "Solo se puede disputar un partido pendiente o recién confirmado" };
    }
    if (!teamOf(match, uid)) return { ok: false, reason: "No figuras como jugador de este partido" };
    return { ok: true };
  }

  function computeDispute(match, uid, reason) {
    var can = canDispute(match, uid);
    if (!can.ok) return can;
    return {
      ok: true,
      patch: {
        status: STATUS.DISPUTED,
        "confirmation.disputedByUid": uid,
        "confirmation.disputeReason": (typeof reason === "string" ? reason.slice(0, 280) : null),
        ratingProcessed: false, // si estaba confirmed, el recompute lo revierte
      },
    };
  }

  // Resumen del marcador mapeado a equipos, para UI clara (E3b.1). PURA.
  // Devuelve { winnerTeam, winnerNames, rows:[{team, players:[{nombre,uid}],
  // games:[n|null,...], isWinner}], setCount, hasScore }. Degrada con gracia:
  // sin sets → hasScore:false (games vacíos); sin ganador → winnerTeam:null;
  // valor de un set ausente/no numérico → null en games (la vista pinta "–").
  function summarizeScore(match) {
    var m = match || {};
    var marcador = m.marcador || {};
    var sets = Array.isArray(marcador.sets) ? marcador.sets : [];
    var winnerTeam = (marcador.ganador === "team1" || marcador.ganador === "team2")
      ? marcador.ganador : null;
    var js = Array.isArray(m.jugadores) ? m.jugadores : [];
    function playersOf(team) {
      return js.filter(function (j) { return j && j.equipo === team; })
               .map(function (j) { return { nombre: j.nombre || "", uid: j.uid || null }; });
    }
    function gamesOf(team) {
      return sets.map(function (s) {
        var v = s && s[team];
        return (typeof v === "number" && isFinite(v)) ? v : null;
      });
    }
    var rows = ["team1", "team2"].map(function (t) {
      return { team: t, players: playersOf(t), games: gamesOf(t), isWinner: winnerTeam === t };
    });
    return {
      winnerTeam: winnerTeam,
      winnerNames: winnerTeam ? playersOf(winnerTeam).map(function (p) { return p.nombre; }) : [],
      rows: rows,
      setCount: sets.length,
      hasScore: sets.length > 0,
    };
  }

  // ¿Está vencido un pending? (para expiración; el server lo hace por scheduler,
  // pero el cliente lo usa para UI "expirado").
  function isExpired(match, nowMs) {
    if (!match || match.status !== STATUS.PENDING) return false;
    var exp = match.confirmation && match.confirmation.expiresAtMs;
    return Number.isFinite(exp) && nowMs > exp;
  }

  var api = {
    STATUS: STATUS,
    DEFAULT_WINDOW_DAYS: DEFAULT_WINDOW_DAYS,
    teamUids: teamUids,
    teamOf: teamOf,
    registrantUid: registrantUid,
    acceptanceState: acceptanceState,
    buildPendingConfirmation: buildPendingConfirmation,
    canConfirm: canConfirm,
    computeConfirm: computeConfirm,
    canDispute: canDispute,
    computeDispute: computeDispute,
    summarizeScore: summarizeScore,
    isExpired: isExpired,
  };

  root.PuntazoMatchConfirmation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
