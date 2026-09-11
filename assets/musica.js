// =============================================================
// musica.js — Puntazo · Botón de Spotify en cada clip con música
// =============================================================
// Desde el 10-sep-2026 las NUCs le ponen de fondo a cada clip una canción de
// AquaWolf, con el letrero "ahora suena" dentro del video. Este botón, en medio
// de la fila de acciones del clip, lleva a su perfil de Spotify.
//
// Solo sale en clips que SÍ llevan música:
//   - de un club que ya la tiene en producción,
//   - grabados después de que arrancó ahí,
//   - y que no sean partido completo (ninguna canción alcanza; van sin música).
//
// La lógica se exporta para Node: tests/musica.node.test.js.
// =============================================================
(function (global) {
  "use strict";

  var MUSICA = {
    artista: "AquaWolf",
    url: "https://open.spotify.com/artist/4GTPeoDoqIDrJ6GQZZKy4u",
    // Club (ID de config_locations) → desde cuándo sus clips llevan música, en
    // hora local del club. Para sumar un club, agrega su línea el día que su NUC
    // la tenga en producción. Ya están los tres.
    desde: {
      "BreakPoint": "2026-09-10T12:53:00",
      "WellStreet-Padel": "2026-09-10T20:12:00",
      "WellStreet-Pickleball": "2026-09-10T20:12:00",
      // En Interpadel las cámaras graban sonido de cancha: ahí la canción va
      // encima y el audio de la cancha debajo (ver Paso 5-C del tutorial).
      "Interpadel": "2026-09-11T15:01:00",
    },
  };

  // "YYYY-MM-DDTHH:MM[:SS]" → Date en hora local, igual que parseFromName arma
  // la fecha del clip a partir de su nombre.
  function fechaLocal(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(iso || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
  }

  // meta = lo que devuelve parseFromName(nombre): { loc, date, tag, ... }.
  function llevaMusica(meta, cfg) {
    cfg = cfg || MUSICA;
    if (!meta || !meta.loc || !(meta.date instanceof Date) || isNaN(meta.date.getTime())) return false;
    if (meta.tag === "PARTIDO") return false;
    var desde = fechaLocal(cfg.desde[meta.loc]);
    return !!desde && meta.date.getTime() >= desde.getTime();
  }

  // El botón, o null si el clip no lleva música. opts: { nombre, doc }.
  function crearBoton(meta, opts) {
    opts = opts || {};
    if (!llevaMusica(meta)) return null;
    var doc = opts.doc || global.document;
    var a = doc.createElement("a");
    a.className = "pz-musica";
    a.href = MUSICA.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = "Escucha a " + MUSICA.artista + " en Spotify";
    a.setAttribute("aria-label", a.title);
    var ico = doc.createElement("span");
    ico.className = "pz-musica-ico";
    ico.setAttribute("aria-hidden", "true");
    var txt = doc.createElement("span");
    txt.className = "pz-musica-txt";
    txt.textContent = MUSICA.artista;
    a.appendChild(ico);
    a.appendChild(txt);
    a.addEventListener("click", function () {
      // Conteo exacto en Firestore (assets/metricas.js), además de GA4.
      try { if (global.PuntazoMetricas) global.PuntazoMetricas.click("aquawolf", "spotify", null, meta.loc); } catch (e) {}
      try {
        if (typeof global.gtag === "function") {
          global.gtag("event", "spotify_click", { video_name: opts.nombre || "", club: meta.loc, artista: MUSICA.artista });
        }
      } catch (e) {}
    });
    return a;
  }

  var api = { MUSICA: MUSICA, llevaMusica: llevaMusica, crearBoton: crearBoton, _fechaLocal: fechaLocal };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  global.PuntazoMusica = api;
})(typeof window !== "undefined" ? window : this);
