// =============================================================
// clip-states.js — Puntazo · Estados vivos de clips (R3.1)
// =============================================================
// Patrón IIFE + window.PuntazoClipStates. Depende de:
//   - window.PuntazoFirebase (assets/firebase-core.js)
//   - firebase compat SDK    (firebase-app + firebase-firestore)
//
// Provee suscripción y query one-shot sobre `clip_states/` filtrada
// por partido (club/cancha/lado/ts_pulso) y resolución de video_url
// cruzando contra el índice JSON existente (NO se lee de Firestore).
//
// Schema del doc Firestore (publicado por el NUC en R2):
//   { clip_id, state, state_detail, state_updated_at, ts_pulso,
//     club, cancha, lado, source, job_id, video_url=null, published_at }
// Estados publicados: en_cola | visible | error | pendiente_por_conexion.
// =============================================================

(function () {
  "use strict";

  if (window.PuntazoClipStates) return;

  const COL = "clip_states";
  // Tolerancia para matchear ts_pulso (string ISO) contra el timestamp
  // de un archivo del índice JSON. Cubre drift entre el reloj del NUC
  // y el nombre del archivo final (puede haber redondeo en el pipeline).
  const MATCH_TOLERANCE_MS = 2000;

  // ---------- helpers ----------------------------------------------------

  function db() {
    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function") {
      throw new Error("[ClipStates] PuntazoFirebase no disponible. Carga assets/firebase-core.js primero.");
    }
    return window.PuntazoFirebase.db();
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  // Convierte un Date a ISO local naïve "YYYY-MM-DDTHH:MM:SS" (19 chars).
  // El NUC publica ts_pulso con datetime.now().isoformat() en HORA LOCAL
  // (mismo TZ que el reloj de la PC del club). Por eso usamos getHours()
  // y NO toISOString() — toISOString daría UTC y romperia la comparación
  // lexicográfica del filtro Firestore.
  function dateToLocalNaiveISO(d) {
    if (!d || isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" +
      pad2(d.getMonth() + 1) + "-" +
      pad2(d.getDate()) + "T" +
      pad2(d.getHours()) + ":" +
      pad2(d.getMinutes()) + ":" +
      pad2(d.getSeconds());
  }

  function tsToDate(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return ts;
    if (typeof ts.toDate === "function") { try { return ts.toDate(); } catch (e) { return null; } }
    if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
    if (typeof ts === "number") return new Date(ts);
    return null;
  }

  // Parse ts_pulso (string ISO naïve "YYYY-MM-DDTHH:MM:SS") → Date local.
  function tsPulsoToDate(tsStr) {
    if (typeof tsStr !== "string" || tsStr.length < 19) return null;
    const m = tsStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6])
    );
  }

  // expectedFileName: a partir de un clip state, devuelve el nombre del
  // archivo de clip esperado en el índice JSON.
  // Convención del NUC: Club_Cancha_Lado_DDMMYYYY_HHMMSS.mp4
  function expectedFileName(clipState) {
    if (!clipState || !clipState.ts_pulso) return null;
    if (!clipState.club || !clipState.cancha || !clipState.lado) return null;
    const d = tsPulsoToDate(clipState.ts_pulso);
    if (!d) return null;
    const DDMMYYYY = pad2(d.getDate()) + pad2(d.getMonth() + 1) + String(d.getFullYear());
    const HHMMSS = pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    return clipState.club + "_" + clipState.cancha + "_" + clipState.lado + "_" + DDMMYYYY + "_" + HHMMSS + ".mp4";
  }

  // resolveVideoUrl: cruza un clip state contra el índice JSON (en forma
  // de array de entries) y devuelve la entry que matchea, o null.
  // Se espera el shape que produce PuntazoMatches.findClipsForMatch:
  //   { videoId, videoUrl, club, cancha, lado, timestamp (ms), nombre }
  // Estrategia: 1) match exacto por nombre; 2) match por club/cancha/lado
  // + timestamp dentro de ±2s (la entry más cercana gana).
  function resolveVideoUrl(clipState, indexEntries) {
    if (!clipState || !Array.isArray(indexEntries) || indexEntries.length === 0) return null;

    const expected = expectedFileName(clipState);
    if (expected) {
      for (let i = 0; i < indexEntries.length; i++) {
        const e = indexEntries[i];
        if (e && e.nombre === expected) return e;
      }
    }

    const d = tsPulsoToDate(clipState.ts_pulso);
    if (!d) return null;
    const tsMs = d.getTime();

    let best = null;
    let bestDelta = Infinity;
    for (let i = 0; i < indexEntries.length; i++) {
      const e = indexEntries[i];
      if (!e || typeof e.timestamp !== "number") continue;
      if (e.club && clipState.club && e.club !== clipState.club) continue;
      if (e.cancha && clipState.cancha && e.cancha !== clipState.cancha) continue;
      if (e.lado && clipState.lado && e.lado !== clipState.lado) continue;
      const delta = Math.abs(e.timestamp - tsMs);
      if (delta <= MATCH_TOLERANCE_MS && delta < bestDelta) {
        best = e;
        bestDelta = delta;
      }
    }
    return best;
  }

  // ---------- query construction ----------------------------------------

  // Devuelve la query base filtrada por club/cancha/lado/ts_pulso (>=).
  // El upper bound (endedAt) se aplica client-side para evitar la
  // necesidad de un índice compuesto adicional. Para un partido de
  // 1.5h con 10 clips son ~10 docs leídos, costo despreciable.
  function buildQuery(loc, can, lado, startedDate) {
    const tsFloor = dateToLocalNaiveISO(startedDate);
    return db().collection(COL)
      .where("club", "==", loc)
      .where("cancha", "==", can)
      .where("lado", "==", lado)
      .where("ts_pulso", ">=", tsFloor);
  }

  function clientSideCeilFilter(docs, endedDate) {
    if (!endedDate) return docs;
    // +2s de tolerancia para tolerar clips registrados justo en endedAt.
    const tsCeil = dateToLocalNaiveISO(new Date(endedDate.getTime() + 2000));
    return docs.filter(function (d) {
      return !(typeof d.ts_pulso === "string" && d.ts_pulso > tsCeil);
    });
  }

  function snapToDocs(snapshot) {
    const docs = [];
    snapshot.forEach(function (doc) {
      const data = doc.data() || {};
      docs.push(Object.assign({ _id: doc.id }, data));
    });
    docs.sort(function (a, b) {
      const ax = String(a.ts_pulso || "");
      const bx = String(b.ts_pulso || "");
      if (ax < bx) return -1;
      if (ax > bx) return 1;
      return 0;
    });
    return docs;
  }

  // ---------- API público ------------------------------------------------

  // subscribeToMatch: suscripción onSnapshot. Llama a onUpdate(docs) en
  // cada cambio. Devuelve función unsubscribe.
  function subscribeToMatch(opts) {
    if (!opts || typeof opts !== "object") throw new Error("[ClipStates] opts requerido");
    const loc = opts.loc, can = opts.can, lado = opts.lado;
    const onUpdate = opts.onUpdate, onError = opts.onError;
    if (!loc || !can || !lado) throw new Error("[ClipStates] loc/can/lado requeridos");
    if (typeof onUpdate !== "function") throw new Error("[ClipStates] onUpdate requerido");

    const startedDate = (opts.startedAt instanceof Date) ? opts.startedAt : tsToDate(opts.startedAt);
    if (!startedDate) throw new Error("[ClipStates] startedAt no convertible a Date");
    const endedDate = opts.endedAt ? ((opts.endedAt instanceof Date) ? opts.endedAt : tsToDate(opts.endedAt)) : null;

    const q = buildQuery(loc, can, lado, startedDate);

    const sdkUnsub = q.onSnapshot(function (snapshot) {
      let docs = snapToDocs(snapshot);
      docs = clientSideCeilFilter(docs, endedDate);
      try { onUpdate(docs); } catch (e) { console.error("[ClipStates] onUpdate falló", e); }
    }, function (err) {
      console.error("[ClipStates] onSnapshot error", err);
      if (typeof onError === "function") {
        try { onError(err); } catch (e) {}
      }
    });

    return function unsubscribe() {
      try { sdkUnsub(); } catch (e) {}
      console.log("[ClipStates] unsubscribed (loc=" + loc + " can=" + can + " lado=" + lado + ")");
    };
  }

  // getForMatch: query one-shot. Returns Promise<Array<doc>>.
  async function getForMatch(opts) {
    if (!opts || typeof opts !== "object") throw new Error("[ClipStates] opts requerido");
    const loc = opts.loc, can = opts.can, lado = opts.lado;
    if (!loc || !can || !lado) throw new Error("[ClipStates] loc/can/lado requeridos");

    const startedDate = (opts.startedAt instanceof Date) ? opts.startedAt : tsToDate(opts.startedAt);
    if (!startedDate) throw new Error("[ClipStates] startedAt no convertible a Date");
    const endedDate = opts.endedAt ? ((opts.endedAt instanceof Date) ? opts.endedAt : tsToDate(opts.endedAt)) : null;

    const snap = await buildQuery(loc, can, lado, startedDate).get();
    let docs = snapToDocs(snap);
    docs = clientSideCeilFilter(docs, endedDate);
    return docs;
  }

  window.PuntazoClipStates = {
    subscribeToMatch: subscribeToMatch,
    getForMatch: getForMatch,
    resolveVideoUrl: resolveVideoUrl,
    expectedFileName: expectedFileName,
    // Privados expuestos para tests/debug:
    _dateToLocalNaiveISO: dateToLocalNaiveISO,
    _tsPulsoToDate: tsPulsoToDate,
  };
})();
