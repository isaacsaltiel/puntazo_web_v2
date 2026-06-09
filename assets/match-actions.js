/* ══════════════════════════════════════════════════════════════
   PUNTAZO — match-actions.js  (F2 · jornada SIN hardware)

   Wrappers async de Firestore para la máquina de confirmación. Usa la
   lógica PURA de assets/match-confirmation.js (testeada en Node) dentro
   de transacciones, y los helpers ya exportados por matches.js
   (_sanitizeJugadores, _normalizeMatchFromDoc).

   Se mantiene SEPARADO de matches.js (que es CRLF y enorme) para no
   ensuciarlo. Cargar DESPUÉS de matches.js + match-confirmation.js.

   API: window.PuntazoMatchActions = { register, confirm, dispute, claim, decline }
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
  // Reglas (E3b · spec §1/§3): el registrante DEBE figurar con su uid y debe haber
  // un marcador con ganador. El resto puede ser PUROS dummies (sin uid): el partido
  // queda pending y el rival reclama+confirma luego vía link (match-actions.claim).
  // Solo CUENTA para el ranking cuando un rival con cuenta confirma.
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

    // E3c (invitados persistentes): para cada dummy (sin uid) con nombre,
    // asegurar un guest del dueño y attachear guestId + ownerUid al slot ANTES
    // de escribir. Best-effort y en paralelo: si la API no está o falla, el
    // registro procede con el dummy plano (NO rompe la transacción ni el flujo).
    try {
      if (window.PuntazoGuests && typeof window.PuntazoGuests.ensureGuest === "function") {
        await Promise.all(jugadores.map(async function (j) {
          if (!j || j.uid) return;                      // cuentas reales no llevan guest
          const nombre = (j.nombre || "").trim();
          if (!nombre) return;
          try {
            const g = await window.PuntazoGuests.ensureGuest(nombre);
            if (g && g.guestId) { j.guestId = g.guestId; j.ownerUid = user.uid; }
          } catch (_) {}
        }));
      }
    } catch (_) {}

    const marcador = o.marcador || null;
    if (!marcador || (marcador.ganador !== "team1" && marcador.ganador !== "team2")) {
      throw new Error("[MatchActions] El partido necesita un marcador con ganador para registrarse.");
    }

    const myTeam = mc.teamOf({ jugadores: jugadores }, user.uid);
    if (!myTeam) throw new Error("[MatchActions] Debes incluirte (con tu cuenta) como jugador para registrar el partido.");
    const t = mc.teamUids({ jugadores: jugadores });
    // E3b: ya NO se exige rival con cuenta. Con puros dummies se registra igual;
    // el rival reclamará su lugar por el link (claim) y entonces podrá confirmar.

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

  // ── Auto-amistad best-effort tras un claim (no rompe el claim si falla) ──
  // Manda solicitud a cada uid distinto al mío que aún no sea amigo/pendiente.
  async function autoFriend(otherUids) {
    if (!window.PuntazoFriends || !Array.isArray(otherUids) || !otherUids.length) return;
    await Promise.all(otherUids.map(function (uid) {
      if (!uid) return Promise.resolve();
      return window.PuntazoFriends.getFriendshipStatus(uid).then(function (status) {
        // Solo si no hay ninguna relación previa (evita duplicar / re-pedir).
        if (status === "none") {
          return window.PuntazoFriends.sendFriendRequest(uid).catch(function () {});
        }
      }).catch(function () {});
    }));
  }

  // ── CLAIM ("yo soy X") → un signedIn que NO es jugador reclama un slot dummy ──
  // Transacción + revalidación adentro (carrera de doble-claim). Cumple isClaimAction:
  // delta de playerUids == EXACTAMENTE mi uid; solo toca jugadores/playerUids/updatedAt/
  // version; NO toca marcador/userId/status/ratingProcessed. Tras éxito: auto-amistad.
  async function claim(matchId, slotIndex) {
    const id = nonEmpty(matchId, "matchId");
    const user = currentUser();
    const mc = MC();
    const slot = Number(slotIndex);
    if (!Number.isInteger(slot) || slot < 0) throw new Error("[MatchActions] Lugar inválido.");
    const ref = db().collection(COL).doc(id);

    const otherUids = await db().runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("[MatchActions] Partido no encontrado.");
      const data = snap.data();
      if (data.status !== mc.STATUS.PENDING) throw new Error("[MatchActions] Este partido ya no admite reclamos.");
      const jugadores = Array.isArray(data.jugadores)
        ? data.jugadores.map(function (j) { return Object.assign({}, j); })
        : [];
      const playerUids = Array.isArray(data.playerUids) ? data.playerUids.slice() : [];
      if (playerUids.indexOf(user.uid) >= 0) throw new Error("[MatchActions] Ya figuras como jugador de este partido.");
      if (slot >= jugadores.length || !jugadores[slot]) throw new Error("[MatchActions] Ese lugar no existe.");
      if (jugadores[slot].uid) throw new Error("[MatchActions] Ese lugar ya fue reclamado por alguien más.");

      jugadores[slot].uid = user.uid;          // el dummy ahora soy yo
      playerUids.push(user.uid);               // delta == exactamente mi uid (isClaimAction)

      tx.update(ref, {
        jugadores: jugadores,
        playerUids: playerUids,
        updatedAt: FV().serverTimestamp(),
        version: (Number(data.version) || 0) + 1,
      });
      return playerUids.filter(function (u) { return u && u !== user.uid; });
    });

    await autoFriend(otherUids); // best-effort, no revierte el claim
    return { claimed: true, slot: slot };
  }

  // ── DECLINE ("no jugué") del COMPAÑERO → se remueve a sí mismo (slot vuelve dummy) ──
  // Cumple isDeclineAction: delta de playerUids == quitar EXACTAMENTE mi uid; solo toca
  // jugadores/playerUids/updatedAt/version. El RIVAL no usa esto: usa dispute (su slot
  // queda; marca el partido en disputa). El REGISTRANTE no aplica (usa cancelar/borrar).
  async function decline(matchId) {
    const id = nonEmpty(matchId, "matchId");
    const user = currentUser();
    const mc = MC();
    const ref = db().collection(COL).doc(id);
    return db().runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("[MatchActions] Partido no encontrado.");
      const data = snap.data();
      if (data.status !== mc.STATUS.PENDING) throw new Error("[MatchActions] Este partido ya no se puede declinar.");
      if (data.userId === user.uid) throw new Error("[MatchActions] Quien registró el partido no puede declinar; cancélalo.");
      const myTeam = mc.teamOf({ jugadores: data.jugadores }, user.uid);
      if (!myTeam) throw new Error("[MatchActions] No figuras como jugador de este partido.");
      const regTeam = mc.teamOf({ jugadores: data.jugadores }, data.userId);
      if (regTeam && myTeam !== regTeam) {
        throw new Error("[MatchActions] Eres del equipo rival: para no validarlo, dispútalo.");
      }
      const jugadores = (Array.isArray(data.jugadores) ? data.jugadores : []).map(function (j) {
        if (j && j.uid === user.uid) { var c = Object.assign({}, j); delete c.uid; return c; } // vuelve a dummy
        return j;
      });
      const playerUids = (Array.isArray(data.playerUids) ? data.playerUids : []).filter(function (u) { return u !== user.uid; });
      tx.update(ref, {
        jugadores: jugadores,
        playerUids: playerUids,
        updatedAt: FV().serverTimestamp(),
        version: (Number(data.version) || 0) + 1,
      });
      return { declined: true };
    });
  }

  window.PuntazoMatchActions = {
    register: register, confirm: confirm, dispute: dispute,
    claim: claim, decline: decline,
  };
})();
