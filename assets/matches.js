// =============================================================
// matches.js — Puntazo · Capa de datos para partidos (sesiones)
// =============================================================
// Patrón IIFE + window.PuntazoMatches. Depende de:
//   - window.PuntazoFirebase (assets/firebase-core.js)
//   - window.PuntazoAuth     (assets/auth.js)
//   - firebase compat SDK    (firebase-app + firebase-auth + firebase-firestore)
//
// Este módulo NO debe cargarse desde HTMLs en producción. Sólo desde
// la página de test (docs/workers/etapa-03-test.html) y, en etapas
// futuras, desde entrada.html / mi-partido.html / resumen.html.
// =============================================================

(function () {
  "use strict";

  if (window.PuntazoMatches) return;

  const COL = "matches";
  const MAX_LIST_LIMIT = 200;

  // ---------- helpers ---------------------------------------------------

  function db() {
    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function") {
      throw new Error("[Matches] PuntazoFirebase no disponible. Carga assets/firebase-core.js primero.");
    }
    return window.PuntazoFirebase.db();
  }

  function FV() {
    if (!window.firebase || !firebase.firestore || !firebase.firestore.FieldValue) {
      throw new Error("[Matches] Firestore SDK no disponible.");
    }
    return firebase.firestore.FieldValue;
  }

  function requireUser() {
    const u = window.PuntazoAuth && window.PuntazoAuth.currentUser;
    if (!u) throw new Error("[Matches] Requiere usuario autenticado.");
    return u;
  }

  function nonEmptyString(v, name) {
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`[Matches] ${name} requerido (string no vacío).`);
    }
    return v.trim();
  }

  // -------- schema helpers (Etapa 15) ----------------------------------
  // Mapeo legacy: array plano de 4 slots → posiciones 0-1 son Equipo 1,
  // posiciones 2-3 son Equipo 2 (invariante de Etapa 6.5, ahora soft).
  const LEGACY_INDEX_TO_TEAM = ["team1", "team1", "team2", "team2"];

  const MODOS_VALIDOS = ["partido_3", "partido_5", "reta", "libre"];
  const DEPORTES_VALIDOS = ["padel", "tenis"];

  // Normaliza UN jugador (string legacy / obj / null) a {nombre, equipo, uid?, claimedByUid?}.
  function _normalizeOneJugador(raw, defaultEquipo) {
    const eqDefault = (defaultEquipo === "team1" || defaultEquipo === "team2") ? defaultEquipo : "team1";
    if (typeof raw === "string") {
      return { nombre: String(raw).slice(0, 80), equipo: eqDefault };
    }
    if (!raw || typeof raw !== "object") {
      return { nombre: "", equipo: eqDefault };
    }
    const out = { nombre: String(raw.nombre || "").slice(0, 80) };
    out.equipo = (raw.equipo === "team1" || raw.equipo === "team2") ? raw.equipo : eqDefault;
    if (raw.uid && typeof raw.uid === "string") out.uid = raw.uid;
    if (raw.claimedByUid && typeof raw.claimedByUid === "string") {
      out.claimedByUid = raw.claimedByUid;
    }
    return out;
  }

  // sanitizeJugadores garantiza el invariante 0-ó-4 (length 0 si todos vacíos,
  // length 4 en cualquier otro caso). Cuando el caller manda un array parcial
  // (length 1-3), se reacomoda por equipo: team1 ocupa slots [0,1], team2 ocupa
  // slots [2,3]. Esto evita el bug donde 1 jugador de team2 caía en slot 1 y
  // visualmente aparecía en Equipo 1 (splitTeams mapea por índice, no por campo).
  function sanitizeJugadores(input) {
    if (!Array.isArray(input) || input.length === 0) return [];

    const hasAnyName = input.some(j => {
      if (typeof j === "string") return j.trim().length > 0;
      return j && typeof j === "object" && j.nombre && String(j.nombre).trim().length > 0;
    });
    if (!hasAnyName) return [];

    // Si length === 4, respetar posición del caller (cancha visual ya mapeó por slot).
    // Aún así, FORZAR equipo del slot para garantizar consistencia visual.
    if (input.length === 4) {
      return input.map((raw, idx) => {
        const j = _normalizeOneJugador(raw, LEGACY_INDEX_TO_TEAM[idx]);
        j.equipo = LEGACY_INDEX_TO_TEAM[idx] || "team1";
        return j;
      });
    }

    // Length 1-3: reacomodar por equipo del input, padear a length 4.
    const team1 = [];
    const team2 = [];
    input.slice(0, 4).forEach((raw, idx) => {
      const j = _normalizeOneJugador(raw, LEGACY_INDEX_TO_TEAM[idx]);
      if (j.equipo === "team2") team2.push(j); else team1.push(j);
    });

    return [
      team1[0] ? Object.assign({}, team1[0], { equipo: "team1" }) : { nombre: "", equipo: "team1" },
      team1[1] ? Object.assign({}, team1[1], { equipo: "team1" }) : { nombre: "", equipo: "team1" },
      team2[0] ? Object.assign({}, team2[0], { equipo: "team2" }) : { nombre: "", equipo: "team2" },
      team2[1] ? Object.assign({}, team2[1], { equipo: "team2" }) : { nombre: "", equipo: "team2" },
    ];
  }

  // normalizeMatchFromDoc: aplica backward-compat al LEER el doc.
  // - jugadores: string[] → [{nombre, equipo}], array de objetos sin equipo
  //   → infiere equipo por posición (LEGACY_INDEX_TO_TEAM).
  // - modo: default "partido_3".
  // - deporte: default "padel".
  // - notas: string trimmed (max 280 chars), default "".
  // No muta el doc original; retorna copia normalizada.
  function normalizeMatchFromDoc(data) {
    if (!data || typeof data !== "object") return data;
    const out = Object.assign({}, data);
    out.jugadores = sanitizeJugadores(Array.isArray(data.jugadores) ? data.jugadores : []);
    out.modo = MODOS_VALIDOS.includes(data.modo) ? data.modo : "partido_3";
    out.deporte = DEPORTES_VALIDOS.includes(data.deporte) ? data.deporte : "padel";
    out.notas = sanitizeNotas(data.notas);
    return out;
  }

  // sanitizeNotas (Etapa 15.8 — Feature 3): string limpio max 280 chars.
  // Acepta null/undefined → "". Trim para evitar whitespace ruidoso.
  const NOTAS_MAX = 280;
  function sanitizeNotas(v) {
    if (v == null) return "";
    if (typeof v !== "string") return "";
    const t = v.replace(/\s+$/g, "").replace(/^\s+/g, "");
    return t.slice(0, NOTAS_MAX);
  }

  // Firestore prohíbe arrays anidados a cualquier profundidad.
  // Shape canónico de marcador.sets: array de objetos { team1, team2 },
  // NO array de arrays. Ver docs/matches-schema.md §2.
  function validateMarcador(m) {
    if (m == null) return null;
    if (typeof m !== "object") return null;
    if (Array.isArray(m.sets)) {
      for (const s of m.sets) {
        if (Array.isArray(s)) {
          throw new Error(
            "[Matches] marcador.sets contiene arrays anidados (no soportado por Firestore). " +
            "Usa objetos por set: { sets: [{team1:6,team2:4},{team1:3,team2:6},{team1:7,team2:5}] }"
          );
        }
      }
    }
    if (Array.isArray(m.tiebreak)) {
      for (const t of m.tiebreak) {
        if (Array.isArray(t)) {
          throw new Error("[Matches] marcador.tiebreak contiene arrays anidados.");
        }
      }
    }
    return m;
  }

  // -------- scoring engine (Etapa 15) ----------------------------------
  // validateSet: regla real de pádel. Devuelve uno de:
  //   { state: "valid",         winner: "team1"|"team2" }
  //   { state: "needsTiebreak", winner: null }
  //   { state: "incomplete",    winner: null, hint: "..." }
  //   { state: "invalid",       winner: null, error: "..." }
  //
  // - 6-0..6-4 (diff ≥ 2): valid.
  // - 7-5:                  valid.
  // - 6-6:                  needsTiebreak (sin tb provisto).
  // - 7-6:                  requiere tb provisto y válido (mín 7, diff ≥ 2).
  // - Otros casos < 6:      incomplete.
  // - Casos imposibles:     invalid.
  function validateSet(t1Raw, t2Raw, tb /* { team1, team2 } | null */) {
    const t1 = Number(t1Raw);
    const t2 = Number(t2Raw);
    if (!Number.isInteger(t1) || !Number.isInteger(t2) || t1 < 0 || t2 < 0) {
      return { state: "invalid", winner: null, error: "Los games deben ser enteros ≥ 0." };
    }
    if (t1 > 7 || t2 > 7) {
      return { state: "invalid", winner: null, error: "Un set no puede pasar de 7 games." };
    }
    // 6-0..6-4
    if (t1 === 6 && t2 <= 4) return { state: "valid", winner: "team1" };
    if (t2 === 6 && t1 <= 4) return { state: "valid", winner: "team2" };
    // 7-5
    if (t1 === 7 && t2 === 5) return { state: "valid", winner: "team1" };
    if (t2 === 7 && t1 === 5) return { state: "valid", winner: "team2" };
    // 7-6 con tiebreak
    if ((t1 === 7 && t2 === 6) || (t2 === 7 && t1 === 6)) {
      if (!tb) return { state: "incomplete", winner: null, hint: "Falta el tiebreak." };
      const tbR = validateTiebreak(tb.team1, tb.team2);
      if (tbR.state !== "valid") {
        return { state: "invalid", winner: null, error: tbR.error || "Tiebreak inválido." };
      }
      const setWinner = t1 === 7 ? "team1" : "team2";
      if (tbR.winner !== setWinner) {
        return { state: "invalid", winner: null, error: "El ganador del tiebreak no coincide con el set." };
      }
      return { state: "valid", winner: setWinner };
    }
    // 6-6 → falta tiebreak
    if (t1 === 6 && t2 === 6) return { state: "needsTiebreak", winner: null };
    // Casos imposibles bajo regla de pádel
    if (t1 === 7 || t2 === 7) {
      return { state: "invalid", winner: null, error: "7 sólo es válido como 7-5 o 7-6." };
    }
    if (t1 === 6 || t2 === 6) {
      // 6-5 o 5-6: aún incompleto
      return { state: "incomplete", winner: null, hint: "Set incompleto (jueguen 7-5 o lleguen a 6-6)." };
    }
    return { state: "incomplete", winner: null, hint: "Set incompleto (uno debe llegar a 6 con diferencia ≥ 2)." };
  }

  function validateTiebreak(t1Raw, t2Raw) {
    const t1 = Number(t1Raw);
    const t2 = Number(t2Raw);
    if (!Number.isInteger(t1) || !Number.isInteger(t2) || t1 < 0 || t2 < 0) {
      return { state: "invalid", winner: null, error: "Tiebreak: enteros ≥ 0." };
    }
    const max = Math.max(t1, t2);
    const diff = Math.abs(t1 - t2);
    if (max < 7) return { state: "incomplete", winner: null };
    if (diff < 2) return { state: "incomplete", winner: null };
    return { state: "valid", winner: t1 > t2 ? "team1" : "team2" };
  }

  // deduceMatchWinner: dado modo + sets validados, devuelve quién ganó
  // (si alguien alcanzó el target) y si el partido está completo.
  function deduceMatchWinner(sets, modo) {
    const target = modo === "partido_5" ? 3 : 2;
    let t1 = 0, t2 = 0;
    for (const s of Array.isArray(sets) ? sets : []) {
      if (!s || typeof s !== "object") continue;
      if (s.winner === "team1") t1++;
      else if (s.winner === "team2") t2++;
    }
    let winner = null;
    if (t1 >= target) winner = "team1";
    else if (t2 >= target) winner = "team2";
    return { winner, complete: !!winner, target, t1Sets: t1, t2Sets: t2 };
  }

  // parseFromName: réplica idéntica de la lógica en assets/script.js.
  // Se duplica a propósito para que matches.js sea self-contained y no
  // dependa de cargar script.js (que ejecuta DOMContentLoaded handlers
  // que no aplican fuera de las páginas de producción).
  function parseFromName(name) {
    const re = /^(.+?)_(.+?)_(.+?)_(\d{8})_(\d{6})\.mp4$/i;
    const m = String(name || "").match(re);
    if (!m) return null;
    const [, loc, can, lado, date8, time6] = m;

    const tryYYYYMMDD = () => {
      const Y = Number(date8.slice(0, 4));
      const Mo = Number(date8.slice(4, 6));
      const D = Number(date8.slice(6, 8));
      if (Y >= 1900 && Y <= 2100 && Mo >= 1 && Mo <= 12 && D >= 1 && D <= 31) {
        return { Y: String(Y), M: date8.slice(4, 6), D: date8.slice(6, 8) };
      }
      return null;
    };
    const tryDDMMYYYY = () => {
      const D = Number(date8.slice(0, 2));
      const Mo = Number(date8.slice(2, 4));
      const Y = Number(date8.slice(4, 8));
      if (Y >= 1900 && Y <= 2100 && Mo >= 1 && Mo <= 12 && D >= 1 && D <= 31) {
        return { Y: String(Y), M: date8.slice(2, 4), D: date8.slice(0, 2) };
      }
      return null;
    };

    const d = tryYYYYMMDD() || tryDDMMYYYY();
    if (!d) return null;

    const h = time6.slice(0, 2);
    const mi = time6.slice(2, 4);
    const s = time6.slice(4, 6);
    const date = new Date(
      Number(d.Y), Number(d.M) - 1, Number(d.D),
      Number(h), Number(mi), Number(s)
    );
    return { loc, can, lado, date, Y: d.Y, M: d.M, D: d.D, h, mi, s };
  }

  function toMillis(ts) {
    if (ts == null) return null;
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === "number") return ts;
    if (typeof ts.toDate === "function") {
      try { return ts.toDate().getTime(); } catch { return null; }
    }
    if (typeof ts.seconds === "number") {
      return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
    }
    return null;
  }

  function snapToDoc(snap) {
    return { id: snap.id, ...snap.data() };
  }

  // ---------- config / clips lookup -------------------------------------

  let _configCache = null;

  async function _loadConfig() {
    if (_configCache) return _configCache;
    try {
      const res = await fetch("data/config_locations.json?cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return null;
      _configCache = await res.json();
      return _configCache;
    } catch (e) {
      console.warn("[Matches] No se pudo cargar config_locations.json:", e);
      return null;
    }
  }

  async function _findJsonUrl(loc, can, lado) {
    const cfg = await _loadConfig();
    if (!cfg || !Array.isArray(cfg.locaciones)) return null;
    const L = cfg.locaciones.find(x => x.id === loc);
    if (!L || !Array.isArray(L.cancha)) return null;
    const C = L.cancha.find(x => x.id === can);
    if (!C || !Array.isArray(C.lados)) return null;
    const Ld = C.lados.find(x => x.id === lado);
    return Ld && Ld.json_url ? Ld.json_url : null;
  }

  // ---------- API público -----------------------------------------------

  async function create(opts) {
    const o = opts || {};
    const user = requireUser();
    const loc = nonEmptyString(o.loc, "loc");
    const can = nonEmptyString(o.can, "can");
    const lado = nonEmptyString(o.lado, "lado");

    const modo = MODOS_VALIDOS.includes(o.modo) ? o.modo : "partido_3";
    const deporte = DEPORTES_VALIDOS.includes(o.deporte) ? o.deporte : "padel";

    const ref = db().collection(COL).doc();
    const data = {
      userId: user.uid,
      loc, can, lado,
      status: "active",
      startedAt: FV().serverTimestamp(),
      endedAt: null,
      modo,
      deporte,
      marcador: validateMarcador(o.marcadorInicial),
      jugadores: sanitizeJugadores(o.jugadores),
      clipCount: 0,
      createdAt: FV().serverTimestamp(),
      updatedAt: FV().serverTimestamp(),
    };
    await ref.set(data);
    return ref.id;
  }

  async function get(matchId) {
    const id = nonEmptyString(matchId, "matchId");
    const snap = await db().collection(COL).doc(id).get();
    if (!snap.exists) return null;
    const raw = snapToDoc(snap);
    return normalizeMatchFromDoc(raw);
  }

  async function updateMatch(matchId, opts) {
    const id = nonEmptyString(matchId, "matchId");
    const o = opts || {};
    const ref = db().collection(COL).doc(id);
    const upd = { updatedAt: FV().serverTimestamp() };
    if (o.jugadores !== undefined) upd.jugadores = sanitizeJugadores(o.jugadores);
    if (o.marcador !== undefined)  upd.marcador = validateMarcador(o.marcador);
    if (o.modo !== undefined) {
      if (!MODOS_VALIDOS.includes(o.modo)) throw new Error("[Matches] modo inválido.");
      upd.modo = o.modo;
    }
    if (o.deporte !== undefined) {
      if (!DEPORTES_VALIDOS.includes(o.deporte)) throw new Error("[Matches] deporte inválido.");
      upd.deporte = o.deporte;
    }
    if (o.notas !== undefined) {
      upd.notas = sanitizeNotas(o.notas);
    }
    await ref.update(upd);
  }

  async function end(matchId, opts) {
    const id = nonEmptyString(matchId, "matchId");
    const o = opts || {};
    const ref = db().collection(COL).doc(id);

    const update = {
      status: "ended",
      endedAt: FV().serverTimestamp(),
      updatedAt: FV().serverTimestamp(),
    };
    if (o.marcador !== undefined) {
      update.marcador = validateMarcador(o.marcador);
    }
    if (o.jugadores !== undefined) {
      update.jugadores = sanitizeJugadores(o.jugadores);
    }
    if (o.modo !== undefined) {
      if (!MODOS_VALIDOS.includes(o.modo)) throw new Error("[Matches] modo inválido.");
      update.modo = o.modo;
    }
    if (o.deporte !== undefined) {
      if (!DEPORTES_VALIDOS.includes(o.deporte)) throw new Error("[Matches] deporte inválido.");
      update.deporte = o.deporte;
    }
    await ref.update(update);

    // Best-effort: re-count clips dentro de la ventana y actualizar clipCount.
    // Si falla (JSON no disponible, sin clips), no rompemos el flujo.
    try {
      const fresh = await get(id);
      if (fresh) {
        const clips = await findClipsForMatch(fresh);
        await ref.update({
          clipCount: clips.length,
          updatedAt: FV().serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn("[Matches] clipCount recount falló (no bloqueante):", e);
    }
  }

  async function cancel(matchId) {
    const id = nonEmptyString(matchId, "matchId");
    await db().collection(COL).doc(id).update({
      status: "cancelled",
      updatedAt: FV().serverTimestamp(),
    });
  }

  async function listByUser(userId, opts) {
    const uid = nonEmptyString(userId, "userId");
    const o = opts || {};
    const limit = Math.max(1, Math.min(Number(o.limit) || 20, MAX_LIST_LIMIT));

    let q = db().collection(COL).where("userId", "==", uid);
    if (o.status) q = q.where("status", "==", String(o.status));
    q = q.orderBy("startedAt", "desc").limit(limit);

    const snap = await q.get();
    return snap.docs.map(snapToDoc).map(normalizeMatchFromDoc);
  }

  async function getActiveForUser(userId) {
    const uid = nonEmptyString(userId, "userId");
    const snap = await db().collection(COL)
      .where("userId", "==", uid)
      .where("status", "==", "active")
      .orderBy("startedAt", "desc")
      .limit(1)
      .get();
    if (snap.empty) return null;
    return normalizeMatchFromDoc(snapToDoc(snap.docs[0]));
  }

  async function findClipsForMatch(matchDoc) {
    if (!matchDoc || !matchDoc.loc || !matchDoc.can || !matchDoc.lado) return [];

    const startMs = toMillis(matchDoc.startedAt);
    if (startMs == null) return [];
    const endMs = toMillis(matchDoc.endedAt) || Date.now();

    const url = await _findJsonUrl(matchDoc.loc, matchDoc.can, matchDoc.lado);
    if (!url) return [];

    let data;
    try {
      const res = await fetch(url + "?cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return [];
      data = await res.json();
    } catch (e) {
      console.warn("[Matches] No se pudo bajar JSON de clips:", e);
      return [];
    }

    const videos = Array.isArray(data && data.videos) ? data.videos : [];
    const out = [];
    for (const v of videos) {
      if (!v || !v.nombre) continue;
      const m = parseFromName(v.nombre);
      if (!m) continue;
      // Doble verificación: el JSON puede tener un clip cuyo nombre no
      // coincida con loc/can/lado (improbable pero defensivo).
      if (m.loc !== matchDoc.loc || m.can !== matchDoc.can || m.lado !== matchDoc.lado) continue;
      const ts = m.date.getTime();
      if (ts >= startMs && ts <= endMs) {
        out.push({
          videoId: v.nombre,
          videoUrl: v.url,
          club: matchDoc.loc,
          cancha: matchDoc.can,
          lado: matchDoc.lado,
          fecha: `${m.Y}-${m.M}-${m.D}`,
          timestamp: ts,
          nombre: v.nombre,
        });
      }
    }
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
  }

  // =================================================================
  // Claims (Etapa 15.5) — subcollection matches/{matchId}/claims/{uid}
  // =================================================================
  // Modelo: cada invitado autenticado puede reclamar UN slot (0..3) del
  // partido. El doc id es el `auth.uid`, así garantiza un claim por user.
  // Schema: { slot, claimedAt, displayName? }
  //
  // NOTA importante sobre la rule de CREATE:
  //   request.resource.data.claimedAt == request.time
  // Firestore materializa el sentinel serverTimestamp() a request.time
  // ANTES de evaluar las reglas, así que enviar FV().serverTimestamp() en
  // `claimedAt` satisface el chequeo. La rule de UPDATE NO lo exige.

  const CLAIMS_SUB = "claims";

  function _claimsCol(matchId) {
    const id = nonEmptyString(matchId, "matchId");
    return db().collection(COL).doc(id).collection(CLAIMS_SUB);
  }

  function _claimDocToObj(d) {
    const data = d.data() || {};
    return {
      uid: d.id,
      slot: Number.isInteger(data.slot) ? data.slot : Number(data.slot),
      claimedAt: data.claimedAt || null,
      displayName: typeof data.displayName === "string" ? data.displayName : "",
    };
  }

  // subscribeToClaims: onSnapshot a la subcollection. Devuelve unsubscribe.
  // onUpdate recibe Array<{ uid, slot, claimedAt, displayName }>, ordenado
  // por claimedAt ascendente (más antiguo primero) — útil para resolución
  // visual de conflictos (el más reciente es el último del array).
  function subscribeToClaims(matchId, onUpdate, onError) {
    const col = _claimsCol(matchId);
    return col.onSnapshot(function (snap) {
      const arr = [];
      snap.forEach(function (d) { arr.push(_claimDocToObj(d)); });
      arr.sort(function (a, b) {
        const am = toMillis(a.claimedAt) || 0;
        const bm = toMillis(b.claimedAt) || 0;
        return am - bm;
      });
      if (typeof onUpdate === "function") onUpdate(arr);
    }, function (err) {
      if (typeof onError === "function") onError(err);
    });
  }

  // claimSlot: crea o actualiza el claim del usuario actual.
  // - slotIndex debe estar en 0..3.
  // - displayName es opcional; si se omite, se usa user.displayName.
  // - Usa set() (sin merge) para que el doc quede con shape canónico.
  //
  // Etapa 15.7: el doc incluye `uid: user.uid` (idéntico al doc id) para
  // permitir queries con collectionGroup('claims').where('uid','==', miUid)
  // desde perfil.html ("Mis partidos"). Las rules ya validan que coincida.
  async function claimSlot(matchId, slotIndex, displayName) {
    const user = requireUser();
    const slot = Number(slotIndex);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) {
      throw new Error("[Matches] slot inválido (debe ser 0..3).");
    }
    const id = nonEmptyString(matchId, "matchId");
    const nm = (typeof displayName === "string" && displayName.trim())
      ? displayName.trim().slice(0, 80)
      : (user.displayName ? String(user.displayName).slice(0, 80) : "");
    const ref = db().collection(COL).doc(id).collection(CLAIMS_SUB).doc(user.uid);
    await ref.set({
      uid: user.uid,
      slot: slot,
      claimedAt: FV().serverTimestamp(),
      displayName: nm,
    });
  }

  // unclaimSlot: borra el claim del usuario actual.
  async function unclaimSlot(matchId) {
    const user = requireUser();
    const id = nonEmptyString(matchId, "matchId");
    await db().collection(COL).doc(id).collection(CLAIMS_SUB).doc(user.uid).delete();
  }

  // unclaimSlotAsOwner: el dueño del partido borra el claim de OTRO usuario.
  // La rule de delete lo permite por get(matches/$matchId).data.userId ==
  // request.auth.uid. Si el caller no es el dueño, Firestore devuelve
  // permission-denied.
  async function unclaimSlotAsOwner(matchId, claimUid) {
    requireUser();
    const id = nonEmptyString(matchId, "matchId");
    const cu = nonEmptyString(claimUid, "claimUid");
    await db().collection(COL).doc(id).collection(CLAIMS_SUB).doc(cu).delete();
  }

  // mergeMatchWithClaims: devuelve copia del match con jugadores[]
  // enriquecido por los claims. NO muta el doc original.
  // Reglas de merge:
  //   - Para cada claim, slot ∈ 0..3:
  //     · Si jugadores[slot] tiene `uid` ya ≠ del claim → conflicto: NO
  //       se sobreescribe (gana el `uid` del schema, que fue puesto a
  //       conciencia por el dueño en Etapa 15). El claim queda visible
  //       como "pendiente" — lo decide la UI.
  //     · Si jugadores[slot] está vacío o sin uid → se pone uid del claim
  //       y, si nombre estaba vacío, también displayName.
  //   - Si hay 2 claims al mismo slot, gana el más reciente (claims viene
  //     ordenado ascendente; iteramos en orden, último escribe).
  function mergeMatchWithClaims(match, claims) {
    if (!match || typeof match !== "object") return match;
    const out = Object.assign({}, match);
    const base = Array.isArray(match.jugadores) ? match.jugadores : [];
    // Asegurar 4 slots con equipo por defecto.
    const slots = [0, 1, 2, 3].map(function (i) {
      const defaultEquipo = LEGACY_INDEX_TO_TEAM[i] || "team1";
      const src = base[i] || {};
      const o = {
        nombre: String(src.nombre || ""),
        equipo: (src.equipo === "team1" || src.equipo === "team2") ? src.equipo : defaultEquipo,
      };
      if (src.uid) o.uid = src.uid;
      if (src.claimedByUid) o.claimedByUid = src.claimedByUid;
      return o;
    });
    if (Array.isArray(claims)) {
      claims.forEach(function (c) {
        if (!c || !Number.isInteger(c.slot) || c.slot < 0 || c.slot > 3) return;
        const cur = slots[c.slot];
        // Conflicto con uid ya asignado por el dueño (Etapa 15): respetar
        // el del schema. La UI puede mostrar el claim como pendiente.
        if (cur.uid && cur.uid !== c.uid) return;
        cur.claimedByUid = c.uid;
        if (!cur.nombre && c.displayName) cur.nombre = String(c.displayName).slice(0, 80);
      });
    }
    out.jugadores = slots;
    return out;
  }

  window.PuntazoMatches = {
    create,
    update: updateMatch,
    end,
    cancel,
    get,
    listByUser,
    getActiveForUser,
    findClipsForMatch,
    subscribeToClaims,
    claimSlot,
    unclaimSlot,
    unclaimSlotAsOwner,
    mergeMatchWithClaims,
    score: {
      validateSet,
      validateTiebreak,
      deduceMatchWinner,
    },
    MODOS: MODOS_VALIDOS.slice(),
    DEPORTES: DEPORTES_VALIDOS.slice(),
    _parseFromName: parseFromName,
    _toMillis: toMillis,
    _normalizeMatchFromDoc: normalizeMatchFromDoc,
    _sanitizeJugadores: sanitizeJugadores,
  };
})();
