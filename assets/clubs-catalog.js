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
  const CLUB_DISPLAY = {
    "Interpadel":            { emoji: "🎾", logoUrl: "/assets/logos/interpadel.png", status: "active", nombre: "Interpadel" },
    "BreakPoint":            { emoji: "⚡", logoUrl: "/assets/logos/breakpoint.png", status: "active", nombre: "BreakPoint" },
    "Scorpion":              { emoji: "🦂", status: "active", nombre: "Scorpion" },
    "WellStreet-Pickleball": { emoji: "🏓", logoUrl: "/assets/logos/wellstreet.png", status: "active", nombre: "WellStreet" }
  };

  // ── Mapping de códigos QR físicos → loc id en config ──
  // Estos son los códigos cortos que los stickers físicos van a llevar.
  // Ej: entrada.html?qr=BREAKPOINT
  const QR_CODES = {
    "BREAKPOINT":  { locId: "BreakPoint",            locNombre: "BreakPoint" },
    "INTERPADEL":  { locId: "Interpadel",            locNombre: "Interpadel" },
    "SCORPION":    { locId: "Scorpion",              locNombre: "Scorpion" },
    "WELLSTREET":  { locId: "WellStreet-Pickleball", locNombre: "WellStreet" }
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

  window.PuntazoClubs = {
    getCatalog: getCatalog,
    resolveQrCode: resolveQrCode,
    getClubByLocId: getClubByLocId,
    clearCache: clearCache
  };
})();
