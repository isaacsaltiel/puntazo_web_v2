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

  // R7 — "Partido completo": clubs cuya NUC sabe procesar source="match_full"
  // (cortar el NVR del inicio al fin del partido). Hoy: pickleball de WellStreet,
  // donde los partidos son cortos. El maestro agrega el club aquí en el mismo
  // swap en que la NUC despliega el handler match_full (igual que FIRESTORE_CLUBS).
  const MATCH_RECORDING_CLUBS = ["WellStreet-Pickleball"];
  // Tope de duración subida (la NUC clampa de forma autoritativa; esto es para
  // UX/validación en el cliente). Mín para evitar clips basura.
  const MATCH_RECORDING_MAX_MINUTES = 20;
  const MATCH_RECORDING_MIN_SECONDS = 20;

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

  // ── R7 — Solicitud de "Partido completo" ──────────────────────────────
  // Escribe un doc pending_pulses con source="match_full" para que la NUC corte
  // el NVR del inicio al fin del partido (clamp 20 min, ancla al final, lo hace
  // la NUC). Idempotente: client_pulse_id determinístico por matchId, así un
  // doble click NO duplica el upload (la NUC dedup por external_id).
  //
  // toDate: acepta Date | Firestore Timestamp | {seconds} | ms-number.
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v.toDate === "function") { try { return v.toDate(); } catch (_) { return null; } }
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    if (typeof v === "number") return new Date(v);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function canRecordMatch(loc) {
    return MATCH_RECORDING_CLUBS.indexOf(loc) >= 0;
  }

  // requestMatchRecording({ loc, can, lado?, matchId, startAt, endAt })
  // Devuelve { ok, channel, docId, client_pulse_id, durationSec, clamped, recordedMinutes }.
  // Lanza si: club no soportado, falta data, ventana inválida o partido < mínimo.
  async function requestMatchRecording(opts) {
    if (!opts || !opts.loc || !opts.can || !opts.matchId) {
      throw new Error("requestMatchRecording: faltan loc/can/matchId");
    }
    if (!canRecordMatch(opts.loc)) {
      throw new Error("Grabación de partido completo no disponible para " + opts.loc);
    }
    const start = toDate(opts.startAt);
    const end = toDate(opts.endAt);
    if (!start || !end) {
      throw new Error("requestMatchRecording: startAt/endAt inválidos");
    }
    const durationSec = Math.round((end.getTime() - start.getTime()) / 1000);
    if (durationSec <= 0) {
      throw new Error("requestMatchRecording: el fin del partido no es posterior al inicio");
    }
    if (durationSec < MATCH_RECORDING_MIN_SECONDS) {
      const e = new Error("El partido es demasiado corto para grabarlo completo.");
      e.code = "match_too_short";
      throw e;
    }
    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function"
        || !window.firebase || !firebase.firestore) {
      throw new Error("Firestore no disponible.");
    }
    const db = window.PuntazoFirebase.db();
    const user = (window.PuntazoAuth && window.PuntazoAuth.currentUser)
      || (firebase.auth && firebase.auth().currentUser) || null;

    const maxSec = MATCH_RECORDING_MAX_MINUTES * 60;
    const clamped = durationSec > maxSec;
    // La web manda la ventana REAL; la NUC clampa autoritativamente al final.
    // recordedMinutes es solo informativo para la UI.
    const recordedMinutes = Math.min(durationSec, maxSec) / 60;

    const doc = {
      club: opts.loc,
      cancha: canchaDigit(opts.can),
      lado: opts.lado || "LadoA",
      source: "match_full",
      // Determinístico por partido → idempotencia end-to-end.
      client_pulse_id: "PLS_M_" + opts.matchId,
      match_id: opts.matchId,
      uid_creator: user ? user.uid : null,
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      start_at: firebase.firestore.Timestamp.fromDate(start),
      end_at: firebase.firestore.Timestamp.fromDate(end),
      consumed_at: null,
      consumed_by: null,
    };

    const ref = await db.collection("pending_pulses").add(doc);
    return {
      ok: true,
      channel: "firestore",
      docId: ref.id,
      client_pulse_id: doc.client_pulse_id,
      durationSec: durationSec,
      clamped: clamped,
      recordedMinutes: recordedMinutes,
    };
  }

  // R8 — clubs cuya NUC sabe renderizar ediciones de clip (trim + encuadre
  // dinámico) vía ffmpeg. El maestro lo activa en el swap con la NUC.
  const CLIP_EDIT_CLUBS = ["WellStreet-Pickleball"];
  function canEditClip(loc) { return CLIP_EDIT_CLUBS.indexOf(loc) >= 0; }

  // requestClipEdit({ loc, can, lado?, sourceVideoId, sourceUrl, trim:{in,out},
  //   reframe:{ enabled, aspect, keyframes:[{t,x,y,w,h}] } })
  // Escribe un doc pending_pulses source="clip_edit" para que la NUC corte y
  // reencuadre el clip con ffmpeg y lo suba reindexado. Coordenadas de reframe
  // NORMALIZADAS [0..1] respecto al frame (independientes de resolución).
  async function requestClipEdit(opts) {
    if (!opts || !opts.loc || !opts.sourceVideoId || !opts.sourceUrl) {
      throw new Error("requestClipEdit: faltan loc/sourceVideoId/sourceUrl");
    }
    if (!canEditClip(opts.loc)) {
      throw new Error("Edición de clips no disponible para " + opts.loc);
    }
    const trim = opts.trim || {};
    const tin = Math.max(0, Number(trim.in) || 0);
    const tout = Number(trim.out);
    if (!(tout > tin)) throw new Error("Recorte inválido: el fin debe ser mayor al inicio.");
    if ((tout - tin) > 600) throw new Error("El recorte no puede exceder 10 minutos.");

    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function"
        || !window.firebase || !firebase.firestore) {
      throw new Error("Firestore no disponible.");
    }
    const db = window.PuntazoFirebase.db();
    const user = (window.PuntazoAuth && window.PuntazoAuth.currentUser)
      || (firebase.auth && firebase.auth().currentUser) || null;

    // Sanitiza reframe (normalizado 0..1, clamp, máximo de keyframes).
    const rf = opts.reframe || {};
    let keyframes = Array.isArray(rf.keyframes) ? rf.keyframes.slice(0, 12) : [];
    function cl01(n, d) { n = Number(n); if (!isFinite(n)) return d; return Math.max(0, Math.min(1, n)); }
    keyframes = keyframes.map(function (k) {
      return {
        t: Math.max(0, Number(k.t) || 0),
        x: cl01(k.x, 0), y: cl01(k.y, 0),
        w: cl01(k.w, 1), h: cl01(k.h, 1),
      };
    });
    const reframe = {
      enabled: !!rf.enabled && keyframes.length > 0,
      aspect: typeof rf.aspect === "string" ? rf.aspect : "free",
      keyframes: keyframes,
    };

    const doc = {
      club: opts.loc,
      cancha: canchaDigit(opts.can || ""),
      lado: opts.lado || "LadoA",
      source: "clip_edit",
      client_pulse_id: "EDIT_" + genClientPulseId().slice(6) + "_" + (opts.sourceVideoId || "").slice(0, 24),
      source_video_id: opts.sourceVideoId,
      source_url: opts.sourceUrl,
      trim: { in: Math.round(tin * 100) / 100, out: Math.round(tout * 100) / 100 },
      reframe: reframe,
      match_id: opts.matchId || null,
      uid_creator: user ? user.uid : null,
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      consumed_at: null,
      consumed_by: null,
    };
    const ref = await db.collection("pending_pulses").add(doc);
    return { ok: true, channel: "firestore", docId: ref.id, client_pulse_id: doc.client_pulse_id };
  }

  window.PuntazoPulses = {
    requestPulse: requestPulse,
    requestMatchRecording: requestMatchRecording,
    canRecordMatch: canRecordMatch,
    requestClipEdit: requestClipEdit,
    canEditClip: canEditClip,
    CLIP_EDIT_CLUBS: CLIP_EDIT_CLUBS.slice(),
    FIRESTORE_CLUBS: FIRESTORE_CLUBS.slice(),
    MATCH_RECORDING_CLUBS: MATCH_RECORDING_CLUBS.slice(),
    MATCH_RECORDING_MAX_MINUTES: MATCH_RECORDING_MAX_MINUTES,
    MATCH_RECORDING_MIN_SECONDS: MATCH_RECORDING_MIN_SECONDS,
    _canchaDigit: canchaDigit,
    _genClientPulseId: genClientPulseId,
  };
})();
