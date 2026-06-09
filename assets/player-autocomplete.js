/* ══════════════════════════════════════════════════════════════
   PUNTAZO — player-autocomplete.js  (Fase 3.H · v100)

   Componente reusable de autocomplete para inputs de nombre de
   jugador en mi-partido (sheets), terminar partido (sheet edita
   nombres), registrar-partido futuro, etc.

   Fuente de datos: users/{myUid}/recentPlayers/{otherKey}
     {
       displayName, uid?, photoURL?, lastPlayedAt,
       matchCount, isFriend?, ...
     }

   Si no hay datos previos, el componente carga jugadores de mis
   últimos N matches via collectionGroup('claims') + matches/{id}.
   Eso popula recentPlayers en el primer uso.

   API window.PuntazoPlayerAutocomplete:
     - attach({ input, onSelect, onChange })
        → devuelve { detach() } para limpiar
     - prefetchPool(uid)  → Promise<void>  (warmup opcional)
     - clearPool()        → void
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoPlayerAutocomplete) return;

  function db() {
    return window.PuntazoFirebase && window.PuntazoFirebase.db()
      ? window.PuntazoFirebase.db() : null;
  }
  function me() { return window.PuntazoAuth && window.PuntazoAuth.currentUser; }

  let _pool = null; // [{displayName, uid?, photoURL?, isFriend?}]
  let _poolFetchPromise = null;

  // Stop words / normalización para el matching
  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  // Carga el pool de jugadores recientes desde matches del user
  async function buildPoolFromMatches(uid) {
    const D = db();
    if (!D || !uid) return [];
    const seen = {}; // displayName lowercase → {displayName, uid?, photoURL?, count, lastPlayedAt}
    try {
      const claimsSnap = await D.collectionGroup("claims")
        .where("uid", "==", uid)
        .orderBy("claimedAt", "desc")
        .limit(50)
        .get();
      const matchIds = new Set();
      claimsSnap.forEach(function (d) {
        const parent = d.ref.parent && d.ref.parent.parent;
        if (parent) matchIds.add(parent.id);
      });
      const matches = await Promise.all(Array.from(matchIds).map(function (id) {
        return D.collection("matches").doc(id).get()
          .then(function (s) { return s.exists ? Object.assign({ id: s.id }, s.data()) : null; })
          .catch(function () { return null; });
      }));
      matches.filter(Boolean).forEach(function (m) {
        const jugadores = Array.isArray(m.jugadores) ? m.jugadores : [];
        jugadores.forEach(function (j) {
          if (!j || !j.nombre) return;
          if (j.uid === uid) return; // no yo
          const key = normalize(j.nombre);
          if (!key) return;
          if (!seen[key]) {
            seen[key] = {
              displayName: String(j.nombre).trim(),
              uid: j.uid || null,
              photoURL: null,
              count: 0,
              lastPlayedAt: m.endedAt || m.startedAt || null,
            };
          }
          seen[key].count++;
          if (j.uid && !seen[key].uid) seen[key].uid = j.uid;
        });
      });
      return Object.values(seen).sort(function (a, b) {
        // Prioritize: con uid > sin uid; más count > menos count
        if (a.uid && !b.uid) return -1;
        if (!a.uid && b.uid) return 1;
        return b.count - a.count;
      });
    } catch (e) {
      console.warn("[player-autocomplete] buildPool error", e);
      return [];
    }
  }

  // E3c: pool = jugadores recientes (de matches) + invitados persistentes del
  // dueño (users/{uid}/guests). Dedup por nombre normalizado: si un invitado
  // ya aparece como reciente, NO se duplica. Los invitados van marcados
  // (isGuest) para mostrarse como "· invitado" en el dropdown.
  async function buildPool(uid) {
    const pool = await buildPoolFromMatches(uid);
    const seen = {};
    pool.forEach(function (p) { seen[normalize(p.displayName)] = 1; });
    try {
      if (window.PuntazoGuests && typeof window.PuntazoGuests.listMyGuests === "function") {
        const guests = await window.PuntazoGuests.listMyGuests();
        (guests || []).forEach(function (g) {
          const nm = String(g.name || "").trim();
          if (!nm) return;
          const key = normalize(nm);
          if (!key || seen[key]) return;   // ya está como reciente → no duplicar
          seen[key] = 1;
          pool.push({
            displayName: nm,
            uid: null,
            isGuest: true,
            guestId: g.guestId || null,
            count: null,
            photoURL: null,
          });
        });
      }
    } catch (e) {
      console.warn("[player-autocomplete] merge guests error", e);
    }
    return pool;
  }

  async function prefetchPool(uid) {
    if (_pool) return _pool;
    if (_poolFetchPromise) return _poolFetchPromise;
    const u = uid || (me() && me().uid);
    if (!u) return [];
    _poolFetchPromise = buildPool(u).then(function (pool) {
      _pool = pool;
      _poolFetchPromise = null;
      return pool;
    });
    return _poolFetchPromise;
  }

  function clearPool() {
    _pool = null;
    _poolFetchPromise = null;
  }

  function filterMatches(query, pool) {
    if (!query) return pool.slice(0, 6);
    const q = normalize(query);
    if (!q) return pool.slice(0, 6);
    const startsWith = [];
    const includes = [];
    pool.forEach(function (p) {
      const n = normalize(p.displayName);
      if (n.startsWith(q)) startsWith.push(p);
      else if (n.includes(q)) includes.push(p);
    });
    return [].concat(startsWith, includes).slice(0, 6);
  }

  // ── UI dropdown ──────────────────────────────────────────────
  function createDropdown(input) {
    const dd = document.createElement("div");
    dd.className = "pz-pa-dropdown";
    dd.setAttribute("role", "listbox");
    Object.assign(dd.style, {
      position: "absolute",
      zIndex: "12000",
      background: "rgba(15, 22, 38, 0.98)",
      border: "1px solid rgba(255, 255, 255, 0.16)",
      borderRadius: "10px",
      boxShadow: "0 14px 36px rgba(0,0,0,0.55)",
      padding: "4px",
      minWidth: "200px",
      maxHeight: "240px",
      overflowY: "auto",
      display: "none",
      fontFamily: "Montserrat, sans-serif",
    });
    document.body.appendChild(dd);
    return dd;
  }

  function positionDropdown(input, dd) {
    const r = input.getBoundingClientRect();
    dd.style.left = (window.scrollX + r.left) + "px";
    dd.style.top = (window.scrollY + r.bottom + 4) + "px";
    dd.style.width = Math.max(r.width, 220) + "px";
  }

  function renderDropdown(dd, items, query, onPick) {
    dd.innerHTML = "";
    if (!items.length && !query) {
      dd.style.display = "none";
      return;
    }
    items.forEach(function (p) {
      const item = document.createElement("div");
      item.className = "pz-pa-item";
      Object.assign(item.style, {
        padding: "8px 10px",
        borderRadius: "8px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        color: "#eaf2ff",
        fontSize: "0.92rem",
        fontWeight: "700",
      });
      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "8px", height: "8px", borderRadius: "50%",
        flexShrink: "0",
        background: p.isFriend ? "#22c55e" : (p.uid ? "#0b7cff" : "#ffcc66"),
      });
      const txt = document.createElement("span");
      txt.style.flex = "1";
      txt.style.overflow = "hidden";
      txt.style.textOverflow = "ellipsis";
      txt.style.whiteSpace = "nowrap";
      txt.textContent = p.displayName;
      const meta = document.createElement("span");
      meta.style.fontSize = "0.7rem";
      meta.style.color = "rgba(234, 242, 255, 0.55)";
      meta.style.fontWeight = "600";
      // Invitado del dueño → "· invitado"; jugador reciente → "N partidos";
      // usuario de toda la base → @handle / "en Puntazo".
      if (p.isGuest) meta.textContent = "· invitado";
      else if (p.count != null) meta.textContent = p.count + " " + (p.count === 1 ? "partido" : "partidos");
      else meta.textContent = p.handle ? ("@" + p.handle) : "en Puntazo";
      item.appendChild(dot);
      item.appendChild(txt);
      item.appendChild(meta);
      item.addEventListener("mouseenter", function () { item.style.background = "rgba(11, 124, 255, 0.18)"; });
      item.addEventListener("mouseleave", function () { item.style.background = ""; });
      item.addEventListener("mousedown", function (e) {
        e.preventDefault(); // evitar blur del input
        onPick(p);
      });
      dd.appendChild(item);
    });
    // Si el query no es exacto match de ningún item, ofrecer "Usar X"
    if (query) {
      const qNorm = normalize(query);
      const isInList = items.some(function (p) { return normalize(p.displayName) === qNorm; });
      if (!isInList) {
        const sep = document.createElement("div");
        Object.assign(sep.style, { height: "1px", background: "rgba(255,255,255,0.08)", margin: "4px 0" });
        dd.appendChild(sep);
        const newItem = document.createElement("div");
        Object.assign(newItem.style, {
          padding: "8px 10px", borderRadius: "8px", cursor: "pointer",
          color: "rgba(234,242,255,0.65)", fontSize: "0.86rem", fontWeight: "700",
        });
        newItem.textContent = '+ Usar "' + query + '"';
        newItem.addEventListener("mouseenter", function () { newItem.style.background = "rgba(11,124,255,0.18)"; });
        newItem.addEventListener("mouseleave", function () { newItem.style.background = ""; });
        newItem.addEventListener("mousedown", function (e) {
          e.preventDefault();
          onPick({ displayName: query, uid: null });
        });
        dd.appendChild(newItem);
      }
    }
    dd.style.display = "block";
  }

  function attach(opts) {
    if (!opts || !opts.input) return { detach: function () {} };
    const input = opts.input;
    const onSelect = opts.onSelect || function () {};
    const dd = createDropdown(input);
    const searchAll = !!opts.global; // opt-in: buscar en TODA la base (registrar-partido)
    let pool = _pool || [];
    let remoteSeq = 0;       // token para descartar respuestas remotas viejas
    let remoteTimer = null;  // debounce
    let lastRemote = [];     // últimos resultados de toda la base para el query actual

    function onPick(picked) {
      input.value = picked.displayName;
      dd.style.display = "none";
      onSelect(picked);
    }

    // Mezcla: recientes (con historial) primero; luego usuarios de toda la base
    // que NO estén ya entre los recientes (por uid o por nombre normalizado).
    function merged() {
      const local = filterMatches(input.value, pool);
      const haveUid = {};
      const haveName = {};
      local.forEach(function (p) { if (p.uid) haveUid[p.uid] = 1; haveName[normalize(p.displayName)] = 1; });
      const extra = lastRemote.filter(function (p) {
        if (p.uid && haveUid[p.uid]) return false;
        if (haveName[normalize(p.displayName)]) return false;
        return true;
      });
      return local.concat(extra).slice(0, 8);
    }

    function render() {
      renderDropdown(dd, merged(), input.value, onPick);
      positionDropdown(input, dd);
    }

    // Búsqueda en toda la base (identity.searchUsers), debounced y con token.
    function queryRemote() {
      const Id = window.PuntazoIdentity;
      const val = input.value;
      if (!searchAll || !Id || !Id.searchUsers || normalize(val).length < 2) { lastRemote = []; return; }
      const myUid = me() && me().uid;
      const seq = ++remoteSeq;
      Id.searchUsers(val, { limit: 6, excludeUid: myUid }).then(function (res) {
        if (seq !== remoteSeq) return; // llegó tarde, ya hay otra búsqueda
        lastRemote = res || [];
        render();
      }).catch(function () {});
    }

    function update() {
      render(); // pinta lo local de inmediato
      if (remoteTimer) clearTimeout(remoteTimer);
      remoteTimer = setTimeout(queryRemote, 220); // luego completa con toda la base
    }

    function onFocus() {
      // Warmup el pool si está vacío
      if (!pool.length) {
        prefetchPool().then(function (p) {
          pool = p || [];
          update();
        });
      }
      update();
    }
    function onBlur() {
      // Pequeño delay para que mousedown del item dispare antes que el blur cierre
      setTimeout(function () { dd.style.display = "none"; }, 120);
    }
    function onInput() {
      update();
    }
    function onScroll() { if (dd.style.display !== "none") positionDropdown(input, dd); }
    function onResize() { if (dd.style.display !== "none") positionDropdown(input, dd); }

    input.addEventListener("focus", onFocus);
    input.addEventListener("blur", onBlur);
    input.addEventListener("input", onInput);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return {
      detach: function () {
        input.removeEventListener("focus", onFocus);
        input.removeEventListener("blur", onBlur);
        input.removeEventListener("input", onInput);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onResize);
        if (dd.parentNode) dd.parentNode.removeChild(dd);
      },
    };
  }

  window.PuntazoPlayerAutocomplete = {
    attach: attach,
    prefetchPool: prefetchPool,
    clearPool: clearPool,
    _normalize: normalize,
    _filterMatches: filterMatches,
  };
})();
