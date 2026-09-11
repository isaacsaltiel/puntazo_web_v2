// =============================================================
// metricas.js — Puntazo · Conteo EXACTO de las marcas en el sitio
// =============================================================
// GA4 da números aproximados: redondea y esconde los chicos. Aquí cada vista y
// cada clic suma 1 a un contador en Firestore, por marca, métrica, club y día:
//
//   metricas_marcas/{sujeto}__{metrica}__{club}__{fecha}
//     → { n, sujeto, metrica, club, fecha, updatedAt }
//
// Las reglas solo dejan crear con n = 1 y actualizar sumando exactamente 1
// (el mismo patrón que video_stats), y solo un admin puede leerlos.
//
// sujeto = la marca: el id de la campaña ("loka-2026-09") o "aquawolf".
// slot   = dónde pasó: feed_top, feed_banner, card_inline, clip_page, spotify…
//
//   vista.<slot>                cada impresión vista (50 % del anuncio, 1 s)
//   persona.<slot>              personas distintas que lo vieron ESE día
//   persona_total.<slot>        personas distintas que lo han visto alguna vez
//   click.<slot>[.<destino>]    cada clic (destino = web, instagram…)
//   clicker.<slot|todos>        personas distintas que hicieron clic ESE día
//   clicker_total.<slot|todos>  personas distintas que alguna vez hicieron clic
//
// "Persona" = navegador: se recuerda en localStorage. Si alguien borra los
// datos del sitio o cambia de teléfono, cuenta como persona nueva.
//
// Medir nunca rompe la página: todo falla en silencio.
// La lógica se exporta para Node: tests/metricas.node.test.js.
// =============================================================
(function (global) {
  "use strict";

  var COL = "metricas_marcas";
  var RE_SUJETO = /^[a-z0-9-]{1,40}$/;
  var RE_METRICA = /^(vista|persona|persona_total|click|clicker|clicker_total)\.[a-z_]{2,20}(\.[a-z_]{2,20})?$/;
  var RE_PARTE = /^[a-z_]{2,20}$/;
  var RE_CLUB = /^[A-Za-z0-9-]{1,40}$/;
  // Los días se cuentan en hora de México: UTC−6 todo el año desde 2022.
  var OFFSET_MX_MS = -6 * 3600 * 1000;

  function p2(n) { return (n < 10 ? "0" : "") + n; }

  function fechaMX(ms) {
    var d = new Date(ms + OFFSET_MX_MS);
    return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
  }

  function club(c) { return (typeof c === "string" && RE_CLUB.test(c)) ? c : "sin-club"; }

  function clave(sujeto, metrica, clubId, fecha) {
    return sujeto + "__" + metrica + "__" + clubId + "__" + fecha;
  }

  function valida(sujeto, metrica) {
    return RE_SUJETO.test(sujeto || "") && RE_METRICA.test(metrica || "");
  }

  function parte(s) { return RE_PARTE.test(s || "") ? s : null; }

  // deps: { db(), incremento(), servidor(), ahora(), storage() }. Así se prueba
  // en Node sin navegador ni Firestore.
  function crear(deps) {
    function sumar(sujeto, metrica, clubId) {
      try {
        if (!valida(sujeto, metrica)) return false;
        var db = deps.db();
        if (!db) return false;
        var c = club(clubId), f = fechaMX(deps.ahora());
        db.collection(COL).doc(clave(sujeto, metrica, c, f)).set({
          n: deps.incremento(), sujeto: sujeto, metrica: metrica, club: c, fecha: f,
          updatedAt: deps.servidor(),
        }, { merge: true }).catch(function (e) { console.warn("[metricas]", metrica, e && e.code); });
        return true;
      } catch (e) { return false; }
    }

    // true solo la primera vez que este navegador pasa por la llave. Sin
    // localStorage no cuenta personas: mejor quedarse corto que inflar.
    function primeraVez(llave) {
      try {
        var s = deps.storage();
        if (!s || s.getItem(llave)) return false;
        s.setItem(llave, "1");
        return true;
      } catch (e) { return false; }
    }

    function vista(sujeto, slot, clubId) {
      slot = parte(slot);
      if (!slot || !RE_SUJETO.test(sujeto || "")) return;
      var f = fechaMX(deps.ahora());
      sumar(sujeto, "vista." + slot, clubId);
      if (primeraVez("pzm:v:" + sujeto + ":" + slot + ":" + f)) sumar(sujeto, "persona." + slot, clubId);
      if (primeraVez("pzm:v:" + sujeto + ":" + slot)) sumar(sujeto, "persona_total." + slot, clubId);
    }

    function click(sujeto, slot, destino, clubId) {
      slot = parte(slot);
      if (!slot || !RE_SUJETO.test(sujeto || "")) return;
      var d = parte(destino);
      var f = fechaMX(deps.ahora());
      sumar(sujeto, "click." + slot + (d ? "." + d : ""), clubId);
      // Personas que hicieron clic: en este espacio y en cualquiera de la marca.
      [slot, "todos"].forEach(function (q) {
        if (primeraVez("pzm:c:" + sujeto + ":" + q + ":" + f)) sumar(sujeto, "clicker." + q, clubId);
        if (primeraVez("pzm:c:" + sujeto + ":" + q)) sumar(sujeto, "clicker_total." + q, clubId);
      });
    }

    return { sumar: sumar, vista: vista, click: click };
  }

  // ── Para el panel admin ────────────────────────────────────────

  // Docs de metricas_marcas → totales por métrica, por club y por día.
  function agregar(docs) {
    var out = { total: {}, porClub: {}, porDia: {} };
    (docs || []).forEach(function (d) {
      if (!d || typeof d.n !== "number" || !d.metrica) return;
      var m = d.metrica, c = d.club || "sin-club", f = d.fecha || "?";
      out.total[m] = (out.total[m] || 0) + d.n;
      var pc = out.porClub[c] = out.porClub[c] || {};
      pc[m] = (pc[m] || 0) + d.n;
      var pd = out.porDia[f] = out.porDia[f] || {};
      pd[m] = (pd[m] || 0) + d.n;
    });
    return out;
  }

  // Suma las métricas que empiezan con `prefijo` ("click." = todos los clics).
  function sumaPrefijo(mapa, prefijo) {
    var s = 0;
    Object.keys(mapa || {}).forEach(function (k) { if (k.indexOf(prefijo) === 0) s += mapa[k]; });
    return s;
  }

  // Nombre de clip → { club, fecha } (fecha local), o null. Mismo formato que
  // parseFromName de script.js: <Club>_<Cancha>_<Lado>[_TAG_id]_<DDMMYYYY>_<HHMMSS>.mp4
  var RE_NOMBRE = /^(.+?)_(.+?)_(Lado[A-Z])(?:_[A-Z][A-Z_]*_[A-Za-z0-9]+)?_(\d{2})(\d{2})(\d{4})_(\d{2})(\d{2})(\d{2})\.mp4$/;
  function leerNombre(nombre) {
    var m = RE_NOMBRE.exec(nombre || "");
    if (!m) return null;
    var d = new Date(+m[6], +m[5] - 1, +m[4], +m[7], +m[8], +m[9]);
    if (isNaN(d.getTime()) || d.getDate() !== +m[4]) return null;
    return { club: m[1], fecha: d };
  }

  function fechaLocal(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(iso || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
  }

  // ¿El clip salió cuando la marca iba dentro de los videos de su club?
  // ventanas = { Club: { desde: "YYYY-MM-DDTHH:MM", hasta: null | "…" } }.
  // Devuelve el club, o null si no cae en ninguna ventana.
  function enVentana(nombre, ventanas) {
    var x = leerNombre(nombre);
    if (!x || !ventanas || !ventanas[x.club]) return null;
    var v = ventanas[x.club];
    var d = fechaLocal(v.desde), h = v.hasta ? fechaLocal(v.hasta) : null;
    if (!d || x.fecha < d || (h && x.fecha > h)) return null;
    return x.club;
  }

  var api = {
    COL: COL,
    fechaMX: fechaMX,
    clave: clave,
    valida: valida,
    club: club,
    crear: crear,
    agregar: agregar,
    sumaPrefijo: sumaPrefijo,
    leerNombre: leerNombre,
    enVentana: enVentana,
  };

  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  if (!global) return;

  var inst = crear({
    db: function () {
      try { return (global.PuntazoFirebase && global.PuntazoFirebase.db) ? global.PuntazoFirebase.db() : null; }
      catch (e) { return null; }
    },
    incremento: function () { return global.firebase.firestore.FieldValue.increment(1); },
    servidor: function () { return global.firebase.firestore.FieldValue.serverTimestamp(); },
    ahora: function () { return Date.now(); },
    storage: function () { try { return global.localStorage; } catch (e) { return null; } },
  });
  api.sumar = inst.sumar;
  api.vista = inst.vista;
  api.click = inst.click;
  global.PuntazoMetricas = api;
})(typeof window !== "undefined" ? window : this);
