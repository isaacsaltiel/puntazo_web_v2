/* ══════════════════════════════════════════════════════════════
   PUNTAZO — friends.js  (Fase 3.G · v100)

   Amistades. Schema: friendships/{friendshipId} donde
   friendshipId = sorted(uidA, uidB).join("_") (determinístico).

   API window.PuntazoFriends:
     - sendFriendRequest(targetUid)
     - acceptFriendRequest(friendshipId)
     - rejectFriendRequest(friendshipId)
     - blockUser(targetUid)
     - unblockUser(targetUid)
     - removeFriend(friendUid)
     - listMyFriends()                    → accepted only
     - listPendingRequests()              → incoming pending
     - getFriendshipStatus(otherUid)      → 'none'|'pending_out'|'pending_in'|'accepted'|'blocked_by_me'|'blocked_by_them'
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoFriends) return;

  function db() {
    return window.PuntazoFirebase && window.PuntazoFirebase.db()
      ? window.PuntazoFirebase.db() : null;
  }
  function me() { return window.PuntazoAuth && window.PuntazoAuth.currentUser; }

  function nowTS() { return firebase.firestore.FieldValue.serverTimestamp(); }

  // Crea el friendshipId determinístico
  function makeFriendshipId(uidA, uidB) {
    if (uidA < uidB) return uidA + "_" + uidB;
    return uidB + "_" + uidA;
  }

  async function sendFriendRequest(targetUid) {
    const u = me();
    const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    if (targetUid === u.uid) throw new Error("No puedes agregarte a ti mismo");
    const fid = makeFriendshipId(u.uid, targetUid);
    const ref = D.collection("friendships").doc(fid);
    // OJO: get() sobre un friendship INEXISTENTE lo NIEGAN las reglas (el read rule
    // referencia resource.data.uidA y resource es null → revienta → permission-denied).
    // Por eso lo envolvemos: si falla/no existe, seguimos directo a crear la solicitud
    // (el create tiene su propia regla que sí valida). Verificado en emulador.
    let existing = null;
    try { existing = await ref.get(); } catch (e) { existing = null; }
    if (existing && existing.exists) {
      const data = existing.data();
      if (data.status === "accepted") throw new Error("Ya son amigos");
      if (data.status === "pending" && data.requesterUid === u.uid) throw new Error("Solicitud ya enviada");
      // Si la otra persona ya te había mandado solicitud → aceptas automáticamente
      if (data.status === "pending" && data.requesterUid !== u.uid) {
        await ref.update({ status: "accepted", acceptedAt: nowTS() });
        return;
      }
      if (data.status === "blocked") throw new Error("Esta amistad fue bloqueada");
    }
    const uidA = u.uid < targetUid ? u.uid : targetUid;
    const uidB = u.uid < targetUid ? targetUid : u.uid;
    await ref.set({
      friendshipId: fid,
      uidA: uidA,
      uidB: uidB,
      status: "pending",
      requesterUid: u.uid,
      createdAt: nowTS(),
    });
  }

  async function acceptFriendRequest(friendshipId) {
    const u = me();
    const D = db();
    if (!u || !D) return;
    const ref = D.collection("friendships").doc(friendshipId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const data = snap.data();
    if (data.status !== "pending") return;
    if (data.requesterUid === u.uid) throw new Error("No puedes aceptar tu propia solicitud");
    if (data.uidA !== u.uid && data.uidB !== u.uid) throw new Error("Esta solicitud no es para ti");
    await ref.update({ status: "accepted", acceptedAt: nowTS() });
  }

  async function rejectFriendRequest(friendshipId) {
    const u = me();
    const D = db();
    if (!u || !D) return;
    const ref = D.collection("friendships").doc(friendshipId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const data = snap.data();
    if (data.uidA !== u.uid && data.uidB !== u.uid) return;
    await ref.delete();
  }

  async function blockUser(targetUid) {
    const u = me();
    const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    const fid = makeFriendshipId(u.uid, targetUid);
    const ref = D.collection("friendships").doc(fid);
    const uidA = u.uid < targetUid ? u.uid : targetUid;
    const uidB = u.uid < targetUid ? targetUid : u.uid;
    await ref.set({
      friendshipId: fid, uidA: uidA, uidB: uidB,
      status: "blocked", requesterUid: u.uid,   // requesterUid = blocker
      createdAt: nowTS(),
    }, { merge: true });
  }

  async function unblockUser(targetUid) {
    const u = me();
    const D = db();
    if (!u || !D) return;
    const fid = makeFriendshipId(u.uid, targetUid);
    const ref = D.collection("friendships").doc(fid);
    const snap = await ref.get();
    if (!snap.exists) return;
    const data = snap.data();
    if (data.status === "blocked" && data.requesterUid === u.uid) {
      await ref.delete();
    }
  }

  async function removeFriend(friendUid) {
    const u = me();
    const D = db();
    if (!u || !D) return;
    const fid = makeFriendshipId(u.uid, friendUid);
    await D.collection("friendships").doc(fid).delete();
  }

  async function listMyFriends() {
    const u = me();
    const D = db();
    if (!u || !D) return [];
    // Necesitamos dos queries (uidA == me OR uidB == me) y mergear.
    // Firestore no soporta OR directamente, así que hacemos 2 queries.
    try {
      const [qa, qb] = await Promise.all([
        D.collection("friendships").where("uidA", "==", u.uid).where("status", "==", "accepted").get(),
        D.collection("friendships").where("uidB", "==", u.uid).where("status", "==", "accepted").get(),
      ]);
      const friends = [];
      qa.forEach(function (d) {
        const data = d.data();
        friends.push({ friendUid: data.uidB, friendshipId: d.id, acceptedAt: data.acceptedAt });
      });
      qb.forEach(function (d) {
        const data = d.data();
        friends.push({ friendUid: data.uidA, friendshipId: d.id, acceptedAt: data.acceptedAt });
      });
      // Hidratar con perfiles (si identity está disponible)
      if (window.PuntazoIdentity) {
        const hydrated = await Promise.all(friends.map(async function (f) {
          const p = await window.PuntazoIdentity.getProfile(f.friendUid);
          return Object.assign({}, f, { profile: p });
        }));
        return hydrated;
      }
      return friends;
    } catch (e) {
      console.warn("[friends] listMyFriends error", e);
      return [];
    }
  }

  // Solicitudes pendientes ENTRANTES (que YO debo aceptar/rechazar)
  async function listPendingRequests() {
    const u = me();
    const D = db();
    if (!u || !D) return [];
    try {
      const [qa, qb] = await Promise.all([
        D.collection("friendships").where("uidA", "==", u.uid).where("status", "==", "pending").get(),
        D.collection("friendships").where("uidB", "==", u.uid).where("status", "==", "pending").get(),
      ]);
      const reqs = [];
      function pushIfIncoming(d) {
        const data = d.data();
        if (data.requesterUid !== u.uid) {
          reqs.push({
            friendshipId: d.id,
            fromUid: data.requesterUid,
            createdAt: data.createdAt,
          });
        }
      }
      qa.forEach(pushIfIncoming);
      qb.forEach(pushIfIncoming);
      if (window.PuntazoIdentity) {
        const hydrated = await Promise.all(reqs.map(async function (r) {
          const p = await window.PuntazoIdentity.getProfile(r.fromUid);
          return Object.assign({}, r, { profile: p });
        }));
        return hydrated;
      }
      return reqs;
    } catch (e) {
      console.warn("[friends] listPendingRequests error", e);
      return [];
    }
  }

  async function getFriendshipStatus(otherUid) {
    const u = me();
    const D = db();
    if (!u || !D || !otherUid) return "none";
    if (otherUid === u.uid) return "self";
    const fid = makeFriendshipId(u.uid, otherUid);
    try {
      const snap = await D.collection("friendships").doc(fid).get();
      if (!snap.exists) return "none";
      const data = snap.data();
      if (data.status === "accepted") return "accepted";
      if (data.status === "blocked") {
        return data.requesterUid === u.uid ? "blocked_by_me" : "blocked_by_them";
      }
      if (data.status === "pending") {
        return data.requesterUid === u.uid ? "pending_out" : "pending_in";
      }
      return "none";
    } catch (e) {
      return "none";
    }
  }

  window.PuntazoFriends = {
    sendFriendRequest: sendFriendRequest,
    acceptFriendRequest: acceptFriendRequest,
    rejectFriendRequest: rejectFriendRequest,
    blockUser: blockUser,
    unblockUser: unblockUser,
    removeFriend: removeFriend,
    listMyFriends: listMyFriends,
    listPendingRequests: listPendingRequests,
    getFriendshipStatus: getFriendshipStatus,
    _makeFriendshipId: makeFriendshipId,
  };
})();
