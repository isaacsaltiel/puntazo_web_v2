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

  // Modos pádel/tenis (sets) + pickleball (juegos a 11) + agnósticos (reta/libre).
  //   partido_3/_5 → mejor de 3/5 sets (regla pádel/tenis).
  //   pickle_1      → 1 juego a 11 (gana por 2).
  //   pickle_3      → mejor de 3 juegos a 11 (gana por 2).
  //   reta          → sin score, solo ganador. libre → conteo simple.
  const MODOS_VALIDOS = ["partido_3", "partido_5", "pickle_1", "pickle_3", "reta", "libre"];
  const DEPORTES_VALIDOS = ["padel", "tenis", "pickleball"];

  // Qué modos ofrecer según el deporte (la UI usa esto para no mezclar
  // sets de pádel con juegos de pickleball). reta/libre son universales.
  const MODOS_BY_SPORT = {
    padel:      ["partido_3", "partido_5", "reta", "libre"],
    tenis:      ["partido_3", "partido_5", "reta", "libre"],
    pickleball: ["pickle_3", "pickle_1", "reta", "libre"],
  };
  // Modos cuyo score son "juegos a 11" en lugar de "sets de games".
  const PICKLE_MODOS = ["pickle_1", "pickle_3"];
  // Default de juego de pickleball: a 11, se gana por 2 (torneos: 15/21).
  const PICKLE_TARGET_DEFAULT = 11;

  // sanitizeJugadores acepta arrays de longitud 0-4. Cada elemento es un
  // objeto { nombre, equipo, uid?, claimedByUid? }. Length variable (0,1,2,3,4)
  // es válido — un partido puede tener 1, 2, 3 o 4 jugadores registrados.
  // El campo `equipo` del objeto es AUTORITATIVO; si no viene, se deriva por
  // posición (LEGACY_INDEX_TO_TEAM: slot 0,1→team1; slot 2,3→team2).
  // El consumidor (splitTeams, cancha visual) DEBE agrupar por j.equipo,
  // NUNCA por índice — esa fue la causa del bug donde 2 jugadores caían
  // en mismo equipo: el consumer mapeaba por índice ignorando j.equipo.
  function sanitizeJugadores(input) {
    if (!Array.isArray(input)) return [];
    const arr = input.slice(0, 4);
    return arr.map((raw, idx) => {
      const defaultEquipo = LEGACY_INDEX_TO_TEAM[idx] || "team1";
      if (typeof raw === "string") {
        return { nombre: String(raw).slice(0, 80), equipo: defaultEquipo };
      }
      if (!raw || typeof raw !== "object") {
        return { nombre: "", equipo: defaultEquipo };
      }
      const out = { nombre: String(raw.nombre || "").slice(0, 80) };
      out.equipo = (raw.equipo === "team1" || raw.equipo === "team2")
        ? raw.equipo
        : defaultEquipo;
      if (raw.uid && typeof raw.uid === "string") out.uid = raw.uid;
      if (raw.claimedByUid && typeof raw.claimedByUid === "string") {
        out.claimedByUid = raw.claimedByUid;
      }
      return out;
    });
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

  // teamLabel (Etapa 16.4 F3 — Item 17): nombre legible del equipo según
  // jugadores reales. Reglas:
  //   - 0 jugadores en el equipo  → "Equipo 1" / "Equipo 2" (fallback)
  //   - 1 jugador con nombre      → su nombre
  //   - 2 jugadores con nombre    → "Nombre 1 / Nombre 2"
  // El parámetro `teamId` debe ser "team1" o "team2".
  // Etapa 16.4 F59: truncado elegante para nombres largos (evita romper
  // layout del FS marcador). Si un nombre excede el max, se corta y se
  // agrega "…" — ej. "Jose María Giménez" → "Jose Mar…".
  function _truncate(s, max) {
    const str = String(s || "").trim();
    if (str.length <= max) return str;
    return str.slice(0, max - 1) + "…";
  }
  function teamLabel(jugadores, teamId, opts) {
    const o = opts || {};
    // max chars por nombre cuando hay 1 vs 2 jugadores
    const maxSingle = Number.isFinite(o.maxSingle) ? o.maxSingle : 14;
    const maxDouble = Number.isFinite(o.maxDouble) ? o.maxDouble : 8;
    const J = Array.isArray(jugadores) ? jugadores : [];
    const filtered = J.filter(j => j && typeof j === "object" && j.equipo === teamId
      && j.nombre && String(j.nombre).trim().length > 0);
    if (filtered.length === 0) {
      return teamId === "team2" ? "Equipo 2" : "Equipo 1";
    }
    if (filtered.length === 1) {
      return _truncate(filtered[0].nombre, maxSingle);
    }
    return filtered.slice(0, 2)
      .map(j => _truncate(j.nombre, maxDouble))
      .join(" / ");
  }

  // jugadoresBySlot: devuelve un array length 4 con jugadores distribuidos
  // en los 4 slots UI (slots 0,1 = team1 ; slots 2,3 = team2).
  //
  // Razón: los renders que muestran "4 slots fijos" (cancha visual de
  // mi-partido y panel de claims de resumen) iteran [0..3] y necesitan
  // saber qué jugador va en cada slot. Si el array `jugadores` tiene
  // length < 4 (caso permitido: el usuario puede registrar 0, 1, 2, 3
  // ó 4 jugadores), mapear por índice colapsa team2 dentro de slots de
  // team1 (bug histórico).
  //
  // Reglas:
  // - Si jugadores.length === 4: preserva orden (caller ya posicionó).
  // - Si jugadores.length < 4: agrupa por j.equipo, pone team1 en
  //   slots [0,1] y team2 en slots [2,3], rellena vacíos con defaults.
  // - Jugadores sin campo equipo se tratan como team1 (compat legacy).
  function jugadoresBySlot(input) {
    const J = Array.isArray(input) ? input.filter(Boolean) : [];
    if (J.length === 4) return J.slice();
    const t1 = J.filter(j => j && (j.equipo !== "team2"));
    const t2 = J.filter(j => j && j.equipo === "team2");
    const emptyT1 = { nombre: "", equipo: "team1" };
    const emptyT2 = { nombre: "", equipo: "team2" };
    return [
      t1[0] || emptyT1,
      t1[1] || emptyT1,
      t2[0] || emptyT2,
      t2[1] || emptyT2,
    ];
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
    // F79: TIEBREAK DESACTIVADO. 7-6 ahora es válido SIN tb (game extra
    // resuelve el set). 6-6 sigue siendo incomplete (alguien debe ganar el
    // siguiente game). El argumento `tb` queda ignorado silenciosamente.
    if (t1 === 7 && t2 === 6) return { state: "valid", winner: "team1" };
    if (t2 === 7 && t1 === 6) return { state: "valid", winner: "team2" };
    // 6-6 → incompleto, ganador del siguiente game cierra 7-6
    if (t1 === 6 && t2 === 6) {
      return { state: "incomplete", winner: null, hint: "Empate 6-6. Sigan jugando: el siguiente game cierra el set 7-6." };
    }
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

  // validatePickleGame: regla de pickleball. Un "juego" se gana al llegar a
  // 11 (o 15/21 en torneos) con diferencia ≥ 2. El score visible son DOS
  // números (los puntos de cada equipo en ese juego); el "tercer número"
  // (servidor 1/2) del cantado de dobles es solo del saque, no del marcador.
  // Reusa el shape sets[]: cada "set" es en realidad un "juego" de pickleball.
  //   { state: "valid",      winner }
  //   { state: "incomplete", winner: null, hint }
  //   { state: "invalid",    winner: null, error }
  function validatePickleGame(t1Raw, t2Raw) {
    const t1 = Number(t1Raw);
    const t2 = Number(t2Raw);
    if (!Number.isInteger(t1) || !Number.isInteger(t2) || t1 < 0 || t2 < 0) {
      return { state: "invalid", winner: null, error: "Los puntos deben ser enteros ≥ 0." };
    }
    if (t1 > 40 || t2 > 40) {
      return { state: "invalid", winner: null, error: "Puntos fuera de rango (máx 40)." };
    }
    const max = Math.max(t1, t2);
    const diff = Math.abs(t1 - t2);
    if (max < PICKLE_TARGET_DEFAULT) {
      return { state: "incomplete", winner: null, hint: "Un juego se gana al llegar a 11 (o 15/21) con 2 de diferencia." };
    }
    if (diff < 2) {
      return { state: "incomplete", winner: null, hint: "En pickleball se gana por 2. Sigan jugando." };
    }
    return { state: "valid", winner: t1 > t2 ? "team1" : "team2" };
  }

  // validateScoreCell: dispatcher por deporte/modo. Para modos de pickleball
  // usa validatePickleGame; para el resto, validateSet (pádel/tenis).
  function validateScoreCell(t1, t2, tb, opts) {
    const modo = opts && opts.modo;
    const deporte = opts && opts.deporte;
    const isPickle = (modo && PICKLE_MODOS.indexOf(modo) >= 0) || deporte === "pickleball";
    return isPickle ? validatePickleGame(t1, t2) : validateSet(t1, t2, tb);
  }

  // deducePickleMatchWinner: gana el equipo con más juegos ganados.
  // sets: [{team1,team2}, ...] (cada uno un juego ya cerrado/válido).
  function deducePickleMatchWinner(sets) {
    let g1 = 0, g2 = 0;
    (Array.isArray(sets) ? sets : []).forEach(function (s) {
      const v = validatePickleGame(s.team1, s.team2);
      if (v.state === "valid") { if (v.winner === "team1") g1++; else g2++; }
    });
    if (g1 === g2) return null;
    return g1 > g2 ? "team1" : "team2";
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

  // =================================================================
  // Live scoring engine (Etapa 16.2) — punto-a-punto en vivo
  // =================================================================
  // Modelo del campo `marcador` (compatible con el existente):
  //   {
  //     sets: [{ team1:N, team2:M }, ...],   // sets ganados (cerrados)
  //     tiebreak: [...] | undefined,         // marcador del tb por set (opcional)
  //     current: {
  //       team1Games:N, team2Games:M,
  //       team1Points:0|15|30|40|"AD",
  //       team2Points:0|15|30|40|"AD",
  //       servingTeam: "team1"|"team2",
  //       tiebreak: { team1:N, team2:N } | null,
  //     },
  //     goldenPoint: boolean,
  //     ganador: "team1"|"team2"|undefined,
  //     modo: "partido_3"|"partido_5"|"reta"|"libre" (opcional, copia local),
  //     history: Array<deltaOp>,             // pila para undo
  //   }
  //
  // `history` guarda cambios atómicos (1 punto, force game, force set) con
  // suficiente info para deshacer SIN reconstruir desde cero. Mantenemos
  // los últimos LIVE_HISTORY_MAX elementos para evitar inflar el doc.
  const LIVE_HISTORY_MAX = 200;
  const POINTS_SEQ = [0, 15, 30, 40];

  function _cloneMarcador(m) {
    // Clone profundo "manual" suficiente para el shape conocido. Evitamos
    // JSON.parse(JSON.stringify) para no perder tipos no-numéricos en futuro.
    if (!m || typeof m !== "object") return {};
    const out = {};
    if (Array.isArray(m.sets)) {
      out.sets = m.sets.map(function (s) {
        return { team1: Number(s && s.team1) || 0, team2: Number(s && s.team2) || 0 };
      });
    }
    if (Array.isArray(m.tiebreak)) {
      out.tiebreak = m.tiebreak.map(function (t) {
        if (!t) return null;
        return { team1: Number(t.team1) || 0, team2: Number(t.team2) || 0 };
      });
    }
    if (m.current && typeof m.current === "object") {
      out.current = {
        team1Games: Number(m.current.team1Games) || 0,
        team2Games: Number(m.current.team2Games) || 0,
        team1Points: _normalizePoint(m.current.team1Points),
        team2Points: _normalizePoint(m.current.team2Points),
        servingTeam: (m.current.servingTeam === "team2") ? "team2" : "team1",
        tiebreak: (m.current.tiebreak && typeof m.current.tiebreak === "object")
          ? { team1: Number(m.current.tiebreak.team1) || 0, team2: Number(m.current.tiebreak.team2) || 0 }
          : null,
      };
    }
    if (typeof m.goldenPoint === "boolean") out.goldenPoint = m.goldenPoint;
    if (m.ganador === "team1" || m.ganador === "team2") out.ganador = m.ganador;
    if (typeof m.modo === "string") out.modo = m.modo;
    if (Array.isArray(m.history)) {
      out.history = m.history.slice(-LIVE_HISTORY_MAX).map(function (h) { return Object.assign({}, h); });
    }
    if (m.gamesTotal && typeof m.gamesTotal === "object") {
      out.gamesTotal = { team1: Number(m.gamesTotal.team1) || 0, team2: Number(m.gamesTotal.team2) || 0 };
    }
    if (m.ganadorReta === "team1" || m.ganadorReta === "team2") out.ganadorReta = m.ganadorReta;
    return out;
  }

  function _normalizePoint(p) {
    if (p === "AD" || p === "ad") return "AD";
    const n = Number(p);
    if (n === 15 || n === 30 || n === 40) return n;
    return 0;
  }

  function _defaultCurrent() {
    return {
      team1Games: 0,
      team2Games: 0,
      team1Points: 0,
      team2Points: 0,
      servingTeam: "team1",
      tiebreak: null,
    };
  }

  // initLiveMarcador: crea un marcador en blanco con `current` para empezar a
  // trackear punto-a-punto. Opcional `goldenPoint` y `modo`.
  function initLiveMarcador(opts) {
    const o = opts || {};
    const m = {
      sets: [],
      current: _defaultCurrent(),
      history: [],
      goldenPoint: !!o.goldenPoint,
    };
    if (typeof o.modo === "string" && MODOS_VALIDOS.includes(o.modo)) m.modo = o.modo;
    return m;
  }

  // ensureLiveCurrent: si el marcador no tiene `current`, lo agrega con default.
  // No muta `m` original; devuelve copia con current poblado.
  function ensureLiveCurrent(marcador) {
    const m = _cloneMarcador(marcador || {});
    if (!m.sets) m.sets = [];
    if (!m.current) m.current = _defaultCurrent();
    if (!Array.isArray(m.history)) m.history = [];
    return m;
  }

  // pointsLabel: 0|15|30|40|"AD" → string para UI.
  function pointsLabel(p) {
    const n = _normalizePoint(p);
    if (n === "AD") return "AD";
    return String(n);
  }

  // _setsTargetForMode: cuántos sets ganados se necesitan para terminar.
  function _setsTargetForMode(modo) {
    if (modo === "partido_5") return 3;
    if (modo === "partido_3") return 2;
    return null; // reta/libre/otros: el caller decide
  }

  // F115: duración máxima esperada por modo. Después de esto el partido
  // está "expirado" y se ofrece auto-cierre. Conservador: las cifras
  // cubren el peor caso (3 sets a 7-6 con muchos puntos).
  function maxMatchDurationMs(modo) {
    if (modo === "partido_5") return 2 * 60 * 60 * 1000; // 2h
    if (modo === "partido_3") return 1 * 60 * 60 * 1000; // 1h
    return 90 * 60 * 1000;                                // default 1h30m
  }

  // Edad del partido en ms (basado en startedAt). Devuelve null si no hay timestamp.
  function getMatchAgeMs(match) {
    if (!match) return null;
    const startedMs = toMillis(match.startedAt);
    if (!startedMs) return null;
    return Math.max(0, Date.now() - startedMs);
  }

  // ¿el partido ya pasó su duración máxima esperada?
  function isMatchExpired(match) {
    if (!match || match.status !== "active") return false;
    const age = getMatchAgeMs(match);
    if (age == null) return false;
    return age > maxMatchDurationMs(match.modo);
  }

  // ms restantes hasta expiración. Negativo si ya expiró. null si no hay timestamp.
  function getMatchTimeRemainingMs(match) {
    const age = getMatchAgeMs(match);
    if (age == null) return null;
    return maxMatchDurationMs(match && match.modo) - age;
  }

  // _countSetsWon: cuenta sets ganados por cada equipo (basado en games por set).
  function _countSetsWon(sets) {
    let t1 = 0, t2 = 0;
    if (!Array.isArray(sets)) return { t1: 0, t2: 0 };
    for (const s of sets) {
      if (!s) continue;
      const a = Number(s.team1) || 0, b = Number(s.team2) || 0;
      if (a > b) t1++; else if (b > a) t2++;
    }
    return { t1: t1, t2: t2 };
  }

  // isLiveMatchOver: ¿ya hay ganador del partido?
  function isLiveMatchOver(marcador) {
    if (!marcador || typeof marcador !== "object") return { done: false, winner: null };
    const modo = typeof marcador.modo === "string" ? marcador.modo : null;
    const target = _setsTargetForMode(modo);
    const counted = _countSetsWon(marcador.sets);
    if (target == null) {
      // sin modo conocido — sólo respetamos `ganador` si ya viene marcado.
      return { done: !!marcador.ganador, winner: marcador.ganador || null, t1Sets: counted.t1, t2Sets: counted.t2 };
    }
    let winner = null;
    if (counted.t1 >= target) winner = "team1";
    else if (counted.t2 >= target) winner = "team2";
    return { done: !!winner, winner: winner, t1Sets: counted.t1, t2Sets: counted.t2 };
  }

  // _pushHistory: agrega op al historial truncando al máximo.
  function _pushHistory(m, op) {
    if (!Array.isArray(m.history)) m.history = [];
    m.history.push(op);
    if (m.history.length > LIVE_HISTORY_MAX) {
      m.history.splice(0, m.history.length - LIVE_HISTORY_MAX);
    }
  }

  function _otherTeam(t) { return t === "team1" ? "team2" : "team1"; }

  function _isTiebreakSet(current) {
    // F79: TIEBREAK DESACTIVADO INTEGRALMENTE. Antes 6-6 disparaba modo
    // tiebreak (game largo a 7 con diff>=2). Ahora siempre retorna false
    // → al llegar a 6-6, el siguiente game cierra el set 7-6 sin tb.
    // El motor procesa esos puntos como un game normal de 4 puntos
    // (deuce sigue funcionando dentro del game). Más simple para users
    // que no entendían cómo registrar tiebreak.
    return false;
  }

  // _applyGameWin: cierra un game ganado por `winner`. Mutates m.current
  // y avanza set si corresponde. Devuelve {gameClosed, setClosed, matchClosed}
  // y la "snapshot previa" útil para undo.
  function _applyGameWin(m, winner) {
    const before = {
      current: Object.assign({}, m.current, {
        tiebreak: m.current.tiebreak ? Object.assign({}, m.current.tiebreak) : null,
      }),
      setsBefore: m.sets ? m.sets.length : 0,
    };
    // Incrementa games del winner; reinicia points; alterna saque.
    m.current[winner + "Games"] = Number(m.current[winner + "Games"] || 0) + 1;
    m.current.team1Points = 0;
    m.current.team2Points = 0;
    m.current.tiebreak = null;
    m.current.servingTeam = _otherTeam(m.current.servingTeam || "team1");

    let setClosed = false;
    const a = m.current.team1Games, b = m.current.team2Games;
    // Set se cierra cuando alguien llega a 6 con diff ≥ 2, o llega a 7 (7-5 o 7-6 vía tb).
    if ((a >= 6 || b >= 6) && Math.abs(a - b) >= 2 && Math.max(a, b) <= 7) {
      // 6-0..6-4 o 7-5
      _closeSet(m, a, b);
      setClosed = true;
    } else if (a === 7 && b === 5) {
      _closeSet(m, 7, 5); setClosed = true;
    } else if (b === 7 && a === 5) {
      _closeSet(m, 7, 5); setClosed = true;
    } else if (a === 7 && b === 6) {
      _closeSet(m, 7, 6); setClosed = true;
    } else if (b === 7 && a === 6) {
      _closeSet(m, 6, 7); setClosed = true;
    }

    let matchClosed = false;
    if (setClosed) {
      const over = isLiveMatchOver(m);
      if (over.done) {
        m.ganador = over.winner;
        matchClosed = true;
      }
    }
    return { before: before, setClosed: setClosed, matchClosed: matchClosed };
  }

  function _closeSet(m, t1, t2) {
    if (!Array.isArray(m.sets)) m.sets = [];
    m.sets.push({ team1: Number(t1) || 0, team2: Number(t2) || 0 });
    m.current = _defaultCurrent();
    // Saque del próximo set: alterna respecto al último servidor. Como
    // dentro del set ya alternamos cada game, simplemente dejamos el
    // current.servingTeam por defecto (team1). UX: no es load-bearing
    // porque el dueño puede sobreescribir desde UI si necesita.
  }

  // _applyPoint: aplica un punto al ganador. Maneja deuce, AD, golden point,
  // y tiebreak. Mutates m. Devuelve op para historial.
  function _applyPoint(m, winner, goldenPoint) {
    const op = {
      type: "point",
      winner: winner,
      before: {
        current: Object.assign({}, m.current, {
          tiebreak: m.current.tiebreak ? Object.assign({}, m.current.tiebreak) : null,
        }),
        setsBefore: m.sets ? m.sets.length : 0,
        ganadorBefore: m.ganador || null,
      },
    };

    // Tiebreak en juego (6-6 del set en curso)
    if (_isTiebreakSet(m.current) || m.current.tiebreak) {
      if (!m.current.tiebreak) m.current.tiebreak = { team1: 0, team2: 0 };
      m.current.tiebreak[winner] = Number(m.current.tiebreak[winner] || 0) + 1;
      const a = m.current.tiebreak.team1, b = m.current.tiebreak.team2;
      const max = Math.max(a, b), diff = Math.abs(a - b);
      if (max >= 7 && diff >= 2) {
        // Cierra game del tiebreak para el winner: 7-6 en games.
        m.current[winner + "Games"] = 7;
        // Aseguramos que el otro equipo quede en 6 (estaba 6-6 antes).
        const otherTeam = _otherTeam(winner);
        if (m.current[otherTeam + "Games"] !== 6) m.current[otherTeam + "Games"] = 6;
        const result = _applyTiebreakSetClose(m, winner, a, b);
        op.setClosed = true;
        op.matchClosed = result.matchClosed;
      }
      _pushHistory(m, op);
      return op;
    }

    // Punto normal
    const wP = _normalizePoint(m.current[winner + "Points"]);
    const lP = _normalizePoint(m.current[_otherTeam(winner) + "Points"]);

    if (wP === "AD") {
      // winner ya tenía ventaja → game para winner
      _applyGameWin(m, winner);
      const over = isLiveMatchOver(m);
      op.setClosed = m.sets && m.sets.length > op.before.setsBefore;
      op.matchClosed = over.done && !op.before.ganadorBefore;
      _pushHistory(m, op);
      return op;
    }
    if (lP === "AD") {
      // El otro tenía ventaja, ahora regresa a deuce (40-40)
      m.current[_otherTeam(winner) + "Points"] = 40;
      m.current[winner + "Points"] = 40;
      _pushHistory(m, op);
      return op;
    }
    if (wP === 40 && lP === 40) {
      // Deuce → según golden point
      if (goldenPoint) {
        _applyGameWin(m, winner);
        const over = isLiveMatchOver(m);
        op.setClosed = m.sets && m.sets.length > op.before.setsBefore;
        op.matchClosed = over.done && !op.before.ganadorBefore;
      } else {
        m.current[winner + "Points"] = "AD";
      }
      _pushHistory(m, op);
      return op;
    }
    if (wP === 40) {
      // 40-X (X<40) → game para winner
      _applyGameWin(m, winner);
      const over = isLiveMatchOver(m);
      op.setClosed = m.sets && m.sets.length > op.before.setsBefore;
      op.matchClosed = over.done && !op.before.ganadorBefore;
      _pushHistory(m, op);
      return op;
    }
    // Sube en la secuencia 0→15→30→40
    const idx = POINTS_SEQ.indexOf(wP);
    if (idx >= 0 && idx < POINTS_SEQ.length - 1) {
      m.current[winner + "Points"] = POINTS_SEQ[idx + 1];
    }
    _pushHistory(m, op);
    return op;
  }

  function _applyTiebreakSetClose(m, winner, tbA, tbB) {
    if (!Array.isArray(m.sets)) m.sets = [];
    if (!Array.isArray(m.tiebreak)) m.tiebreak = [];
    // El set se cierra como 7-6 a favor del winner; el array tiebreak refleja
    // el marcador del tiebreak ganado.
    const team1Games = winner === "team1" ? 7 : 6;
    const team2Games = winner === "team1" ? 6 : 7;
    m.sets.push({ team1: team1Games, team2: team2Games });
    // Empareja el largo de tiebreak con el de sets (rellena nulls previos).
    while (m.tiebreak.length < m.sets.length - 1) m.tiebreak.push(null);
    m.tiebreak.push({ team1: Number(tbA) || 0, team2: Number(tbB) || 0 });
    m.current = _defaultCurrent();
    const over = isLiveMatchOver(m);
    let matchClosed = false;
    if (over.done) { m.ganador = over.winner; matchClosed = true; }
    return { matchClosed: matchClosed };
  }

  // nextPointWinner: API pública. Devuelve nuevo marcador (clon) tras
  // aplicar +1 punto al equipo ganador. NO muta el input.
  function nextPointWinner(marcador, winnerTeam, opts) {
    if (winnerTeam !== "team1" && winnerTeam !== "team2") {
      throw new Error("[Matches.live] winnerTeam debe ser 'team1' o 'team2'.");
    }
    const o = opts || {};
    const m = ensureLiveCurrent(marcador);
    if (typeof o.modo === "string" && MODOS_VALIDOS.includes(o.modo)) m.modo = o.modo;
    if (typeof o.goldenPoint === "boolean") m.goldenPoint = o.goldenPoint;
    if (m.ganador) return m; // partido terminado: no-op
    _applyPoint(m, winnerTeam, !!m.goldenPoint);
    return m;
  }

  // undoLastPoint: deshace la última op aplicada (de cualquier tipo, no sólo
  // punto). Devuelve marcador clonado sin la última op. Si no hay history,
  // retorna el marcador sin cambios.
  function undoLastPoint(marcador) {
    const m = ensureLiveCurrent(marcador);
    if (!Array.isArray(m.history) || m.history.length === 0) return m;
    const op = m.history.pop();
    if (!op || !op.before) return m;
    // Restaurar `current` desde snapshot
    if (op.before.current) {
      m.current = Object.assign({}, op.before.current, {
        tiebreak: op.before.current.tiebreak ? Object.assign({}, op.before.current.tiebreak) : null,
      });
    }
    // Si la op cerró sets, recortar el array.
    if (op.setClosed && Array.isArray(m.sets) && m.sets.length > op.before.setsBefore) {
      const removed = m.sets.length - op.before.setsBefore;
      m.sets.splice(op.before.setsBefore, removed);
      if (Array.isArray(m.tiebreak) && m.tiebreak.length > op.before.setsBefore) {
        m.tiebreak.splice(op.before.setsBefore, m.tiebreak.length - op.before.setsBefore);
      }
    }
    // Restaurar ganador si la op cerró el partido.
    if (op.matchClosed) {
      if (op.before.ganadorBefore) m.ganador = op.before.ganadorBefore;
      else delete m.ganador;
    }
    return m;
  }

  // forceGameWin: atajo. Cierra un game para el team indicado sin trackear
  // puntos individuales. Útil cuando el operador se distrajo.
  function forceGameWin(marcador, team) {
    if (team !== "team1" && team !== "team2") {
      throw new Error("[Matches.live] team debe ser 'team1' o 'team2'.");
    }
    const m = ensureLiveCurrent(marcador);
    if (m.ganador) return m;
    const op = {
      type: "forceGame",
      winner: team,
      before: {
        current: Object.assign({}, m.current, {
          tiebreak: m.current.tiebreak ? Object.assign({}, m.current.tiebreak) : null,
        }),
        setsBefore: m.sets ? m.sets.length : 0,
        ganadorBefore: m.ganador || null,
      },
    };
    _applyGameWin(m, team);
    const over = isLiveMatchOver(m);
    op.setClosed = m.sets && m.sets.length > op.before.setsBefore;
    op.matchClosed = over.done && !op.before.ganadorBefore;
    _pushHistory(m, op);
    return m;
  }

  // undoLastGame: deshace ops hasta encontrar (e incluir) la última que
  // cerró un game (sea por punto, force, o tiebreak). Si no hay tal op,
  // deshace 1 sola op. Devuelve marcador clonado.
  function undoLastGame(marcador) {
    let m = ensureLiveCurrent(marcador);
    if (!Array.isArray(m.history) || m.history.length === 0) return m;
    // Para detectar "cerró game" comparamos el estado "antes" de op[i]
    // con el estado "después" de op[i] (= "antes" de op[i+1], o m.current
    // si i es la última op).
    function afterOf(i) {
      if (i + 1 < m.history.length) return m.history[i + 1].before.current;
      return m.current;
    }
    function opClosedGame(op, i) {
      if (!op) return false;
      if (op.type === "forceGame") return true;
      if (op.type === "forceSet") return true;
      if (op.type === "point") {
        const b = op.before.current || {};
        const a = afterOf(i) || {};
        const bG = Number(b.team1Games || 0) + Number(b.team2Games || 0);
        const aG = Number(a.team1Games || 0) + Number(a.team2Games || 0);
        if (aG !== bG) return true; // games cambiaron → cerró game (o tiebreak)
        // También si el set se cerró sin que current refleje (caso de cierre + reset)
        if (op.setClosed) return true;
        return false;
      }
      return false;
    }
    let target = -1;
    for (let i = m.history.length - 1; i >= 0; i--) {
      if (opClosedGame(m.history[i], i)) { target = i; break; }
    }
    if (target < 0) {
      // No hay game cerrado en la pila — undo último punto.
      return undoLastPoint(m);
    }
    // Hacer pop hasta dejar el array de longitud `target` (es decir, borrar
    // las ops desde target inclusive hasta el final).
    const opsToUndo = m.history.length - target;
    for (let k = 0; k < opsToUndo; k++) {
      m = undoLastPoint(m);
    }
    return m;
  }

  // forceSetWin: atajo "el set acabó X-Y". Cierra set agregándolo al array
  // sets con los games provistos. Reinicia current. Si es 7-6, opcionalmente
  // recibe tiebreak.
  function forceSetWin(marcador, team, score, tb) {
    if (team !== "team1" && team !== "team2") {
      throw new Error("[Matches.live] team debe ser 'team1' o 'team2'.");
    }
    const m = ensureLiveCurrent(marcador);
    if (m.ganador) return m;
    const t1 = Number(score && score.team1);
    const t2 = Number(score && score.team2);
    if (!Number.isInteger(t1) || !Number.isInteger(t2) || t1 < 0 || t2 < 0) {
      throw new Error("[Matches.live] score inválido para forceSetWin.");
    }
    const winnerByScore = t1 > t2 ? "team1" : (t2 > t1 ? "team2" : null);
    if (winnerByScore !== team) {
      throw new Error("[Matches.live] team no coincide con el score provisto.");
    }
    const op = {
      type: "forceSet",
      winner: team,
      score: { team1: t1, team2: t2 },
      tb: tb ? { team1: Number(tb.team1) || 0, team2: Number(tb.team2) || 0 } : null,
      before: {
        current: Object.assign({}, m.current, {
          tiebreak: m.current.tiebreak ? Object.assign({}, m.current.tiebreak) : null,
        }),
        setsBefore: m.sets ? m.sets.length : 0,
        tiebreakBefore: Array.isArray(m.tiebreak) ? m.tiebreak.length : 0,
        ganadorBefore: m.ganador || null,
      },
    };
    if (!Array.isArray(m.sets)) m.sets = [];
    m.sets.push({ team1: t1, team2: t2 });
    if (op.tb) {
      if (!Array.isArray(m.tiebreak)) m.tiebreak = [];
      while (m.tiebreak.length < m.sets.length - 1) m.tiebreak.push(null);
      m.tiebreak.push(op.tb);
    }
    m.current = _defaultCurrent();
    const over = isLiveMatchOver(m);
    op.setClosed = true;
    op.matchClosed = over.done && !op.before.ganadorBefore;
    if (over.done) m.ganador = over.winner;
    _pushHistory(m, op);
    return m;
  }

  // formatLiveScoreboard: helper de UI. Devuelve estructura plana para render.
  function formatLiveScoreboard(marcador) {
    const m = ensureLiveCurrent(marcador);
    const counted = _countSetsWon(m.sets);
    const setsArr = Array.isArray(m.sets) ? m.sets.slice() : [];
    const inProgress = !m.ganador && m.current && (
      m.current.team1Games > 0 || m.current.team2Games > 0 ||
      m.current.team1Points !== 0 || m.current.team2Points !== 0 ||
      m.current.tiebreak
    );
    return {
      modo: m.modo || null,
      goldenPoint: !!m.goldenPoint,
      ganador: m.ganador || null,
      sets: setsArr,
      tiebreak: Array.isArray(m.tiebreak) ? m.tiebreak.slice() : [],
      setsWon: counted,
      current: Object.assign({}, m.current),
      inProgress: !!inProgress,
      pointsLabelT1: pointsLabel(m.current.team1Points),
      pointsLabelT2: pointsLabel(m.current.team2Points),
    };
  }

  // parseFromName: réplica idéntica de la lógica en assets/script.js.
  // Se duplica a propósito para que matches.js sea self-contained y no
  // dependa de cargar script.js (que ejecuta DOMContentLoaded handlers
  // que no aplican fuera de las páginas de producción).
  function parseFromName(name) {
    // Sufijo opcional _TAG_TAGID antes de la fecha (ej. _PARTIDO_<hash>):
    // lo emite la NUC desde Worker E (onboarding WellStreet) para distinguir
    // partidos completos de clips sueltos. Anclamos lado con (Lado[A-Z]) para
    // evitar que el backtracking del .+? non-greedy se trague el sufijo
    // dentro del grupo lado y rompa el cruce con matchDoc.lado.
    const re = /^(.+?)_(.+?)_(Lado[A-Z])(?:_([A-Z][A-Z_]*)_([A-Za-z0-9]+))?_(\d{8})_(\d{6})\.mp4$/i;
    const m = String(name || "").match(re);
    if (!m) return null;
    const [, loc, can, lado, tag, tagId, date8, time6] = m;

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
    return {
      loc, can, lado,
      tag: tag || null,
      tagId: tagId || null,
      date, Y: d.Y, M: d.M, D: d.D, h, mi, s,
    };
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
          // F134: exponer también `url` (alias de videoUrl) para que el
          // output sea consumible directo por PuntazoCard.build, que lee
          // entry.url en assets/card.js:279. Sin este alias, detalle.html
          // y cualquier otra página que pase findClipsForMatch a
          // PuntazoCard renderiza el card con <video> sin src → fondo
          // negro sin preview ni controles funcionales. Mantener videoUrl
          // por backwards-compat (resumen.html, mis-clips.html lo leen).
          url: v.url,
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

  // ── F95 BLOQUE 5 (item 7): Aceptación bilateral del marcador ──
  // scoreAcceptedBy = map { uid: true } — quien ha aceptado el marcador.
  // El "lock" es semántico (UI lo respeta), no enforced en rules todavía
  // para no romper edición durante migración.
  async function acceptScore(matchId, uid) {
    const id = nonEmptyString(matchId, "matchId");
    const u = nonEmptyString(uid, "uid");
    const upd = {
      ["scoreAcceptedBy." + u]: true,
      updatedAt: FV().serverTimestamp(),
    };
    await db().collection(COL).doc(id).update(upd);
  }
  async function unacceptScore(matchId, uid) {
    const id = nonEmptyString(matchId, "matchId");
    const u = nonEmptyString(uid, "uid");
    const upd = {
      ["scoreAcceptedBy." + u]: FV().delete(),
      updatedAt: FV().serverTimestamp(),
    };
    await db().collection(COL).doc(id).update(upd);
  }
  // Devuelve { acceptedCount, totalPlayers, acceptedByTeam1, acceptedByTeam2,
  //            bothTeamsAccepted, myAccepted } dado el match + currentUid.
  function getScoreAcceptanceState(match, currentUid) {
    const accBy = (match && match.scoreAcceptedBy) || {};
    const acceptedUids = Object.keys(accBy).filter(function (k) { return !!accBy[k]; });
    const jugadores = Array.isArray(match && match.jugadores) ? match.jugadores : [];
    const t1Uids = jugadores.filter(function (j) { return j && j.uid && j.equipo === "team1"; }).map(function (j) { return j.uid; });
    const t2Uids = jugadores.filter(function (j) { return j && j.uid && j.equipo === "team2"; }).map(function (j) { return j.uid; });
    const totalPlayers = t1Uids.length + t2Uids.length;
    const acceptedByTeam1 = t1Uids.some(function (u) { return acceptedUids.indexOf(u) >= 0; });
    const acceptedByTeam2 = t2Uids.some(function (u) { return acceptedUids.indexOf(u) >= 0; });
    return {
      acceptedCount: acceptedUids.length,
      totalPlayers: totalPlayers,
      acceptedUids: acceptedUids,
      acceptedByTeam1: acceptedByTeam1,
      acceptedByTeam2: acceptedByTeam2,
      bothTeamsAccepted: acceptedByTeam1 && acceptedByTeam2,
      myAccepted: !!(currentUid && acceptedUids.indexOf(currentUid) >= 0),
    };
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
    // F123-B: expuesto para que perfil.html pueda resolver json_url por lado
    // y cruzar pulsos pending con clips ya indexados (sin reimplementar la
    // lectura de config_locations.json).
    findJsonUrl: _findJsonUrl,
    parseClipName: parseFromName,
    subscribeToClaims,
    claimSlot,
    unclaimSlot,
    unclaimSlotAsOwner,
    mergeMatchWithClaims,
    jugadoresBySlot,
    teamLabel,
    acceptScore,
    unacceptScore,
    getScoreAcceptanceState,
    score: {
      validateSet,
      validateTiebreak,
      deduceMatchWinner,
      validatePickleGame,
      validateScoreCell,
      deducePickleMatchWinner,
    },
    live: {
      initMarcador: initLiveMarcador,
      ensureCurrent: ensureLiveCurrent,
      nextPointWinner: nextPointWinner,
      undoLastPoint: undoLastPoint,
      forceGameWin: forceGameWin,
      undoLastGame: undoLastGame,
      forceSetWin: forceSetWin,
      isMatchOver: isLiveMatchOver,
      pointsLabel: pointsLabel,
      formatScoreboard: formatLiveScoreboard,
    },
    MODOS: MODOS_VALIDOS.slice(),
    MODOS_BY_SPORT: JSON.parse(JSON.stringify(MODOS_BY_SPORT)),
    PICKLE_MODOS: PICKLE_MODOS.slice(),
    DEPORTES: DEPORTES_VALIDOS.slice(),
    // F115: helpers de expiración / auto-cierre
    maxMatchDurationMs: maxMatchDurationMs,
    getMatchAgeMs: getMatchAgeMs,
    getMatchTimeRemainingMs: getMatchTimeRemainingMs,
    isMatchExpired: isMatchExpired,
    _parseFromName: parseFromName,
    _toMillis: toMillis,
    _normalizeMatchFromDoc: normalizeMatchFromDoc,
    _sanitizeJugadores: sanitizeJugadores,
  };
})();
