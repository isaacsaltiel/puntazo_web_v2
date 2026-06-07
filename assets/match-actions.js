/* ══════════════════════════════════════════════════════════════
   PUNTAZO — match-actions.js  (F2 · jornada SIN hardware)

   Wrappers async de Firestore para la máquina de confirmación. Usa la
   lógica PURA de assets/match-confirmation.js (testeada en Node) dentro
   de transacciones, y los helpers ya exportados por matches.js
   (_sanitizeJugadores, _normalizeMatchFromDoc).

   Se mantiene SEPARADO de matches.js (que es CRLF y enorme) para no
   ensuciarlo. Cargar DESPUÉS de matches.js + match-confirmation.js.

   API: window.PuntazoMatchActions = { register, confirm, dispute }
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoMatchActions) return;

  const COL = "matches";

  function db() {
    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function") {
      throw new Error("[MatchActions] PuntazoFirebase no disponible.");
    }
    return window.PuntazoFirebase.db();
  }
  function FV() { return firebase.firestore.FieldValue; }
  function currentUser() {
    const u = window.PuntazoAuth && window.PuntazoAuth.currentUser;
    if (!u) throw new Error("[MatchActions] Requiere usuario autenticado.");
    return u;
  }
  function MC() {
    if (!window.PuntazoMatchConfirmation) throw new Error("[MatchActions] match-confirmation.js no cargado.");
    return window.PuntazoMatchConfirmation;
  }
  function PM() {
    if (!window.PuntazoMatches) throw new Error("[MatchActions] matches.js no cargado.");
    return window.PuntazoMatches;
  }
  function nonEmpty(v, name) {
    if (typeof v !== "string" || !v.trim()) throw new Error("[MatchActions] " + name + " requerido.");
    return v.trim();
  }

  const MODOS = ["partido_3", "partido_5", "pickle_1", "pickle_3", "reta", "libre"];
  const DEPORTES = ["padel", "tenis", "pickleball"];

  // ── REGISTRAR un partido ya jugado (jornada B) → pending_confirmation ──
  // opts: { loc, can?, lado?, modo?, deporte?, jugadores[], marcador{sets,ganador}, groupId? }
  // Reglas: el registrante DEBE figurar con su uid; debe haber ≥1 rival con uid
  // (para que alguien pueda confirmar). Los demás pueden ser dummies (sin uid).
  async function register(opts) {
    const o = opts || {};
    const user = currentUser();
    const mc = MC();
    const loc = nonEmpty(o.loc, "loc");
    const can = (typeof o.can === "string" && o.can.trim()) ? o.can.trim() : "manual";
    const lado = (typeof o.lado === "string" && o.lado.trim()) ? o.lado.trim() : "manual";
    const modo = MODOS.includes(o.modo) ? o.modo : "partido_3";
    const deporte = DEPORTES.includes(o.deporte) ? o.deporte : "padel";
    const jugadores = PM()._sanitizeJugadores(o.jugadores || []);

    const marcador = o.marcador || null;
    if (!marcador || (marcador.ganador !== "team1" && marcador.ganador !== "team2")) {
      throw new Error("[MatchActions] El partido necesita un marcador con ganador para registrarse.");
    }

    const myTeam = mc.teamOf({ jugadores: jugadores }, user.uid);
    if (!myTeam) throw new Error("[MatchActions] Debes incluirte (con tu cuenta) como jugador para registrar el partido.");
    const t = mc.teamUids({ jugadores: jugadores });
    const rivalUids = (myTeam === "team1") ? t.team2 : t.team1;
    if (rivalUids.length === 0) {
      throw new Error("[MatchActions] Agrega al menos un rival con cuenta de Puntazo para que pueda confirmar.");
    }

    const nowMs = Date.now();
    const ref = db().collection(COL).doc();
    const scoreAcceptedBy = {};
    scoreAcceptedBy[user.uid] = true; // el registrante auto-acepta su lado (D5)

    await ref.set({
      userId: user.uid,
      loc: loc, can: can, lado: lado,
      status: mc.STATUS.PENDING,
      version: 1,
      modo: modo, deporte: deporte,
      jugadores: jugadores,
      playerUids: t.team1.concat(t.team2), // para reglas Firestore (operador `in`)
      marcador: marcador,
      groupId: (typeof o.groupId === "string" && o.groupId) ? o.groupId : null,
      sessionId: null,
      sourceMode: "manual",
      clipCount: 0,
      scoreAcceptedBy: scoreAcceptedBy,
      confirmation: mc.buildPendingConfirmation(user.uid, nowMs, mc.DEFAULT_WINDOW_DAYS),
      ratingProcessed: false,
      startedAt: FV().serverTimestamp(),
      endedAt: FV().serverTimestamp(),
      createdAt: FV().serverTimestamp(),
      updatedAt: FV().serverTimestamp(),
    });
    return ref.id;
  }

  // ── CONFIRMAR (un rival) → si cierra "1 de cada equipo", pasa a confirmed ──
  async function confirm(matchId) {
    const id = nonEmpty(matchId, "matchId");
    const user = currentUser();
    const mc = MC();
    const ref = db().collection(COL).doc(id);
    return db().runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("[MatchActions] Partido no encontrado.");
      const match = PM()._normalizeMatchFromDoc(Object.assign({ id: snap.id }, snap.data()));
      const res = mc.computeConfirm(match, user.uid, Date.now());
      if (!res.ok) throw new Error(res.reason || "No puedes confirmar este partido.");
      const patch = Object.assign({}, res.patch, {
        updatedAt: FV().serverTimestamp(),
        version: (Number(match.version) || 0) + 1,
      });
      tx.update(ref, patch);
      return { confirmed: !!res.becameConfirmed };
    });
  }

  // ── DISPUTAR → disputed (revisión; el server revierte ranking si aplica) ──
  async function dispute(matchId, reason) {
    const id = nonEmpty(matchId, "matchId");
    const user = currentUser();
    const mc = MC();
    const ref = db().collection(COL).doc(id);
    return db().runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("[MatchActions] Partido no encontrado.");
      const match = PM()._normalizeMatchFromDoc(Object.assign({ id: snap.id }, snap.data()));
      const res = mc.computeDispute(match, user.uid, reason);
      if (!res.ok) throw new Error(res.reason || "No puedes disputar este partido.");
      tx.update(ref, Object.assign({}, res.patch, {
        updatedAt: FV().serverTimestamp(),
        version: (Number(match.version) || 0) + 1,
      }));
      return { disputed: true };
    });
  }

  window.PuntazoMatchActions = { register: register, confirm: confirm, dispute: dispute };
})();
