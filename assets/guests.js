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

   API window.PuntazoGuests:
     - listMyGuests()            → Promise<[{guestId,name,searchName,lastUsedAt,claimedByUid}]>
     - ensureGuest(name)         → Promise<{guestId,name}|null>   (best-effort)
     - renameGuest(guestId,name) → Promise<void>
     - deleteGuest(guestId)      → Promise<void>
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoGuests) return;

  const MAX_LIST = 200;

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
        const d = q.docs[0];
        const x = d.data() || {};
        try { await d.ref.update({ lastUsedAt: FV().serverTimestamp() }); } catch (_) {}
        return { guestId: d.id, name: x.name || clean };
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

  window.PuntazoGuests = {
    listMyGuests: listMyGuests,
    ensureGuest: ensureGuest,
    renameGuest: renameGuest,
    deleteGuest: deleteGuest,
    _normalizeName: norm,
  };
})();
