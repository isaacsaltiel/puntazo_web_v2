/* ══════════════════════════════════════════════════════════════
   PUNTAZO — guests.js  (Etapa E3c · invitados persistentes)

   Invitados ("dummies") reutilizables del dueño. "Gabo de ayer = Gabo
   de hoy": al registrar un partido con un jugador sin cuenta, se guarda
   bajo users/{uid}/guests/{guestId} y la próxima vez se reusa el MISMO
   guestId (dedup por searchName normalizado, mismo criterio que identity).

   CLIENTE PURO. Las reglas users/{uid}/guests ya están LIVE (E3a):
     allow read, write: if isMe(uid)   → solo el dueño.

   Schema users/{uid}/guests/{guestId}:
     { name, searchName, createdAt, lastUsedAt, claimedByUid:null }

   Depende de:
     - window.PuntazoFirebase (assets/firebase-core.js)
     - window.PuntazoAuth     (assets/auth.js)
     - window.PuntazoIdentity (assets/identity.js)  → normalizeName
     - firebase compat SDK (firestore)

   E4 (fusión de invitados, cliente puro): un invitado duplicado puede
   "fusionarse" en otro canónico con un puntero `mergedInto` (NO se reescriben
   partidos: los slots históricos conservan su guestId; la resolución por alias
   lo cubre en lectura). Guard anti-ciclo en la cadena de punteros.

   API window.PuntazoGuests:
     - listMyGuests()            → Promise<[{guestId,name,searchName,lastUsedAt,claimedByUid}]>  (excluye fusionados)
     - ensureGuest(name)         → Promise<{guestId,name}|null>   (best-effort; sigue mergedInto al canónico)
     - renameGuest(guestId,name) → Promise<void>
     - deleteGuest(guestId)      → Promise<void>
     - mergeGuests(from,into)    → Promise<void>   (E4: puntero from.mergedInto = canónico(into))
     - aliasGuestIds(canonical)  → Promise<[id,...]>  (E4: canónico + los que fusionaron en él, de MIS guests)
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoGuests) return;

  const MAX_LIST = 200;
  const MAX_MERGE_DEPTH = 8; // guard anti-ciclo al resolver cadenas mergedInto

  function db() {
    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function") return null;
    try { return window.PuntazoFirebase.db(); } catch (_) { return null; }
  }
  function me() {
    return (window.PuntazoAuth && window.PuntazoAuth.currentUser) || null;
  }
  function FV() {
    return firebase.firestore.FieldValue;
  }
  function guestsCol(uid) {
    return db().collection("users").doc(uid).collection("guests");
  }

  // Reusa la normalización de identity.js (NO duplicar): mismo searchName que
  // usa la base para users, así "Gabo" / "gabo" / "GABO " colapsan al mismo
  // guest. Fallback defensivo idéntico por si identity no cargó todavía.
  function norm(s) {
    if (window.PuntazoIdentity && typeof window.PuntazoIdentity.normalizeName === "function") {
      return window.PuntazoIdentity.normalizeName(s);
    }
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function cleanName(name) {
    return String(name || "").trim().slice(0, 80);
  }

  // Resuelve un guestId a su CANÓNICO siguiendo punteros mergedInto en un mapa
  // { id: { mergedInto } } ya cargado. PURA (testeable en Node). Anti-ciclo:
  // corta al revisitar un id o al exceder MAX_MERGE_DEPTH (devuelve el último id
  // visitado, nunca lanza ni cuelga ante A→B→A).
  function resolveCanonicalId(byId, startId) {
    let id = String(startId || "");
    if (!id) return id;
    const seen = Object.create(null);
    for (let depth = 0; depth < MAX_MERGE_DEPTH; depth++) {
      const node = byId && byId[id];
      const next = node && node.mergedInto ? String(node.mergedInto) : "";
      if (!next || next === id || seen[id]) break; // canónico, auto-ref o ciclo
      seen[id] = true;
      id = next;
    }
    return id;
  }

  // Sigue mergedInto LEYENDO docs (cuando no tenemos el mapa completo, p.ej. en
  // ensureGuest/mergeGuests). Devuelve { id, ref, data } del canónico. Best-effort
  // con el mismo guard anti-ciclo/profundidad.
  async function resolveCanonicalRef(uid, startId) {
    let id = String(startId || "");
    const seen = Object.create(null);
    let lastRef = guestsCol(uid).doc(id), lastData = {};
    for (let depth = 0; depth < MAX_MERGE_DEPTH; depth++) {
      if (!id || seen[id]) break;
      seen[id] = true;
      const ref = guestsCol(uid).doc(id);
      let snap;
      try { snap = await ref.get(); } catch (_) { break; }
      lastRef = ref;
      lastData = snap.exists ? (snap.data() || {}) : {};
      const next = lastData.mergedInto ? String(lastData.mergedInto) : "";
      if (!next || next === id) return { id: id, ref: ref, data: lastData };
      id = next;
    }
    return { id: id, ref: lastRef, data: lastData };
  }

  // listMyGuests: mis invitados ordenados por lastUsedAt desc. [] si no hay
  // login o falla (no rompe la UI que lo consume).
  async function listMyGuests() {
    const u = me(); const D = db();
    if (!u || !D) return [];
    try {
      const snap = await guestsCol(u.uid).orderBy("lastUsedAt", "desc").limit(MAX_LIST).get();
      const out = [];
      snap.forEach(function (d) {
        const x = d.data() || {};
        if (x.mergedInto) return; // E4: los fusionados ya no son canónicos → no ensucian el roster
        out.push({
          guestId: d.id,
          name: x.name || "",
          searchName: x.searchName || "",
          lastUsedAt: x.lastUsedAt || null,
          claimedByUid: x.claimedByUid || null,
        });
      });
      return out;
    } catch (e) {
      console.warn("[guests] listMyGuests falló", e);
      return [];
    }
  }

  // ensureGuest: busca por searchName; si existe actualiza lastUsedAt y
  // devuelve {guestId,name}; si no, crea el guest y lo devuelve. Dedup por
  // searchName (mismo criterio que identity). BEST-EFFORT: null si falla o
  // no hay login → el registro del partido NUNCA debe romperse por esto.
  async function ensureGuest(name) {
    const u = me(); const D = db();
    if (!u || !D) return null;
    const clean = cleanName(name);
    if (!clean) return null;
    const sn = norm(clean);
    if (!sn) return null;
    try {
      const q = await guestsCol(u.uid).where("searchName", "==", sn).limit(1).get();
      if (!q.empty) {
        let id = q.docs[0].id;
        let ref = q.docs[0].ref;
        let x = q.docs[0].data() || {};
        // E4: si este guest fue fusionado, reattachea al CANÓNICO (escribir "Gabito"
        // tras fusionarlo en "Gabo" devuelve el guestId de "Gabo").
        if (x.mergedInto) {
          const res = await resolveCanonicalRef(u.uid, id);
          id = res.id; ref = res.ref; x = res.data || x;
        }
        try { await ref.update({ lastUsedAt: FV().serverTimestamp() }); } catch (_) {}
        return { guestId: id, name: x.name || clean };
      }
      const ref = guestsCol(u.uid).doc();
      await ref.set({
        name: clean,
        searchName: sn,
        createdAt: FV().serverTimestamp(),
        lastUsedAt: FV().serverTimestamp(),
        claimedByUid: null,
      });
      return { guestId: ref.id, name: clean };
    } catch (e) {
      console.warn("[guests] ensureGuest falló (best-effort)", e);
      return null;
    }
  }

  // renameGuest: cambia el nombre visible (y recalcula searchName). Lanza si
  // no hay login o falta el id/nombre (la UI de gestión maneja el error).
  async function renameGuest(guestId, name) {
    const u = me(); const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    const id = String(guestId || "").trim();
    if (!id) throw new Error("guestId requerido");
    const clean = cleanName(name);
    if (!clean) throw new Error("Nombre requerido");
    await guestsCol(u.uid).doc(id).update({
      name: clean,
      searchName: norm(clean),
    });
  }

  // deleteGuest: borra el invitado. NO toca partidos ya registrados (el
  // guestId queda en los slots históricos; E4 hará merge/limpieza).
  async function deleteGuest(guestId) {
    const u = me(); const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    const id = String(guestId || "").trim();
    if (!id) throw new Error("guestId requerido");
    await guestsCol(u.uid).doc(id).delete();
  }

  // mergeGuests: marca `from` como fusionado en el CANÓNICO de `into` (puntero
  // mergedInto + mergedAt). NO toca partidos (las reglas lo bloquean en pending;
  // los slots históricos conservan su guestId y se resuelven por alias en lectura).
  // Guard: no auto-fusión, y resolvemos el canónico de `into` para no crear ciclos.
  async function mergeGuests(fromGuestId, intoGuestId) {
    const u = me(); const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    const from = String(fromGuestId || "").trim();
    const into = String(intoGuestId || "").trim();
    if (!from || !into) throw new Error("Faltan invitados a fusionar");
    if (from === into) throw new Error("No puedes fusionar un invitado consigo mismo");
    // Apuntar al canónico de `into` aplana cadenas y evita ciclos (into→…→from).
    const canon = await resolveCanonicalRef(u.uid, into);
    const canonId = (canon && canon.id) || into;
    if (canonId === from) throw new Error("Esa fusión crearía un ciclo");
    await guestsCol(u.uid).doc(from).update({
      mergedInto: canonId,
      mergedAt: FV().serverTimestamp(),
    });
  }

  // aliasGuestIds: dado un guestId canónico, devuelve [canónico, ...los que
  // fusionaron en él] consultando MIS guests. Úsalo para expandir un guestId a
  // todos sus alias al buscar partidos. Nota de privacidad: solo lee la colección
  // del usuario actual; si el guestId pertenece a OTRO dueño (caso del claimer),
  // degrada a [canónico] (no podemos —ni debemos— leer guests ajenos).
  async function aliasGuestIds(canonicalGuestId) {
    const canon = String(canonicalGuestId || "").trim();
    if (!canon) return [];
    const u = me(); const D = db();
    if (!u || !D) return [canon];
    try {
      const snap = await guestsCol(u.uid).limit(MAX_LIST).get();
      const byId = Object.create(null);
      snap.forEach(function (d) { byId[d.id] = { mergedInto: (d.data() || {}).mergedInto || null }; });
      const out = [canon];
      Object.keys(byId).forEach(function (id) {
        if (id === canon) return;
        if (byId[id].mergedInto && resolveCanonicalId(byId, id) === canon) out.push(id);
      });
      return out;
    } catch (e) {
      console.warn("[guests] aliasGuestIds falló", e);
      return [canon];
    }
  }

  window.PuntazoGuests = {
    listMyGuests: listMyGuests,
    ensureGuest: ensureGuest,
    renameGuest: renameGuest,
    deleteGuest: deleteGuest,
    mergeGuests: mergeGuests,
    aliasGuestIds: aliasGuestIds,
    _normalizeName: norm,
    _resolveCanonicalId: resolveCanonicalId, // expuesto para tests puros (Node)
  };
})();
