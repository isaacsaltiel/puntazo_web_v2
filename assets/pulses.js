// =============================================================
// pulses.js — Puntazo · Cliente unificado para "Pedir Puntazo" (R4)
// =============================================================
// Decide el canal de pulso según el club:
//
//   - Clubs en FIRESTORE_CLUBS  -> escribe directo a Firestore
//                                  pending_pulses/ (R4). La NUC del
//                                  club escucha via onSnapshot y mete
//                                  el pulso a su cola local.
//
//   - Clubs no migrados         -> sigue usando Apps Script + CSV de
//                                  Drive (path legacy desde Etapa 8C).
//
// Esto deja a la web con UN solo entry point limpio para pedir un
// pulso, independiente del club. Cuando la NUC de cada club implemente
// el listener R4, solo hay que agregar el club a FIRESTORE_CLUBS.
//
// Dependencias en el HTML que lo cargue:
//   - Firebase compat SDK (firebase-app + firebase-firestore)
//   - assets/firebase-core.js (window.PuntazoFirebase)
//   - Opcional: assets/auth.js (uid_creator solo si hay sesión)
// =============================================================

(function () {
  "use strict";

  if (window.PuntazoPulses) return;

  const APPS_URL = "https://script.google.com/macros/s/AKfycbzBMGzSOTreHJeW7oCnoO_7qPJ6cBbgby9MMzHUPmBWKYw7Nn-EuWOCZ5vao2ainUN4cg/exec";

  // R4 rollout: clubs cuya NUC ya tiene el listener pending_pulses.
  // Agregar más conforme cada NUC implemente R4.
  const FIRESTORE_CLUBS = ["BreakPoint"];

  // Apps Script (CLUBS en el .gs) tiene keys con espacios para algunos
  // clubs; mapeamos el id interno al display que espera el Script.
  const APPS_CLUB_MAP = {
    "WellStreet-Pickleball": "WellStreet - Pickleball",
  };

  function genClientPulseId() {
    try {
      if (window.crypto && typeof crypto.randomUUID === "function") {
        return "PLS_W_" + crypto.randomUUID();
      }
    } catch (_) {}
    return "PLS_W_" + Math.random().toString(36).slice(2, 10)
      + "_" + Date.now().toString(36);
  }

  // La NUC y el Apps Script esperan `cancha` solo con el dígito (ej "4"),
  // no "Cancha4" como guarda el schema web. Extraemos el primer número.
  function canchaDigit(can) {
    const m = String(can || "").match(/(\d+)/);
    return m ? m[1] : String(can || "");
  }

  async function requestViaFirestore(opts) {
    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function") {
      throw new Error("Firestore no disponible (PuntazoFirebase.db falta).");
    }
    if (!window.firebase || !firebase.firestore) {
      throw new Error("Firebase compat SDK no cargado.");
    }
    const db = window.PuntazoFirebase.db();
    const user = (window.PuntazoAuth && window.PuntazoAuth.currentUser)
      || (firebase.auth && firebase.auth().currentUser)
      || null;

    const isRecovery = opts.source === "recovery";

    const doc = {
      club: opts.loc,
      cancha: canchaDigit(opts.can),
      // Recovery: no sabemos lado en general; la NUC decide (replicar
      // logica del flujo Forms actual). Resto: default LadoA.
      lado: opts.lado !== undefined ? opts.lado : (isRecovery ? null : "LadoA"),
      source: opts.source || "web",
      client_pulse_id: genClientPulseId(),
      match_id: opts.matchId || null,
      uid_creator: user ? user.uid : null,
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      consumed_at: null,
      consumed_by: null,
    };

    // R5: event_at solo para recovery (timestamp del puntazo a recuperar).
    // La NUC usa este campo como anchor temporal en lugar de created_at,
    // y aplica la ventana NVR ±90s que ya tiene para el flujo Forms.
    if (isRecovery) {
      if (!(opts.event_at instanceof Date) || isNaN(opts.event_at.getTime())) {
        throw new Error("requestPulse: source=recovery requiere event_at:Date valido");
      }
      doc.event_at = firebase.firestore.Timestamp.fromDate(opts.event_at);
    }

    const ref = await db.collection("pending_pulses").add(doc);
    return {
      ok: true,
      channel: "firestore",
      docId: ref.id,
      client_pulse_id: doc.client_pulse_id,
    };
  }

  async function requestViaAppsScript(opts) {
    const clubForApps = APPS_CLUB_MAP[opts.loc] || opts.loc;
    const url = APPS_URL
      + "?action=save"
      + "&club=" + encodeURIComponent(clubForApps)
      + "&cancha=" + encodeURIComponent(canchaDigit(opts.can));
    const res = await fetch(url, { redirect: "follow" });
    const data = await res.json();
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Apps Script no devolvió ok");
    }
    return { ok: true, channel: "apps_script", raw: data };
  }

  // requestPulse({ loc, can, lado?, matchId?, source?, event_at? })
  // Devuelve Promise<{ ok: true, channel, ... }>. Throw en error.
  // - source="recovery" REQUIERE event_at:Date (timestamp del puntazo).
  // - recovery siempre va por Firestore (no tiene equivalente Apps Script).
  async function requestPulse(opts) {
    if (!opts || !opts.loc || !opts.can) {
      throw new Error("requestPulse: faltan loc/can");
    }
    if (opts.source === "recovery") {
      // Recovery solo soportado en clubs migrados (Firestore). Si
      // alguien intenta recovery en un club no-Firestore, fallar
      // explicitamente en lugar de caer a Apps Script (que no la soporta).
      if (FIRESTORE_CLUBS.indexOf(opts.loc) < 0) {
        throw new Error("Recuperación aún no disponible para " + opts.loc);
      }
      return requestViaFirestore(opts);
    }
    if (FIRESTORE_CLUBS.indexOf(opts.loc) >= 0) {
      return requestViaFirestore(opts);
    }
    return requestViaAppsScript(opts);
  }

  window.PuntazoPulses = {
    requestPulse: requestPulse,
    FIRESTORE_CLUBS: FIRESTORE_CLUBS.slice(),
    _canchaDigit: canchaDigit,
    _genClientPulseId: genClientPulseId,
  };
})();
