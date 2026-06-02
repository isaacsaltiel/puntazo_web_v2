/* ══════════════════════════════════════════════════════════════
   PUNTAZO — clubs-catalog.js
   Catálogo de clubs activos y mapping de códigos QR genéricos.
   Consume /data/config_locations.json como fuente de verdad para
   canchas/lados, y declara aquí qué clubs están "activos" y qué
   código corto de QR físico apunta a cada uno.

   API expuesta en window.PuntazoClubs:
     - getCatalog()       → Promise<{ clubs: [...] }>  (lee config_locations.json + filtra)
     - resolveQrCode(code)→ { locId, locNombre } | null
     - getClubByLocId(id) → club object | null  (requiere catálogo cargado)
     - clearCache()       → fuerza recargar config_locations.json
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ── Configuración manual: qué clubs están "activos" hoy ──
  // Si un club aparece en config_locations.json pero NO está aquí, no se
  // mostrará en el selector (todavía no listo para jugadores).
  // status: "active" → seleccionable
  //         "soon"   → se muestra pero deshabilitado ("Próximamente")
  // `deporte` determina el modelo de scoring (pádel/tenis = sets; pickleball =
  // juegos a 11). El club es la fuente de verdad del deporte → al crear un
  // partido se infiere con sportForLoc(loc), no se deja al azar.
  const CLUB_DISPLAY = {
    "Interpadel":            { emoji: "🎾", logoUrl: "/assets/logos/interpadel.png", status: "active", nombre: "Interpadel", deporte: "padel" },
    "BreakPoint":            { emoji: "⚡", logoUrl: "/assets/logos/breakpoint.png", status: "active", nombre: "BreakPoint", deporte: "padel" },
    "Scorpion":              { emoji: "🦂", status: "active", nombre: "Scorpion", deporte: "padel" },
    "WellStreet-Pickleball": { emoji: "🏓", logoUrl: "/assets/logos/wellstreet.png", status: "active", nombre: "WellStreet Pickleball", deporte: "pickleball" },
    "WellStreet-Padel":      { emoji: "🎾", logoUrl: "/assets/logos/wellstreet.png", status: "soon", nombre: "WellStreet Pádel", deporte: "padel" }
  };

  // ── Mapping de códigos QR físicos → loc id en config ──
  // Estos son los códigos cortos que los stickers físicos van a llevar.
  // Ej: entrada.html?qr=BREAKPOINT
  const QR_CODES = {
    "BREAKPOINT":  { locId: "BreakPoint",            locNombre: "BreakPoint" },
    "INTERPADEL":  { locId: "Interpadel",            locNombre: "Interpadel" },
    "SCORPION":    { locId: "Scorpion",              locNombre: "Scorpion" },
    "WELLSTREET":       { locId: "WellStreet-Pickleball", locNombre: "WellStreet Pickleball" },
    "WELLSTREETPADEL":  { locId: "WellStreet-Padel",      locNombre: "WellStreet Pádel" }
  };

  let _configCache = null;
  let _catalogCache = null;

  async function _loadConfig() {
    if (_configCache) return _configCache;
    try {
      const res = await fetch("/data/config_locations.json?cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return null;
      _configCache = await res.json();
      return _configCache;
    } catch (e) {
      console.warn("[clubs-catalog] No se pudo cargar config_locations.json:", e);
      return null;
    }
  }

  async function getCatalog() {
    if (_catalogCache) return _catalogCache;
    const cfg = await _loadConfig();
    const clubs = [];

    if (cfg && Array.isArray(cfg.locaciones)) {
      cfg.locaciones.forEach(L => {
        const display = CLUB_DISPLAY[L.id];
        if (!display) return; // no listado en CLUB_DISPLAY → no se muestra
        clubs.push({
          id: L.id,
          nombre: display.nombre || L.nombre || L.id,
          emoji: display.emoji || "🎾",
          logoUrl: display.logoUrl || null,
          status: display.status || "active",
          canchas: Array.isArray(L.cancha) ? L.cancha.map(c => ({
            id: c.id,
            nombre: c.nombre || c.id,
            lados: Array.isArray(c.lados) ? c.lados.map(ld => ({
              id: ld.id,
              nombre: ld.nombre || ld.id
            })) : []
          })) : []
        });
      });
    }

    // Orden: activos primero, luego "soon"; dentro de cada grupo, alfabético por nombre
    clubs.sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === "active") return -1;
        if (b.status === "active") return 1;
      }
      return a.nombre.localeCompare(b.nombre);
    });

    _catalogCache = { clubs };
    return _catalogCache;
  }

  function resolveQrCode(code) {
    if (!code) return null;
    const key = String(code).trim().toUpperCase();
    return QR_CODES[key] || null;
  }

  async function getClubByLocId(id) {
    const cat = await getCatalog();
    return cat.clubs.find(c => c.id === id) || null;
  }

  function clearCache() {
    _configCache = null;
    _catalogCache = null;
  }

  // sportForLoc: deporte de un club ("padel" | "tenis" | "pickleball").
  // Default "padel" para clubs no declarados (comportamiento histórico).
  function sportForLoc(locId) {
    const d = CLUB_DISPLAY[locId];
    return (d && d.deporte) ? d.deporte : "padel";
  }

  // ── Íconos de cancha por club ──
  // Si existe /assets/court-icons/{locId}/B{n}.png se usa (arte propio del
  // club, ej. canchas de pickleball); si no, cae al global
  // /assets/court-icons/B{n}.png. El número se resuelve por el dígito de la
  // cancha (Cancha4 → 4 → B4), con módulo 8 para >8.
  function courtIconUrls(locId, canchaId) {
    const m = String(canchaId || "").match(/(\d+)/);
    let n = m ? parseInt(m[1], 10) : 1;
    if (!Number.isFinite(n) || n < 1) n = 1;
    const idx = (((n - 1) % 8) + 8) % 8 + 1;
    const globalUrl = "/assets/court-icons/B" + idx + ".png";
    const clubUrl = locId
      ? "/assets/court-icons/" + encodeURIComponent(locId) + "/B" + idx + ".png"
      : globalUrl;
    return { clubUrl: clubUrl, globalUrl: globalUrl };
  }

  // Aplica el ícono a un elemento con fallback club → global.
  //   target "bg"  → element.style.backgroundImage
  //   target "src" → element.src (para <img>)
  function applyCourtIcon(el, locId, canchaId, target) {
    if (!el) return;
    const u = courtIconUrls(locId, canchaId);
    function set(url) {
      if (target === "src") el.src = url;
      else el.style.backgroundImage = "url('" + url + "')";
    }
    const probe = new Image();
    probe.onload = function () { set(u.clubUrl); };
    probe.onerror = function () { set(u.globalUrl); };
    probe.src = u.clubUrl;
  }

  window.PuntazoClubs = {
    getCatalog: getCatalog,
    resolveQrCode: resolveQrCode,
    getClubByLocId: getClubByLocId,
    clearCache: clearCache,
    sportForLoc: sportForLoc,
    courtIconUrls: courtIconUrls,
    applyCourtIcon: applyCourtIcon
  };
})();
