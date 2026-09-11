// =============================================================
// clips-en-vivo.js — Puntazo · El clip aparece solo en lado.html
// =============================================================
// La NUC escribe cada clip en clip_states/{clip_id} en cuanto termina de
// subirlo a Dropbox. Si ese doc ya trae el link (video_url), el clip se puede
// ver YA: no hace falta esperar a que el CI lo meta en videos_recientes.json
// (de 0.5 a 6 min, medido el 10-sep-2026 en BreakPoint). Este módulo escucha
// esos docs y se los pasa a script.js (window.PuntazoLado), que los suma al
// feed. Cuando el índice los trae, se deduplican por nombre de archivo.
//
// Contrato del doc (solo la NUC escribe, con Admin SDK; las reglas lo niegan a
// cualquier navegador):
//   { club, cancha, lado, state: "visible", ts_pulso: "YYYY-MM-DD HH:MM:SS",
//     nombre:     "<Club>_<Cancha>_<Lado>_<DDMMYYYY>_<HHMMSS>.mp4",
//     video_url:  "https://www.dropbox.com/scl/fi/…&raw=1",
//     poster_url: "https://www.dropbox.com/scl/fi/…&raw=1"   (opcional) }
// Un doc sin video_url (las NUCs que aún no publican el link) se ignora: ese
// clip llega por el índice, como siempre.
//
// La lógica se exporta para Node: tests/clips-en-vivo.node.test.js.
// =============================================================
(function (global) {
  "use strict";

  var VENTANA_HORAS = 24;
  // ts_pulso viene en hora local del club, sin zona. Todos los clubes están en
  // México: UTC−6 todo el año desde que se quitó el horario de verano (2022).
  var OFFSET_MX_MS = -6 * 3600 * 1000;
  var HOSTS_DROPBOX = { "www.dropbox.com": true, "dropbox.com": true, "dl.dropboxusercontent.com": true };
  var RE_NOMBRE = /^[A-Za-z0-9_-]+_\d{8}_\d{6}\.mp4$/;

  function p2(n) { return (n < 10 ? "0" : "") + n; }

  // Piso de ts_pulso para la consulta, en hora de México y con el mismo
  // formato que escribe la NUC, para que la comparación de texto funcione.
  function pisoTsPulso(ahoraMs, horas) {
    var d = new Date(ahoraMs - horas * 3600000 + OFFSET_MX_MS);
    return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()) +
      " " + p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()) + ":" + p2(d.getUTCSeconds());
  }

  // Solo links https de Dropbox, y siempre en modo directo (raw=1), que es el
  // que reproduce en <video>. rclone entrega "&dl=0" (la página de vista previa).
  function urlSegura(u) {
    if (typeof u !== "string" || !u) return null;
    var url;
    try { url = new URL(u); } catch (e) { return null; }
    if (url.protocol !== "https:" || !HOSTS_DROPBOX[url.hostname]) return null;
    if (url.hostname !== "dl.dropboxusercontent.com") {
      url.searchParams.delete("dl");
      url.searchParams.set("raw", "1");
    }
    return url.toString();
  }

  // Doc de clip_states → entrada del feed, con la misma forma que el índice
  // JSON. null si no es de este lado, no está listo o trae algo raro.
  function docAEntrada(doc, ctx) {
    if (!doc || !ctx || doc.state !== "visible") return null;
    if (doc.club !== ctx.loc || doc.cancha !== ctx.can || doc.lado !== ctx.lado) return null;
    var nombre = typeof doc.nombre === "string" ? doc.nombre.trim() : "";
    if (!RE_NOMBRE.test(nombre)) return null;
    if (nombre.indexOf(ctx.loc + "_" + ctx.can + "_" + ctx.lado + "_") !== 0) return null;
    var url = urlSegura(doc.video_url);
    if (!url) return null;
    var e = { nombre: nombre, url: url, _vivo: true };
    var poster = urlSegura(doc.poster_url);
    if (poster) e.poster_url = poster;
    return e;
  }

  function entradasDe(docs, ctx) {
    var vistas = {}, out = [];
    (docs || []).forEach(function (d) {
      var e = docAEntrada(d, ctx);
      if (e && !vistas[e.nombre]) { vistas[e.nombre] = true; out.push(e); }
    });
    return out;
  }

  // Une lo que llega de Firestore con el feed de script.js. deps permite
  // probarlo sin navegador: { lado(), doc, gtag() }.
  function crearControlador(ctx, deps) {
    var vivos = {};
    var aviso = null;

    function entradas() {
      return Object.keys(vivos).map(function (k) { return vivos[k]; });
    }

    function medir(nuevas, modo) {
      try {
        var g = deps.gtag && deps.gtag();
        if (typeof g !== "function") return;
        nuevas.forEach(function (e) { g("event", "clip_en_vivo", { video_name: e.nombre, modo: modo }); });
      } catch (e) {}
    }

    function resaltar(nombres) {
      nombres.forEach(function (n) {
        var card = deps.doc.getElementById(n);
        if (!card || !card.classList) return;
        card.classList.add("pz-clip-nuevo");
        var t = setTimeout(function () { card.classList.remove("pz-clip-nuevo"); }, 6000);
        if (t && t.unref) t.unref();
      });
    }

    // Lleva la vista al clip nuevo (script.js elige la tarjeta de más arriba)
    // y lo resalta.
    function mostrar(L, nombres) {
      if (typeof L.mostrarClip === "function") L.mostrarClip(nombres);
      resaltar(nombres);
    }

    function avisar(nuevas) {
      if (!aviso) {
        aviso = deps.doc.createElement("button");
        aviso.type = "button";
        aviso.className = "pz-vivo-aviso";
        aviso._nombres = [];
        aviso.addEventListener("click", function () {
          var nombres = aviso._nombres;
          aviso.remove();
          aviso = null;
          var L = deps.lado();
          if (L) Promise.resolve(L.irAlInicio()).then(function () { mostrar(L, nombres); });
        });
        deps.doc.body.appendChild(aviso);
      }
      aviso._nombres = aviso._nombres.concat(nuevas.map(function (e) { return e.nombre; }));
      var n = aviso._nombres.length;
      aviso.textContent = n === 1 ? "↑ 1 clip nuevo" : "↑ " + n + " clips nuevos";
    }

    // Suma al feed lo que el índice todavía no trae. Si no interrumpe nada
    // (página 1, sin video sonando y sin haber bajado más de una pantalla desde
    // el inicio de los clips) se pinta y la vista va al clip. Si no, sale el
    // aviso y la persona decide cuándo verlo.
    function entregar() {
      var L = deps.lado();
      if (!L || !L.listo()) return "espera";   // script.js las suma al terminar de cargar
      var nuevas = L.sumarClipsEnVivo(entradas());
      if (!nuevas.length) return "nada";
      var nombres = nuevas.map(function (e) { return e.nombre; });
      if (L.enPrimeraPagina() && !L.algoReproduciendo() && !L.lejosDelInicio()) {
        Promise.resolve(L.render()).then(function () { mostrar(L, nombres); });
        medir(nuevas, "directo");
        return "directo";
      }
      avisar(nuevas);
      medir(nuevas, "aviso");
      return "aviso";
    }

    function recibir(docs) {
      var n = 0;
      entradasDe(docs, ctx).forEach(function (e) {
        if (!vivos[e.nombre]) { vivos[e.nombre] = e; n++; }
      });
      return n ? entregar() : "nada";
    }

    // script.js terminó de (re)cargar el feed. Si quedó en la página 1, los
    // clips del aviso ya están pintados arriba y el aviso sobra.
    function alCargar() {
      var L = deps.lado();
      if (aviso && L && L.enPrimeraPagina()) { aviso.remove(); aviso = null; }
      return entregar();
    }

    return { entradas: entradas, recibir: recibir, entregar: entregar, alCargar: alCargar };
  }

  // Conecta el controlador con Firestore y con script.js en una página real.
  function arrancar(win) {
    var ctx;
    try {
      var p = new URLSearchParams(win.location.search);
      ctx = { loc: (p.get("loc") || "").trim(), can: (p.get("can") || "").trim(), lado: (p.get("lado") || "").trim() };
    } catch (e) { return null; }
    if (!ctx.loc || !ctx.can || !ctx.lado) return null;

    var db;
    try { db = win.PuntazoFirebase.db(); } catch (e) { return null; }

    var ctl = crearControlador(ctx, {
      lado: function () { return win.PuntazoLado; },
      doc: win.document,
      gtag: function () { return win.gtag; },
    });
    try {
      // Usa el índice compuesto que ya existe (club, cancha, lado, ts_pulso):
      // lee solo los clips de este lado en las últimas 24 h.
      db.collection("clip_states")
        .where("club", "==", ctx.loc)
        .where("cancha", "==", ctx.can)
        .where("lado", "==", ctx.lado)
        .where("ts_pulso", ">=", pisoTsPulso(Date.now(), VENTANA_HORAS))
        .onSnapshot(function (snap) {
          var docs = [];
          snap.forEach(function (d) { docs.push(d.data() || {}); });
          ctl.recibir(docs);
        }, function (err) {
          console.warn("[clips-en-vivo]", err && (err.code || err.message));
        });
    } catch (e) {
      console.warn("[clips-en-vivo]", e);
      return null;
    }
    // script.js avisa cuando termina de cargar el feed: ahí se entregan los
    // clips que llegaron mientras cargaba (y se quita el aviso si ya sobra).
    win.addEventListener("pz:lado-cargado", function () { ctl.alCargar(); });
    return ctl;
  }

  var api = {
    VENTANA_HORAS: VENTANA_HORAS,
    pisoTsPulso: pisoTsPulso,
    urlSegura: urlSegura,
    docAEntrada: docAEntrada,
    entradasDe: entradasDe,
    crearControlador: crearControlador,
  };

  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  if (!global || !global.document) return;

  var ctl = null;
  global.PuntazoClipsVivo = {
    // populateVideos las suma en cada recarga, para no perder las que el
    // índice todavía no trae.
    entradas: function () { return ctl ? ctl.entradas() : []; },
    arrancar: function () { if (!ctl) ctl = arrancar(global); return ctl; },
  };
  function iniciar() {
    if (/lado\.html$/.test(global.location.pathname)) global.PuntazoClipsVivo.arrancar();
  }
  if (global.document.readyState === "loading") global.document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})(typeof window !== "undefined" ? window : this);
