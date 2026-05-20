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

  function sanitizeJugadores(input) {
    if (!Array.isArray(input)) return [];
    return input
      .filter(j => j && typeof j === "object")
      .slice(0, 4)
      .map(j => {
        const out = { nombre: String(j.nombre || "").slice(0, 80) };
        if (j.uid && typeof j.uid === "string") out.uid = j.uid;
        return out;
      });
  }

  // Firestore prohíbe arrays anidados a cualquier profundidad.
  // Shape canónico de marcador.sets: array de objetos { team1, team2 },
  // NO array de arrays [[6,4],...]. Ver docs/matches-schema.md §2.
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
    return m;
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

    const ref = db().collection(COL).doc();
    const data = {
      userId: user.uid,
      loc, can, lado,
      status: "active",
      startedAt: FV().serverTimestamp(),
      endedAt: null,
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
    return snapToDoc(snap);
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
    return snap.docs.map(snapToDoc);
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
    return snapToDoc(snap.docs[0]);
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

  window.PuntazoMatches = {
    create,
    end,
    cancel,
    get,
    listByUser,
    getActiveForUser,
    findClipsForMatch,
    _parseFromName: parseFromName,
    _toMillis: toMillis,
  };
})();
