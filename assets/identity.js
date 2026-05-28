/* ══════════════════════════════════════════════════════════════
   PUNTAZO — identity.js  (Fase 3.C · v100)

   Sistema de identidad robusto. Maneja:
     - Doc users/{uid} (perfil canónico extendido)
     - Auto-creación al primer login
     - Handles únicos (collection handles/{handle} → uid)
     - Edición de perfil (displayName, handle, bio, privacy)
     - Caching local del perfil

   Schema users/{uid}:
     {
       uid, displayName, realName, photoURL, handle, bio,
       homeClub, createdAt, lastSeenAt, authProvider,
       privacy: { profile, clips, matches },
       flags: { isBanned, isVerified, isDeleted, isAdmin },
       counts: { matches, wins, friends }
     }

   API expuesta en window.PuntazoIdentity:
     - getProfile(uid)               → Promise<profile|null>
     - getMyProfile()                → Promise<profile|null>  (current user)
     - updateMyProfile(changes)      → Promise<void>
     - setMyHandle(handle)           → Promise<{ok, error?}>
     - releaseMyHandle()             → Promise<void>
     - checkHandleAvailable(handle)  → Promise<bool>
     - findByHandle(handle)          → Promise<profile|null>
     - clearCache()                  → void
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoIdentity) return;

  const HANDLE_REGEX = /^[a-z0-9_]{3,20}$/;
  const PROFILE_CACHE = new Map();

  function db() {
    if (!window.PuntazoFirebase || typeof window.PuntazoFirebase.db !== "function") return null;
    return window.PuntazoFirebase.db();
  }

  function fbAuth() {
    return window.PuntazoAuth && window.PuntazoAuth.currentUser;
  }

  function nowTS() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function defaultProfile(authUser) {
    return {
      uid: authUser.uid,
      displayName: authUser.displayName || "",
      realName: "",
      photoURL: authUser.photoURL || "",
      handle: "",
      bio: "",
      homeClub: "",
      createdAt: nowTS(),
      lastSeenAt: nowTS(),
      authProvider: authUser.isAnonymous
        ? "anonymous"
        : (authUser.providerData && authUser.providerData[0] && authUser.providerData[0].providerId) || "unknown",
      privacy: {
        profile: "public",
        clips: "public",
        matches: "public",
      },
      flags: {
        isBanned: false,
        isVerified: false,
        isDeleted: false,
        isAdmin: false,
      },
      counts: {
        matches: 0,
        wins: 0,
        friends: 0,
      },
    };
  }

  // Asegurar que el doc users/{uid} existe + actualiza lastSeenAt
  async function ensureProfile(authUser) {
    const D = db();
    if (!D || !authUser) return null;
    const ref = D.collection("users").doc(authUser.uid);
    try {
      const snap = await ref.get();
      if (!snap.exists) {
        const data = defaultProfile(authUser);
        await ref.set(data);
        PROFILE_CACHE.set(authUser.uid, Object.assign({}, data));
        return data;
      }
      // Update lastSeenAt + photoURL/displayName si cambiaron en Google
      const data = snap.data();
      const updates = { lastSeenAt: nowTS() };
      if (authUser.photoURL && data.photoURL !== authUser.photoURL && !data.photoURL_customized) {
        updates.photoURL = authUser.photoURL;
      }
      if (authUser.displayName && !data.displayName) {
        updates.displayName = authUser.displayName;
      }
      try { await ref.update(updates); } catch (_) {}
      PROFILE_CACHE.set(authUser.uid, Object.assign({}, data, updates));
      return Object.assign({}, data, updates);
    } catch (e) {
      console.warn("[identity] ensureProfile falló", e);
      return null;
    }
  }

  async function getProfile(uid) {
    if (!uid) return null;
    if (PROFILE_CACHE.has(uid)) return PROFILE_CACHE.get(uid);
    const D = db();
    if (!D) return null;
    try {
      const snap = await D.collection("users").doc(uid).get();
      if (!snap.exists) return null;
      const data = snap.data();
      PROFILE_CACHE.set(uid, data);
      return data;
    } catch (e) {
      console.warn("[identity] getProfile error", e);
      return null;
    }
  }

  async function getMyProfile() {
    const u = fbAuth();
    if (!u) return null;
    return getProfile(u.uid);
  }

  async function updateMyProfile(changes) {
    const u = fbAuth();
    const D = db();
    if (!u || !D) throw new Error("Debes iniciar sesión");
    if (!changes || typeof changes !== "object") throw new Error("Cambios inválidos");
    // Whitelist de campos editables por el user
    const allowed = ["displayName", "realName", "bio", "homeClub", "photoURL", "privacy"];
    const upd = {};
    allowed.forEach(function (k) {
      if (k in changes) upd[k] = changes[k];
    });
    if (Object.keys(upd).length === 0) return;
    // Validaciones suaves
    if ("displayName" in upd) {
      upd.displayName = String(upd.displayName || "").trim().slice(0, 60);
    }
    if ("realName" in upd) {
      upd.realName = String(upd.realName || "").trim().slice(0, 80);
    }
    if ("bio" in upd) {
      upd.bio = String(upd.bio || "").trim().slice(0, 140);
    }
    if ("homeClub" in upd) {
      upd.homeClub = String(upd.homeClub || "").trim().slice(0, 60);
    }
    if ("photoURL" in upd && upd.photoURL) {
      upd.photoURL_customized = true; // no sobreescribir desde Google después
    }
    upd.lastSeenAt = nowTS();
    await D.collection("users").doc(u.uid).update(upd);
    PROFILE_CACHE.delete(u.uid);
  }

  function normalizeHandle(s) {
    return String(s || "").toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
  }

  function validateHandle(h) {
    if (!h) return { ok: false, error: "Vacío" };
    if (!HANDLE_REGEX.test(h)) {
      return { ok: false, error: "Solo letras minúsculas, números y guión bajo (3–20 chars)" };
    }
    // Palabras reservadas
    const RESERVED = ["admin", "puntazo", "root", "system", "support", "help", "api", "www"];
    if (RESERVED.indexOf(h) >= 0) {
      return { ok: false, error: "Ese handle está reservado" };
    }
    return { ok: true };
  }

  async function checkHandleAvailable(handle) {
    const h = normalizeHandle(handle);
    const v = validateHandle(h);
    if (!v.ok) return { available: false, error: v.error };
    const D = db();
    if (!D) return { available: false, error: "Firestore no disponible" };
    try {
      const snap = await D.collection("handles").doc(h).get();
      if (!snap.exists) return { available: true };
      const data = snap.data();
      const u = fbAuth();
      if (u && data.uid === u.uid) {
        return { available: true, ownedByMe: true };
      }
      return { available: false, error: "Ese handle ya está tomado" };
    } catch (e) {
      console.warn("[identity] checkHandleAvailable error", e);
      return { available: false, error: "Error al verificar" };
    }
  }

  async function setMyHandle(handle) {
    const u = fbAuth();
    const D = db();
    if (!u || !D) return { ok: false, error: "Debes iniciar sesión" };
    const h = normalizeHandle(handle);
    const v = validateHandle(h);
    if (!v.ok) return v;

    // Transacción: reservar handle nuevo + (opcional) liberar el viejo + update perfil
    const newHandleRef = D.collection("handles").doc(h);
    const userRef = D.collection("users").doc(u.uid);

    try {
      await D.runTransaction(async function (tx) {
        const newSnap = await tx.get(newHandleRef);
        if (newSnap.exists) {
          const data = newSnap.data();
          if (data.uid !== u.uid) {
            throw new Error("HANDLE_TAKEN");
          }
          // Ya es mío → no-op
          return;
        }
        const userSnap = await tx.get(userRef);
        const oldHandle = userSnap.exists ? (userSnap.data().handle || "") : "";
        if (oldHandle && oldHandle !== h) {
          // Liberar el viejo
          tx.delete(D.collection("handles").doc(oldHandle));
        }
        // Reservar nuevo
        tx.set(newHandleRef, {
          handle: h,
          uid: u.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        // Update perfil
        tx.update(userRef, {
          handle: h,
          lastSeenAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      PROFILE_CACHE.delete(u.uid);
      return { ok: true };
    } catch (e) {
      if (e && e.message === "HANDLE_TAKEN") return { ok: false, error: "Ese handle ya está tomado" };
      console.warn("[identity] setMyHandle error", e);
      return { ok: false, error: "No se pudo guardar el handle" };
    }
  }

  async function releaseMyHandle() {
    const u = fbAuth();
    const D = db();
    if (!u || !D) return;
    const userRef = D.collection("users").doc(u.uid);
    try {
      const userSnap = await userRef.get();
      if (!userSnap.exists) return;
      const old = userSnap.data().handle;
      if (!old) return;
      await D.runTransaction(async function (tx) {
        tx.delete(D.collection("handles").doc(old));
        tx.update(userRef, { handle: "" });
      });
      PROFILE_CACHE.delete(u.uid);
    } catch (e) {
      console.warn("[identity] releaseMyHandle error", e);
    }
  }

  async function findByHandle(handle) {
    const h = normalizeHandle(handle);
    if (!h) return null;
    const D = db();
    if (!D) return null;
    try {
      const snap = await D.collection("handles").doc(h).get();
      if (!snap.exists) return null;
      const data = snap.data();
      return getProfile(data.uid);
    } catch (e) {
      return null;
    }
  }

  function clearCache() {
    PROFILE_CACHE.clear();
  }

  // Auto-bootstrap: cuando auth dispare, asegurar profile.
  window.addEventListener("puntazo:auth-changed", function (e) {
    const u = e && e.detail && e.detail.user;
    if (u && !u.isAnonymous) {
      ensureProfile(u).catch(function () {});
    }
  });

  // Si auth ya estaba listo cuando este script cargó
  window.addEventListener("puntazo:auth-ready", function () {
    const u = fbAuth();
    if (u && !u.isAnonymous) {
      ensureProfile(u).catch(function () {});
    }
  });

  window.PuntazoIdentity = {
    getProfile: getProfile,
    getMyProfile: getMyProfile,
    updateMyProfile: updateMyProfile,
    setMyHandle: setMyHandle,
    releaseMyHandle: releaseMyHandle,
    checkHandleAvailable: checkHandleAvailable,
    findByHandle: findByHandle,
    normalizeHandle: normalizeHandle,
    validateHandle: validateHandle,
    clearCache: clearCache,
    _ensureProfile: ensureProfile,
  };
})();
