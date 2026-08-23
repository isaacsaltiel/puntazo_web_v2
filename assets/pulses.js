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
  const FIRESTORE_CLUBS = ["BreakPoint", "WellStreet-Pickleball", "WellStreet-Padel", "Interpadel"];

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

  // ── R9 — "Partido completo" desde recuperación (rango elegido a mano) ──
  // Para clubs donde la recuperación puntual (source="recovery", ventana
  // ±90s) se presta a abuso: un usuario pide 30 recuperaciones seguidas
  // cada ~3 min para reconstruir el partido entero clip por clip (confirmado
  // en datos reales de WellStreet-Pickleball, 22-ago-2026: 1 uid, 34
  // solicitudes en 155 min). Para esos clubs, recuperar.html reemplaza el
  // form de "hora del puntazo" por un rango [inicio,fin] de hasta
  // MATCH_RECORDING_MAX_MINUTES, y este writer reusa EXACTAMENTE el
  // contrato/handler de match_full ya probado (docs/workers/
  // worker-nuc-match-full-grabacion-completa.md): ventana exacta, mismo
  // tag de archivo _PARTIDO_<hash>, mismo badge en card.js. Solo cambia
  // `source` a "match_full_recovery" (no hay matchId real) y se agrega
  // un tope anti-abuso propio del flujo (ver checkFullMatchRecoveryThrottle).
  const FULL_MATCH_RECOVERY_CLUBS = ["WellStreet-Pickleball", "WellStreet-Padel"];
  const FULL_MATCH_RECOVERY_MIN_SECONDS = 60;
  // Tope: máximo N solicitudes por (uid, club, cancha) en una ventana de
  // M minutos. Evita que alguien esquive el límite de 20 min encadenando
  // varias ventanas de "partido completo" en vez de recuperaciones puntuales.
  const FULL_MATCH_RECOVERY_THROTTLE_MAX = 3;
  const FULL_MATCH_RECOVERY_THROTTLE_WINDOW_MIN = 60;

  function canRequestFullMatchRecovery(loc) {
    return FULL_MATCH_RECOVERY_CLUBS.indexOf(loc) >= 0;
  }

  // Cuenta, vía Firestore (regla ya permite leer los propios pending_pulses
  // por uid_creator == auth.uid), cuántas solicitudes match_full_recovery
  // hizo este usuario para esta cancha en la última hora.
  async function checkFullMatchRecoveryThrottle(loc, can, uid) {
    const db = window.PuntazoFirebase.db();
    const snap = await db.collection("pending_pulses")
      .where("uid_creator", "==", uid)
      .where("club", "==", loc)
      .where("cancha", "==", canchaDigit(can))
      .where("source", "==", "match_full_recovery")
      .get();
    const windowMs = FULL_MATCH_RECOVERY_THROTTLE_WINDOW_MIN * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const recent = [];
    snap.forEach(function (doc) {
      const ts = doc.data().created_at;
      const ms = ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
      if (ms && ms >= cutoff) recent.push(ms);
    });
    if (recent.length < FULL_MATCH_RECOVERY_THROTTLE_MAX) {
      return { allowed: true };
    }
    recent.sort(function (a, b) { return a - b; });
    const oldest = recent[0];
    const waitMs = (oldest + windowMs) - Date.now();
    const waitMin = Math.max(1, Math.ceil(waitMs / 60000));
    return { allowed: false, waitMinutes: waitMin };
  }

  // requestFullMatchRecovery({ loc, can, startAt, endAt })
  // Devuelve { ok, channel, docId, client_pulse_id, durationSec, clamped }.
  async function requestFullMatchRecovery(opts) {
    if (!opts || !opts.loc || !opts.can) {
      throw new Error("requestFullMatchRecovery: faltan loc/can");
    }
    if (!canRequestFullMatchRecovery(opts.loc)) {
      throw new Error("Recuperación de partido completo no disponible para " + opts.loc);
    }
    const start = toDate(opts.startAt);
    const end = toDate(opts.endAt);
    if (!start || !end) {
      throw new Error("requestFullMatchRecovery: startAt/endAt inválidos");
    }
    const durationSec = Math.round((end.getTime() - start.getTime()) / 1000);
    if (durationSec <= 0) {
      throw new Error("El fin del rango debe ser posterior al inicio.");
    }
    if (durationSec < FULL_MATCH_RECOVERY_MIN_SECONDS) {
      const e = new Error("El rango es muy corto. Elige al menos 1 minuto.");
      e.code = "range_too_short";
      throw e;
    }
    const maxSec = MATCH_RECORDING_MAX_MINUTES * 60;
    const clamped = durationSec > maxSec;
    if (clamped) {
      const e = new Error("El rango no puede pasar de " + MATCH_RECORDING_MAX_MINUTES + " minutos.");
      e.code = "range_too_long";
      throw e;
    }
    const now = new Date();
    if (end.getTime() > now.getTime() + 60 * 1000) {
      const e = new Error("El fin del rango no puede ser en el futuro.");
      e.code = "range_in_future";
      throw e;
    }

    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function"
        || !window.firebase || !firebase.firestore) {
      throw new Error("Firestore no disponible.");
    }
    const db = window.PuntazoFirebase.db();
    const user = (window.PuntazoAuth && window.PuntazoAuth.currentUser)
      || (firebase.auth && firebase.auth().currentUser) || null;
    if (!user) {
      throw new Error("No se pudo iniciar sesión. Recarga e intenta de nuevo.");
    }

    const throttle = await checkFullMatchRecoveryThrottle(opts.loc, opts.can, user.uid);
    if (!throttle.allowed) {
      const e = new Error("Ya pediste " + FULL_MATCH_RECOVERY_THROTTLE_MAX
        + " partidos completos de esta cancha en la última hora. Intenta de nuevo en ~"
        + throttle.waitMinutes + " min.");
      e.code = "throttled";
      throw e;
    }

    const doc = {
      club: opts.loc,
      cancha: canchaDigit(opts.can),
      lado: null,
      source: "match_full_recovery",
      client_pulse_id: genClientPulseId(),
      match_id: null,
      uid_creator: user.uid,
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
    };
  }

  // R8 — Edición de clips (trim + encuadre dinámico) y extracción de puntazos
  // cortos desde partidos largos. El RENDER se hace en la NUBE (GitHub Actions
  // + ffmpeg), NO en la NUC: la web encola el "spec" en la colección Firestore
  // `clip_edits/` y un workflow la procesa, sube a Dropbox y reindexa. Funciona
  // para CUALQUIER club (el render solo necesita el clip fuente en Dropbox).
  function canEditClip(loc) { return !!loc; }

  // requestClipEdit({ loc, can, lado?, sourceVideoId, sourceUrl, trim:{in,out},
  //   reframe:{ enabled, aspect, keyframes:[{t,x,y,w,h}] }, kind })
  // kind: "edit" (default) | "puntazo" (recorte corto sacado de un partido largo;
  //       NO borra el largo — el fuente queda intacto, esto crea un clip nuevo).
  // Escribe un doc clip_edits/ para que el workflow en la nube renderice con
  // ffmpeg. Coordenadas de reframe NORMALIZADAS [0..1] respecto al frame.
  async function requestClipEdit(opts) {
    if (!opts || !opts.loc || !opts.sourceVideoId || !opts.sourceUrl) {
      throw new Error("requestClipEdit: faltan loc/sourceVideoId/sourceUrl");
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

    const kind = (opts.kind === "puntazo") ? "puntazo" : "edit";
    const doc = {
      club: opts.loc,
      cancha: canchaDigit(opts.can || ""),
      court: opts.can || "",            // court id "CanchaN" (para nombrar/rutear)
      lado: opts.lado || "LadoA",
      kind: kind,
      status: "pending",                // pending → processing → done | error (lo mueve el workflow)
      client_edit_id: "EDIT_" + genClientPulseId().slice(6) + "_" + (opts.sourceVideoId || "").slice(0, 24),
      source_video_id: opts.sourceVideoId,
      source_url: opts.sourceUrl,
      trim: { in: Math.round(tin * 100) / 100, out: Math.round(tout * 100) / 100 },
      reframe: reframe,
      match_id: opts.matchId || null,
      uid_creator: user ? user.uid : null,
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      consumed_at: null,
      result_video_url: null,
      error_reason: null,
    };
    const ref = await db.collection("clip_edits").add(doc);
    return { ok: true, channel: "cloud", docId: ref.id, client_edit_id: doc.client_edit_id };
  }

  window.PuntazoPulses = {
    requestPulse: requestPulse,
    requestMatchRecording: requestMatchRecording,
    canRecordMatch: canRecordMatch,
    requestClipEdit: requestClipEdit,
    canEditClip: canEditClip,
    requestFullMatchRecovery: requestFullMatchRecovery,
    canRequestFullMatchRecovery: canRequestFullMatchRecovery,
    FIRESTORE_CLUBS: FIRESTORE_CLUBS.slice(),
    MATCH_RECORDING_CLUBS: MATCH_RECORDING_CLUBS.slice(),
    MATCH_RECORDING_MAX_MINUTES: MATCH_RECORDING_MAX_MINUTES,
    MATCH_RECORDING_MIN_SECONDS: MATCH_RECORDING_MIN_SECONDS,
    FULL_MATCH_RECOVERY_CLUBS: FULL_MATCH_RECOVERY_CLUBS.slice(),
    FULL_MATCH_RECOVERY_THROTTLE_MAX: FULL_MATCH_RECOVERY_THROTTLE_MAX,
    FULL_MATCH_RECOVERY_THROTTLE_WINDOW_MIN: FULL_MATCH_RECOVERY_THROTTLE_WINDOW_MIN,
    _canchaDigit: canchaDigit,
    _genClientPulseId: genClientPulseId,
  };
})();
