/* ══════════════════════════════════════════════════════════════
   PUNTAZO — app-context.js  (2026-09-28, rediseño app shell)
   Contexto global del jugador, guardado en ESTE teléfono (localStorage,
   sirve igual con o sin cuenta):

     · CLUB  → preferido/predeterminado: el último que eligió. No caduca.
               Inicio es por club.
     · CANCHA → solo vale el MISMO DÍA en que la eligió (Isaac, 28-sep): al
               día siguiente Clips/Puntazo vuelven a preguntar. Mientras
               tanto no se pide de nuevo.

   Prioridad: la URL gana y se guarda. ?loc=&can= fija club+cancha (QR de
   cancha, links de clips); ?loc= solo (o ?club=) fija el club.

   API en window.PuntazoContext:
     get()               → { loc, can|null, lado } | null   (can=null si no es de hoy)
     club()              → id del club | null
     set(loc, can, lado) → fija club + cancha (de hoy)
     setClub(loc)        → fija club (si cambia de club, olvida la cancha)
     clear()
     names(ctx?)         → Promise<{ club, cancha }>
     url(dest, ctx?)     → "inicio" | "clips" | "boton" | "recuperar"
                            | "selector" (clubs) | "canchas" (del club)
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoContext) return;

  var KEY = "pz_ctx_v1";

  // fetch con tope de tiempo: una red que se atora no deja la pantalla a medias.
  function fetchT(url, ms) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 8000) : null;
    return fetch(url, { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .finally(function () { if (t) clearTimeout(t); });
  }

  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }

  // Guardado: { loc, can, lado, canTs }. canTs = cuándo eligió la cancha.
  // (Formato viejo { loc, can, lado, ts } se lee igual: ts → canTs.)
  function readStore() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!o || !o.loc) return null;
      return { loc: String(o.loc), can: o.can ? String(o.can) : null, lado: o.lado ? String(o.lado) : "LadoA", canTs: +(o.canTs || o.ts || 0) };
    } catch (e) { return null; }
  }
  function writeStore(s) {
    try { localStorage.setItem(KEY, JSON.stringify({ loc: s.loc, can: s.can || null, lado: s.lado || "LadoA", canTs: s.canTs || 0 })); } catch (e) {}
  }

  // "4" / "cancha4" / "Cancha4" → "Cancha4" (mismo criterio que boton.html).
  function normCan(can) {
    var s = String(can || "").trim();
    if (!s) return "";
    if (/^cancha/i.test(s)) return "Cancha" + s.replace(/^cancha\s*/i, "");
    return /^\d+$/.test(s) ? "Cancha" + s : s;
  }

  var _s = readStore();
  (function fromUrl() {
    try {
      var p = new URLSearchParams(window.location.search);
      var loc = (p.get("loc") || p.get("club") || "").trim();
      if (!loc) return;
      var can = normCan(p.get("can"));
      var lado = (p.get("lado") || "").trim();
      if (can) {
        // El lado solo se hereda si seguimos en la misma cancha.
        if (!lado) lado = (_s && _s.loc === loc && _s.can === can && _s.lado) || "LadoA";
        _s = { loc: loc, can: can, lado: lado, canTs: Date.now() };
      } else if (!_s || _s.loc !== loc) {
        _s = { loc: loc, can: null, lado: "LadoA", canTs: 0 };
      }
      writeStore(_s);
    } catch (e) {}
  })();

  function canValid(s) { return !!(s && s.can && s.canTs && dayKey(s.canTs) === dayKey(Date.now())); }

  function get() {
    if (!_s) return null;
    var ok = canValid(_s);
    return { loc: _s.loc, can: ok ? _s.can : null, lado: ok ? (_s.lado || "LadoA") : "LadoA" };
  }
  function club() { return _s ? _s.loc : null; }
  // Última cancha usada aunque ya no sea de hoy (para marcarla en el selector).
  function lastCan() { return _s && _s.can ? { loc: _s.loc, can: _s.can } : null; }

  function emit() { try { window.dispatchEvent(new CustomEvent("puntazo:context-changed", { detail: get() })); } catch (e) {} }

  function set(loc, can, lado) {
    if (!loc || !can) return;
    _s = { loc: String(loc), can: normCan(can), lado: lado ? String(lado) : "LadoA", canTs: Date.now() };
    writeStore(_s); emit();
  }
  function setClub(loc) {
    if (!loc) return;
    if (!_s || _s.loc !== loc) _s = { loc: String(loc), can: null, lado: "LadoA", canTs: 0 };
    writeStore(_s); emit();
  }
  function clear() {
    _s = null;
    try { localStorage.removeItem(KEY); } catch (e) {}
    emit();
  }

  function canchaLabel(can) {
    var m = String(can || "").match(/(\d+)/);
    return m ? "Cancha " + m[1] : String(can || "");
  }

  async function names(ctx) {
    ctx = ctx || get();
    if (!ctx) return { club: "", cancha: "" };
    var out = { club: ctx.loc.replace(/-/g, " "), cancha: ctx.can ? canchaLabel(ctx.can) : "" };
    try {
      if (window.PuntazoClubs && PuntazoClubs.getCatalog) {
        // Máx. 3 s: si el catálogo tarda, se usa el nombre sacado del id.
        var cat = await Promise.race([PuntazoClubs.getCatalog(), new Promise(function (r) { setTimeout(function () { r({ clubs: [] }); }, 3000); })]);
        var c0 = (cat.clubs || []).find(function (c) { return c.id === ctx.loc; });
        if (c0) {
          out.club = c0.nombre || out.club;
          var c = ctx.can && (c0.canchas || []).find(function (x) { return x.id === ctx.can; });
          if (c && c.nombre && c.nombre !== c.id) out.cancha = c.nombre;
        }
      }
    } catch (e) {}
    return out;
  }

  // Sin cancha de hoy, Clips / Puntazo mandan al selector de cancha a
  // pantalla completa (entrada.html) del club, que al elegir regresa al destino.
  function url(dest, ctx) {
    ctx = ctx || get();
    var e = encodeURIComponent;
    if (dest === "selector") return "/entrada.html";
    if (!ctx) {
      if (dest === "recuperar") return "/recuperar.html";
      if (dest === "boton") return "/entrada.html?modo=boton";
      if (dest === "clips") return "/entrada.html?modo=clips";
      return "/entrada.html";
    }
    var L = "?loc=" + e(ctx.loc);
    var q = ctx.can ? L + "&can=" + e(ctx.can) : null;
    switch (dest) {
      case "inicio":    return "/inicio.html" + L;
      case "clips":     return q ? "/lado.html" + q + "&lado=" + e(ctx.lado || "LadoA") + "&pg=0" : "/entrada.html?modo=clips&loc=" + e(ctx.loc);
      case "boton":     return q ? "/boton.html" + q : "/entrada.html?modo=boton&loc=" + e(ctx.loc);
      case "recuperar": return "/recuperar.html" + (q || L);
      case "canchas":   return "/entrada.html?modo=clips&loc=" + e(ctx.loc);
      default:          return "/inicio.html" + L;
    }
  }

  // ── Clips de todo un club (Inicio): recientes de todas sus canchas ──
  async function fetchClubClips(loc, limit) {
    loc = loc || club();
    if (!loc) return [];
    var cfg = await loadConfig();
    var L = (cfg.locaciones || []).find(function (l) { return l.id === loc; });
    if (!L) return [];
    var jobs = [];
    (L.cancha || []).forEach(function (c) {
      (c.lados || []).forEach(function (ld) { if (ld.json_url) jobs.push({ can: c.id, lado: ld.id }); });
    });
    async function ronda(solo) {
      var ls = await Promise.all(jobs.map(function (j) {
        return fetchClips({ loc: loc, can: j.can, lado: j.lado }, limit, solo)
          .then(function (arr) { return arr.map(function (x) { x.can = j.can; x.lado = j.lado; return x; }); })
          .catch(function () { return []; });
      }));
      return [].concat.apply([], ls);
    }
    var all0 = await ronda(true);
    if (!limit || all0.length < limit) all0 = await ronda(false);
    all0.sort(function (a, b) { return b.date - a.date; });
    return limit ? all0.slice(0, limit) : all0;
  }

  // ── Clips de una cancha (para Inicio y "Más clips de esta cancha") ──
  // Lee el mismo índice que lado.html (videos_recientes + videos_vitrina del
  // lado) y devuelve los más recientes primero: [{ nombre, url, poster, date }].
  function dateFromName(name) {
    var m = String(name || "").match(/_(\d{8})_(\d{2})(\d{2})(\d{2})\.mp4$/);
    if (!m) return null;
    var d8 = m[1], Y = +d8.slice(4, 8), Mo = +d8.slice(2, 4), D = +d8.slice(0, 2);
    if (!(Y > 1900 && Mo >= 1 && Mo <= 12)) { Y = +d8.slice(0, 4); Mo = +d8.slice(4, 6); D = +d8.slice(6, 8); }
    return new Date(Y, Mo - 1, D, +m[2], +m[3], +m[4]);
  }
  function directUrl(url) {
    try { var u = new URL(url); if (u.hostname === "www.dropbox.com") u.hostname = "dl.dropboxusercontent.com"; u.searchParams.delete("raw"); u.searchParams.delete("dl"); return u.toString(); } catch (e) { return url; }
  }
  // Una sola descarga de config_locations.json por página (Inicio pide todas
  // las canchas de un club; antes se bajaba 1 vez por cancha).
  var _cfgP = null;
  function loadConfig() {
    // Se comparte con clubs-catalog.js (una sola descarga por página).
    if (!_cfgP) _cfgP = (window.PuntazoClubs && PuntazoClubs.loadConfig
        ? PuntazoClubs.loadConfig().then(function (c) { if (!c) throw new Error("config"); return c; })
        : fetchT("/data/config_locations.json?cb=" + Date.now()).then(function (r) { return r.json(); }))
      .catch(function (e) { _cfgP = null; throw e; });
    return _cfgP;
  }

  // ¿Esta cancha/club pide contraseña y este teléfono no la tiene vigente?
  // Mismas reglas y llaves que script.js (gate:club:<loc> / gate:<loc>:<can>).
  var _pwP = null;
  async function isLocked(loc, can) {
    try {
      if (!_pwP) _pwP = fetchT("/data/passwords.json?cb=" + Date.now(), 5000).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
      var cfg = await _pwP;
      function vigente(k) { try { var o = JSON.parse(localStorage.getItem(k) || "null"); return !!(o && o.ok && Date.now() < o.exp); } catch (e) { return false; } }
      var club = (cfg.clubs || []).find(function (x) { return x.loc === loc && x.enabled; });
      if (club && !vigente("gate:club:" + loc)) return true;
      var reglas = (cfg.canchas || []).filter(function (x) { return x.loc === loc && x.enabled && (!can || x.can === can); });
      return reglas.some(function (x) { return !vigente("gate:" + loc + ":" + x.can); });
    } catch (e) { return false; } // fail-open, igual que script.js
  }

  // soloRecientes: Inicio no necesita la vitrina de 14 días de cada cancha.
  async function fetchClips(ctx, limit, soloRecientes) {
    ctx = ctx || get();
    if (!ctx) return [];
    var cfg = await loadConfig();
    var L = (cfg.locaciones || []).find(function (l) { return l.id === ctx.loc; });
    var C = L && (L.cancha || []).find(function (c) { return c.id === ctx.can; });
    var lados = (C && C.lados) || [];
    var ld = lados.find(function (l) { return l.id === ctx.lado; }) || lados[0];
    if (!ld || !ld.json_url) return [];
    var urls = soloRecientes ? [ld.json_url] : [ld.json_url, ld.json_url.replace("videos_recientes.json", "videos_vitrina.json")];
    var seen = {}, all = [];
    for (var i = 0; i < urls.length; i++) {
      if (limit && all.length >= limit) break;
      try {
        var r = await fetchT(urls[i] + "?cb=" + Date.now());
        if (!r.ok) continue;
        var data = await r.json();
        (data.videos || []).forEach(function (v) {
          if (!v || !v.nombre || seen[v.nombre]) return;
          var d = dateFromName(v.nombre);
          if (!d) return;
          seen[v.nombre] = 1;
          all.push({ nombre: v.nombre, url: v.url, poster: v.poster_url ? directUrl(v.poster_url) : "", date: d });
        });
      } catch (e) {}
    }
    all.sort(function (a, b) { return b.date - a.date; });
    return limit ? all.slice(0, limit) : all;
  }
  function horaLabel(d) { var h = d.getHours(); return (h % 12 || 12) + ":" + String(d.getMinutes()).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM"); }
  function diaLabel(d) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var x = new Date(d); x.setHours(0, 0, 0, 0);
    var diff = Math.round((t - x) / 864e5);
    if (diff === 0) return "Hoy";
    if (diff === 1) return "Ayer";
    return x.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
  }

  // ── Qué tiene cada club (2026-09-30, Isaac: "no prometer cosas en vano") ──
  // Solo se ofrece lo que el club de verdad tiene, según los DATOS:
  //   verticales     → hay docs en clip_verticals de ese club
  //   vivo           → stream_public/{club} existe y está en vivo o tiene
  //                    transmisiones anteriores que se pueden ver
  //   vivoAhora      → está transmitiendo en este momento
  //   partidoCompleto→ el club recupera el partido completo (WellStreet)
  // Se guarda 10 min en sessionStorage para no repetir consultas al navegar.
  var CAPS_TTL = 10 * 60 * 1000;
  var PARTIDO_COMPLETO = ["WellStreet-Pickleball", "WellStreet-Padel"];
  var _capsP = {};
  function esperarDb(ms) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function mirar() {
        try { if (window.PuntazoFirebase && PuntazoFirebase.db && window.firebase && firebase.apps) return res(PuntazoFirebase.db()); } catch (e) {}
        if (Date.now() - t0 > (ms || 8000)) return res(null);
        setTimeout(mirar, 120);
      })();
    });
  }
  function conTope(p, ms, porDefecto) {
    return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(porDefecto); }, ms); })]);
  }
  function capacidades(loc) {
    loc = loc || club();
    var base = { verticales: false, vivo: false, vivoAhora: false,
      partidoCompleto: PARTIDO_COMPLETO.indexOf(loc) >= 0 };
    if (!loc) return Promise.resolve(base);
    var k = "pz_caps_v1_" + loc;
    try {
      var c = JSON.parse(sessionStorage.getItem(k) || "null");
      if (c && Date.now() - c.ts < CAPS_TTL) return Promise.resolve(Object.assign(base, c.v));
    } catch (e) {}
    if (_capsP[loc]) return _capsP[loc];
    _capsP[loc] = (async function () {
      var db = await esperarDb(8000);
      if (!db) return base;
      var r = await Promise.all([
        conTope(db.collection("clip_verticals").where("club", "==", loc).limit(1).get()
          .then(function (s) { return !s.empty; }).catch(function () { return false; }), 6000, false),
        conTope(db.collection("stream_public").doc(loc).get()
          .then(function (d) { return d.exists ? d.data() : null; }).catch(function () { return null; }), 6000, null)
      ]);
      var st = r[1] || null;
      var anteriores = st && Array.isArray(st.past_streams)
        ? st.past_streams.filter(function (p) { return p && p.url && p.disponible !== false; }).length : 0;
      var enVivo = !!(st && st.live === true && (st.youtube_url || st.youtube_id || st.channel_id));
      var v = { verticales: r[0], vivo: enVivo || anteriores > 0, vivoAhora: enVivo };
      try { sessionStorage.setItem(k, JSON.stringify({ ts: Date.now(), v: v })); } catch (e) {}
      return Object.assign(base, v);
    })();
    return _capsP[loc];
  }

  // Botón "compartir link" de un clip: comparte clip.html?v= (con vista previa
  // en WhatsApp) en vez del archivo; así quien lo recibe llega a Puntazo.
  function linkPill(nombre) {
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "action-pill"; btn.dataset.ico = "link";
    btn.title = "Compartir link"; btn.setAttribute("aria-label", "Compartir link del clip");
    btn.addEventListener("click", async function (e) {
      e.stopPropagation();
      var u = location.origin + "/clip.html?v=" + encodeURIComponent(nombre);
      try { if (window.gtag) gtag("event", "share_link", { video_name: nombre }); } catch (_) {}
      try {
        if (navigator.share) { await navigator.share({ title: "Puntazo", text: "¡Mira este puntazo! 🎾", url: u }); return; }
      } catch (err) { if (err && err.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(u); aviso("Link copiado"); }
      catch (_) { window.prompt("Copia el link:", u); }
    });
    return btn;
  }
  function aviso(txt) {
    var t = document.createElement("div");
    t.className = "pz-vertical-toast"; t.textContent = txt;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  window.PuntazoContext = { get: get, club: club, lastCan: lastCan, set: set, setClub: setClub, clear: clear, names: names, url: url,
    normCan: normCan, canchaLabel: canchaLabel, fetchClips: fetchClips, fetchClubClips: fetchClubClips, isLocked: isLocked, directUrl: directUrl, linkPill: linkPill, capacidades: capacidades, dateFromName: dateFromName, horaLabel: horaLabel, diaLabel: diaLabel };
})();
