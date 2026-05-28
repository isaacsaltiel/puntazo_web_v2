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
  if (window.PuntazoGroups) return;

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

  async function createGroup(opts) {
    const u = me();
    const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    if (!opts || !opts.name) throw new Error("Nombre requerido");

    const groupRef = D.collection("groups").doc();
    const inviteCode = randomToken(12);
    const data = {
      groupId: groupRef.id,
      name: String(opts.name).trim().slice(0, 60),
      description: String(opts.description || "").trim().slice(0, 280),
      type: opts.type || "friends",  // friends | residencial | club | liga
      photoURL: "",
      createdAt: nowTS(),
      creatorUid: u.uid,
      admins: [u.uid],
      memberCount: 1,
      matchCount: 0,
      isPublic: !!opts.isPublic,
      inviteCode: inviteCode,
      rules: {
        rankingScope: "members_only",
        matchVisibility: "members_only",
      },
    };

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
    await memberRef.set({
      uid: u.uid,
      joinedAt: nowTS(),
      invitedBy: (opts && opts.invitedBy) || null,
      role: "member",
      displayName: (profile && profile.displayName) || u.displayName || "Yo",
      photoURL: (profile && profile.photoURL) || u.photoURL || "",
      isActive: true,
    });
    // Incrementar memberCount (best-effort, sin transacción para keep simple)
    try {
      await groupRef.update({
        memberCount: firebase.firestore.FieldValue.increment(1),
      });
    } catch (_) {}
  }

  async function leaveGroup(groupId) {
    const u = me();
    const D = db();
    if (!u || !D) return;
    const memberRef = D.collection("groups").doc(groupId).collection("members").doc(u.uid);
    await memberRef.delete();
    try {
      await D.collection("groups").doc(groupId).update({
        memberCount: firebase.firestore.FieldValue.increment(-1),
      });
    } catch (_) {}
  }

  async function kickMember(groupId, uid) {
    const D = db();
    if (!D) return;
    await D.collection("groups").doc(groupId).collection("members").doc(uid).delete();
    try {
      await D.collection("groups").doc(groupId).update({
        memberCount: firebase.firestore.FieldValue.increment(-1),
      });
    } catch (_) {}
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

  window.PuntazoGroups = {
    createGroup: createGroup,
    getGroup: getGroup,
    listMyGroups: listMyGroups,
    listGroupMembers: listGroupMembers,
    joinGroup: joinGroup,
    leaveGroup: leaveGroup,
    kickMember: kickMember,
    addAdmin: addAdmin,
    removeAdmin: removeAdmin,
    updateGroup: updateGroup,
    generateInviteLink: generateInviteLink,
  };
})();
