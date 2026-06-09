/* ══════════════════════════════════════════════════════════════
   PUNTAZO — groups.js  (Fase 3.F · v100)

   Grupos / ligas. Wrappers sobre Firestore collections:
     - groups/{groupId}                  (metadata)
     - groups/{groupId}/members/{uid}    (membresía)

   API window.PuntazoGroups:
     - createGroup({name, description, type}) → Promise<groupId>
     - getGroup(groupId) → Promise<group|null>
     - listMyGroups() → Promise<[group]>
     - listGroupMembers(groupId) → Promise<[member]>
     - joinGroup(groupId)            (logged-in user se une)
     - leaveGroup(groupId)
     - kickMember(groupId, uid)      (admin only)
     - addAdmin(groupId, uid)        (admin only)
     - removeAdmin(groupId, uid)     (admin only, no self-demote si es el último)
     - updateGroup(groupId, changes) (admin only)
     - generateInviteLink(groupId)   (URL para WhatsApp/copiar)

   Diseño:
   - Cada grupo tiene un inviteCode (auto en createGroup).
   - Link: puntazoclips.com/g/{groupId}?invite={inviteCode}
   - El inviteCode permite que CUALQUIERA con el link se una.
   - Sin Cloud Function: el ranking interno NO se calcula aún
     (Fase futura). Por ahora solo membresía.
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (typeof window !== "undefined" && window.PuntazoGroups) return;

  function db() {
    return window.PuntazoFirebase && window.PuntazoFirebase.db()
      ? window.PuntazoFirebase.db()
      : null;
  }
  function me() { return window.PuntazoAuth && window.PuntazoAuth.currentUser; }

  function nowTS() { return firebase.firestore.FieldValue.serverTimestamp(); }

  function randomToken(len) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < (len || 12); i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }

  // ── Helpers PUROS (sin Firestore/firebase/window): testeables en Node ──

  // Construye el bloque `league` del doc del grupo. seasonId ya generado afuera.
  // mode default "individual"; "pairs" añade el array `pairs`. Retorna objeto plano.
  function buildLeagueBlock(leagueOpts, seasonId) {
    const o = leagueOpts || {};
    const mode = (o.mode === "pairs") ? "pairs" : "individual";
    const block = {
      mode: mode,
      sport: "padel",
      pointsWin: 3,
      pointsLoss: 0,
      countThreshold: 3,
      activeSeasonId: seasonId || null,
    };
    if (mode === "pairs") {
      block.pairs = Array.isArray(o.pairs) ? o.pairs.map(function (p, i) {
        p = p || {};
        return {
          pairId: String(p.pairId || ("p" + (i + 1))),
          uids: Array.isArray(p.uids) ? p.uids.slice(0, 2) : [],
          name: String(p.name || "").trim().slice(0, 60),
        };
      }) : [];
    }
    return block;
  }

  // Construye el doc de una temporada (SIN createdAt: el caller le añade serverTimestamp).
  function buildSeasonDoc(seasonId, seasonOpts) {
    const o = seasonOpts || {};
    return {
      seasonId: seasonId,
      name: String(o.name || "Temporada 1").trim().slice(0, 60),
      startMs: Number.isFinite(o.startMs) ? o.startMs : null,
      endMs: Number.isFinite(o.endMs) ? o.endMs : null,
      closed: false,
    };
  }

  // Filtra cambios permitidos de league config. `mode` es INMUTABLE (nunca pasa).
  // Devuelve un mapa de update con paths dot-notation (`league.activeSeasonId`, …).
  function sanitizeLeagueConfigChanges(changes) {
    const out = {};
    if (!changes || typeof changes !== "object") return out;
    if ("activeSeasonId" in changes) out["league.activeSeasonId"] = changes.activeSeasonId;
    if ("pointsWin" in changes && Number.isFinite(changes.pointsWin)) out["league.pointsWin"] = changes.pointsWin;
    if ("pointsLoss" in changes && Number.isFinite(changes.pointsLoss)) out["league.pointsLoss"] = changes.pointsLoss;
    if ("countThreshold" in changes && Number.isFinite(changes.countThreshold)) out["league.countThreshold"] = changes.countThreshold;
    if ("pairs" in changes && Array.isArray(changes.pairs)) out["league.pairs"] = changes.pairs;
    // `mode` se ignora deliberadamente: cambiarlo corrompe la historia de standings (E7).
    return out;
  }

  async function createGroup(opts) {
    const u = me();
    const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    if (!opts || !opts.name) throw new Error("Nombre requerido");

    const groupRef = D.collection("groups").doc();
    const inviteCode = randomToken(12);
    const isLiga = (opts.type === "liga");
    const data = {
      groupId: groupRef.id,
      name: String(opts.name).trim().slice(0, 60),
      description: String(opts.description || "").trim().slice(0, 280),
      type: opts.type || "friends",  // friends | residencial | club | liga
      photoURL: "",
      createdAt: nowTS(),
      creatorUid: u.uid,
      admins: [u.uid],
      // memberUids: espejo (array) de la subcolección members. NECESARIO para el
      // heurístico ≥3 server-side de E7 (índice inverso uid→liga sin 4 get()) y para
      // las reglas de self-join. Se mantiene ATÓMICAMENTE en create/join/add/leave/kick.
      memberUids: [u.uid],
      memberCount: 1,
      matchCount: 0,
      isPublic: !!opts.isPublic,
      inviteCode: inviteCode,
      rules: {
        rankingScope: "members_only",
        matchVisibility: "members_only",
      },
    };

    // ── Capa LIGA (aditiva): bloque `league` + 1ª temporada ──
    // OJO: la temporada NO va en el batch del grupo. La regla de seasons.create valida
    // `uid in get(grupo).admins`, y get() en reglas NO ve escrituras pendientes del mismo
    // batch → el grupo aún no existe a mitad del batch y la season sería DENEGADA. Por eso
    // se crea en un 2º paso, ya con el grupo committeado (verificado en emulador,
    // functions/itest/league-create-flow.js).
    let seasonRef = null, seasonDoc = null;
    if (isLiga) {
      const seasonId = groupRef.collection("seasons").doc().id;
      data.league = buildLeagueBlock(opts.league, seasonId);
      seasonRef = groupRef.collection("seasons").doc(seasonId);
      seasonDoc = Object.assign(buildSeasonDoc(seasonId, opts.season), { createdAt: nowTS() });
    }

    // Crear grupo + agregar creador como member en una transacción.
    const memberRef = groupRef.collection("members").doc(u.uid);
    const profile = window.PuntazoIdentity ? await window.PuntazoIdentity.getMyProfile() : null;
    const batch = D.batch();
    batch.set(groupRef, data);
    batch.set(memberRef, {
      uid: u.uid,
      joinedAt: nowTS(),
      invitedBy: null,
      role: "admin",
      displayName: (profile && profile.displayName) || u.displayName || "Yo",
      photoURL: (profile && profile.photoURL) || u.photoURL || "",
      isActive: true,
    });
    await batch.commit();

    // 2º paso: la 1ª temporada, ya con el grupo existente (la regla resuelve admins).
    // Best-effort: si fallara, la liga queda creada con activeSeasonId colgante
    // (getActiveSeason → null, la UI lo tolera); no abortamos la creación de la liga.
    if (isLiga && seasonRef) {
      try { await seasonRef.set(seasonDoc); }
      catch (e) { console.warn("[groups] temporada inicial no se pudo crear (liga creada igual)", e); }
    }
    return groupRef.id;
  }

  async function getGroup(groupId) {
    const D = db();
    if (!D || !groupId) return null;
    try {
      const snap = await D.collection("groups").doc(groupId).get();
      if (!snap.exists) return null;
      return Object.assign({ groupId: snap.id }, snap.data());
    } catch (e) {
      console.warn("[groups] getGroup error", e);
      return null;
    }
  }

  async function listGroupMembers(groupId) {
    const D = db();
    if (!D || !groupId) return [];
    try {
      const snap = await D.collection("groups").doc(groupId).collection("members").get();
      const out = [];
      snap.forEach(function (d) { out.push(Object.assign({}, d.data())); });
      return out;
    } catch (e) {
      console.warn("[groups] listGroupMembers error", e);
      return [];
    }
  }

  // listMyGroups: collectionGroup query sobre members con uid==me.
  async function listMyGroups() {
    const u = me();
    const D = db();
    if (!u || !D) return [];
    try {
      const snap = await D.collectionGroup("members")
        .where("uid", "==", u.uid)
        .get();
      const groupIds = new Set();
      snap.forEach(function (d) {
        const parent = d.ref.parent && d.ref.parent.parent;
        if (parent) groupIds.add(parent.id);
      });
      const groups = await Promise.all(Array.from(groupIds).map(getGroup));
      return groups.filter(Boolean);
    } catch (e) {
      console.warn("[groups] listMyGroups error", e);
      return [];
    }
  }

  async function joinGroup(groupId, opts) {
    const u = me();
    const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    const memberRef = D.collection("groups").doc(groupId).collection("members").doc(u.uid);
    const groupRef = D.collection("groups").doc(groupId);
    const existing = await memberRef.get();
    if (existing.exists) return; // ya member
    const profile = window.PuntazoIdentity ? await window.PuntazoIdentity.getMyProfile() : null;
    // memberUids + member doc en la MISMA operación (batch): el self-join agrega
    // EXACTAMENTE tu uid a memberUids (invariante de conjunto que la regla valida).
    // memberCount sigue como increment best-effort dentro del mismo batch.
    const batch = D.batch();
    batch.set(memberRef, {
      uid: u.uid,
      joinedAt: nowTS(),
      invitedBy: (opts && opts.invitedBy) || null,
      role: "member",
      displayName: (profile && profile.displayName) || u.displayName || "Yo",
      photoURL: (profile && profile.photoURL) || u.photoURL || "",
      isActive: true,
    });
    batch.update(groupRef, {
      memberUids: firebase.firestore.FieldValue.arrayUnion(u.uid),
      memberCount: firebase.firestore.FieldValue.increment(1),
    });
    await batch.commit();
  }

  async function leaveGroup(groupId) {
    const u = me();
    const D = db();
    if (!u || !D) return;
    const memberRef = D.collection("groups").doc(groupId).collection("members").doc(u.uid);
    const groupRef = D.collection("groups").doc(groupId);
    // memberUids arrayRemove + delete del member doc en el MISMO batch (atómico).
    const batch = D.batch();
    batch.delete(memberRef);
    batch.update(groupRef, {
      memberUids: firebase.firestore.FieldValue.arrayRemove(u.uid),
      memberCount: firebase.firestore.FieldValue.increment(-1),
    });
    await batch.commit();
  }

  async function kickMember(groupId, uid) {
    const D = db();
    if (!D) return;
    const groupRef = D.collection("groups").doc(groupId);
    const memberRef = groupRef.collection("members").doc(uid);
    // memberUids arrayRemove + delete en el MISMO batch (admin kick, atómico).
    const batch = D.batch();
    batch.delete(memberRef);
    batch.update(groupRef, {
      memberUids: firebase.firestore.FieldValue.arrayRemove(uid),
      memberCount: firebase.firestore.FieldValue.increment(-1),
    });
    await batch.commit();
  }

  async function addAdmin(groupId, uid) {
    const D = db();
    if (!D) return;
    await D.collection("groups").doc(groupId).update({
      admins: firebase.firestore.FieldValue.arrayUnion(uid),
    });
    // Update role en el member doc
    try {
      await D.collection("groups").doc(groupId).collection("members").doc(uid).update({ role: "admin" });
    } catch (_) {}
  }

  async function removeAdmin(groupId, uid) {
    const D = db();
    if (!D) return;
    const g = await getGroup(groupId);
    if (!g || !Array.isArray(g.admins)) return;
    if (g.admins.length === 1) throw new Error("No puedes quitar al último admin");
    await D.collection("groups").doc(groupId).update({
      admins: firebase.firestore.FieldValue.arrayRemove(uid),
    });
    try {
      await D.collection("groups").doc(groupId).collection("members").doc(uid).update({ role: "member" });
    } catch (_) {}
  }

  async function updateGroup(groupId, changes) {
    const D = db();
    if (!D) return;
    const allowed = ["name", "description", "type", "photoURL", "isPublic"];
    const upd = {};
    allowed.forEach(function (k) {
      if (k in changes) upd[k] = changes[k];
    });
    if (Object.keys(upd).length === 0) return;
    if (upd.name) upd.name = String(upd.name).trim().slice(0, 60);
    if (upd.description) upd.description = String(upd.description).trim().slice(0, 280);
    await D.collection("groups").doc(groupId).update(upd);
  }

  function generateInviteLink(groupId, inviteCode) {
    const origin = (window.location && window.location.origin) || "https://puntazoclips.com";
    return origin + "/grupo.html?groupId=" + encodeURIComponent(groupId) +
           "&invite=" + encodeURIComponent(inviteCode);
  }

  // Invite-link de LIGA → liga.html (param `id`, consistente con lo que lee liga.html).
  function generateLeagueInviteLink(groupId, inviteCode) {
    const origin = (window.location && window.location.origin) || "https://puntazoclips.com";
    return origin + "/liga.html?id=" + encodeURIComponent(groupId) +
           "&invite=" + encodeURIComponent(inviteCode);
  }

  // ── Alta de miembro por un ADMIN (buscador). Idempotente: si ya existe, no-op ──
  // La regla members/{uid}.create permite a un admin crear el doc de otro uid.
  async function addMember(groupId, uid, profile) {
    const u = me();
    const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    if (!groupId || !uid) throw new Error("Faltan datos");
    const groupRef = D.collection("groups").doc(groupId);
    const memberRef = groupRef.collection("members").doc(uid);
    const existing = await memberRef.get();
    if (existing.exists) return; // ya member → no dupliques
    const p = profile || {};
    // memberUids arrayUnion + member doc en el MISMO batch (admin alta, atómico).
    const batch = D.batch();
    batch.set(memberRef, {
      uid: uid,
      joinedAt: nowTS(),
      invitedBy: u.uid,
      role: "member",
      displayName: p.displayName || "",
      photoURL: p.photoURL || "",
      isActive: true,
    });
    batch.update(groupRef, {
      memberUids: firebase.firestore.FieldValue.arrayUnion(uid),
      memberCount: firebase.firestore.FieldValue.increment(1),
    });
    await batch.commit();
  }

  // ── Temporadas ──
  async function listSeasons(groupId) {
    const D = db();
    if (!D || !groupId) return [];
    try {
      const snap = await D.collection("groups").doc(groupId).collection("seasons").get();
      const out = [];
      snap.forEach(function (d) { out.push(Object.assign({ seasonId: d.id }, d.data())); });
      return out;
    } catch (e) {
      console.warn("[groups] listSeasons error", e);
      return [];
    }
  }

  async function getActiveSeason(groupId) {
    const D = db();
    if (!D || !groupId) return null;
    const g = await getGroup(groupId);
    const activeId = g && g.league && g.league.activeSeasonId;
    if (!activeId) return null;
    try {
      const snap = await D.collection("groups").doc(groupId).collection("seasons").doc(activeId).get();
      if (!snap.exists) return null;
      return Object.assign({ seasonId: snap.id }, snap.data());
    } catch (e) {
      console.warn("[groups] getActiveSeason error", e);
      return null;
    }
  }

  async function createSeason(groupId, opts) {
    const D = db();
    if (!D || !groupId) throw new Error("Faltan datos");
    const ref = D.collection("groups").doc(groupId).collection("seasons").doc();
    const doc = Object.assign(buildSeasonDoc(ref.id, opts), { createdAt: nowTS() });
    await ref.set(doc);
    // Apuntar la temporada activa a la nueva (admin: lo permite la regla de update del grupo).
    try {
      await D.collection("groups").doc(groupId).update({ "league.activeSeasonId": ref.id });
    } catch (_) {}
    return ref.id;
  }

  // Inicializa el bloque `league` de una liga LEGACY (type:"liga" sin `league`).
  // Crea la 1ª temporada y escribe el bloque completo (incluye `mode`, que solo
  // se puede fijar la primera vez — luego es inmutable por reglas). Admin only.
  async function initLeagueBlock(groupId, opts) {
    const D = db();
    if (!D || !groupId) throw new Error("Faltan datos");
    const groupRef = D.collection("groups").doc(groupId);
    const seasonRef = groupRef.collection("seasons").doc();
    const seasonDoc = Object.assign(buildSeasonDoc(seasonRef.id, (opts && opts.season) || { name: "Temporada 1", startMs: Date.now() }), { createdAt: nowTS() });
    await seasonRef.set(seasonDoc);
    const block = buildLeagueBlock((opts && opts.league) || { mode: "individual" }, seasonRef.id);
    await groupRef.update({ league: block });
    return seasonRef.id;
  }

  // Config de liga (admin). `mode` es INMUTABLE (sanitize lo descarta).
  async function updateLeagueConfig(groupId, changes) {
    const D = db();
    if (!D || !groupId) return;
    const upd = sanitizeLeagueConfigChanges(changes);
    if (Object.keys(upd).length === 0) return;
    await D.collection("groups").doc(groupId).update(upd);
  }

  // Conveniencia para ligas.html: mis grupos filtrados a type=="liga".
  async function listMyLeagues() {
    const groups = await listMyGroups();
    return groups.filter(function (g) { return g && g.type === "liga"; });
  }

  const api = {
    createGroup: createGroup,
    getGroup: getGroup,
    listMyGroups: listMyGroups,
    listMyLeagues: listMyLeagues,
    listGroupMembers: listGroupMembers,
    joinGroup: joinGroup,
    leaveGroup: leaveGroup,
    kickMember: kickMember,
    addMember: addMember,
    addAdmin: addAdmin,
    removeAdmin: removeAdmin,
    updateGroup: updateGroup,
    updateLeagueConfig: updateLeagueConfig,
    initLeagueBlock: initLeagueBlock,
    listSeasons: listSeasons,
    getActiveSeason: getActiveSeason,
    createSeason: createSeason,
    generateInviteLink: generateInviteLink,
    generateLeagueInviteLink: generateLeagueInviteLink,
    // Helpers puros expuestos para tests Node.
    _buildLeagueBlock: buildLeagueBlock,
    _buildSeasonDoc: buildSeasonDoc,
    _sanitizeLeagueConfigChanges: sanitizeLeagueConfigChanges,
  };

  if (typeof window !== "undefined") window.PuntazoGroups = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
