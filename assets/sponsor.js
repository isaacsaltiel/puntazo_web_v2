/* =============================================================
   sponsor.js — Puntazo · Sistema de patrocinios
   -------------------------------------------------------------
   La publicidad es ingreso, así que esto es un servidor de anuncios
   pequeño pero de verdad: campañas con vigencia, segmentación por
   club, prioridad, reparto por peso y medición por espacio.

   FUENTE DE VERDAD: colección Firestore `sponsor_campaigns`
   (se edita en admin.html, sin desplegar). Si Firestore no responde
   —o el visitante trae la red capada— cae a `data/sponsors.json` y
   la página sigue igual.

   REGLA DURA: nunca bloquear. El anuncio se monta en un hueco vacío
   que se llena cuando llega; si nunca llega, no pasa nada. Puntazo ya
   tuvo pantallas en blanco por recursos que tardaban en pintar y esto
   NO va a repetirlo.

   Los tests viven en tests/sponsor.node.test.js y ejercitan la lógica
   pura (vigencia, segmentación, reparto), que es donde está el riesgo
   de cobrarle mal a un patrocinador.
   ============================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;   // node (tests)
  if (root) root.PuntazoSponsor = api;                                       // navegador
})(typeof self !== "undefined" ? self : null, function () {
  "use strict";

  var RUTA_JSON = "/data/sponsors.json";
  var COLECCION = "sponsor_campaigns";
  // clip_page   bloque grande bajo el video, en la pagina de un clip
  // feed_banner banner ancho intercalado en el feed de cancha (lado.html)
  // card_inline pastilla compacta junto a los botones de CADA clip de lado
  // feed_top    bloque grande y detallado, fijo arriba del feed de lado
  var SLOTS = { CLIP: "clip_page", FEED: "feed_banner", INLINE: "card_inline", TOP: "feed_top" };

  // ═══════════════════════════════════════════════════════════
  // LÓGICA PURA — sin DOM, sin red. Todo esto se testea en node.
  // ═══════════════════════════════════════════════════════════

  /** "AAAA-MM-DD" → ms en hora LOCAL. `finDelDia` la lleva a las 23:59:59.999
   *  para que `hasta` sea inclusivo: un contrato que vence el día 30 se ve
   *  completo el día 30. Acepta también un timestamp de Firestore o un Date. */
  function parseFecha(v, finDelDia) {
    if (v == null || v === "") return null;
    if (typeof v === "object") {
      if (typeof v.toDate === "function") return v.toDate().getTime();       // Firestore Timestamp
      if (v instanceof Date) return v.getTime();
      if (typeof v.seconds === "number") return v.seconds * 1000;
      return null;
    }
    if (typeof v === "number") return v;
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      var t = Date.parse(v);
      return isNaN(t) ? null : t;
    }
    var Y = +m[1], Mo = +m[2] - 1, D = +m[3];
    return finDelDia
      ? new Date(Y, Mo, D, 23, 59, 59, 999).getTime()
      : new Date(Y, Mo, D, 0, 0, 0, 0).getTime();
  }

  /** ¿La campaña corre hoy? Interruptor manual + ventana de fechas. */
  function vigente(c, ahoraMs) {
    if (!c || c.activo === false) return false;
    var d = parseFecha(c.desde, false);
    var h = parseFecha(c.hasta, true);
    if (d !== null && ahoraMs < d) return false;
    if (h !== null && ahoraMs > h) return false;
    return true;
  }

  /** Segmentación por club. Lista vacía o ausente = todos los clubes.
   *  Si la campaña segmenta y no sabemos el club, NO se muestra: es
   *  preferible perder una impresión a cobrarle a Loka por un club
   *  que no contrató. */
  function aplicaAClub(c, clubId) {
    var lista = c && c.clubs;
    if (!lista || !lista.length) return true;
    if (!clubId) return false;
    return lista.indexOf(clubId) !== -1;
  }

  function aplicaASlot(c, slot) {
    var lista = c && c.slots;
    if (!lista || !lista.length) return true;
    return lista.indexOf(slot) !== -1;
  }

  /** Campañas que pueden ocupar este espacio, ahora, en este club. */
  function candidatas(campanas, slot, clubId, ahoraMs) {
    return (campanas || []).filter(function (c) {
      return vigente(c, ahoraMs) && aplicaAClub(c, clubId) && aplicaASlot(c, slot);
    });
  }

  /** Gana la prioridad más alta; dentro de ese grupo se reparte por peso.
   *  `aleatorio` se inyecta para poder testear el reparto. */
  function elegir(lista, aleatorio) {
    if (!lista || !lista.length) return null;
    var max = lista.reduce(function (a, c) {
      return Math.max(a, Number(c.prioridad) || 0);
    }, -Infinity);
    var top = lista.filter(function (c) { return (Number(c.prioridad) || 0) === max; });
    if (top.length === 1) return top[0];

    var total = top.reduce(function (a, c) { return a + peso(c); }, 0);
    var r = (typeof aleatorio === "function" ? aleatorio() : Math.random()) * total;
    for (var i = 0; i < top.length; i++) {
      r -= peso(top[i]);
      if (r <= 0) return top[i];
    }
    return top[top.length - 1];
  }
  function peso(c) {
    var p = Number(c && c.peso);
    return (isFinite(p) && p > 0) ? p : 1;
  }

  /** Normaliza lo que venga de Firestore o del JSON a una forma sola. */
  function normalizar(raw, id) {
    if (!raw) return null;
    var c = {
      id: raw.id || id || null,
      sponsorId: raw.sponsorId || raw.sponsor_id || null,
      nombre: raw.nombre || raw.sponsorId || "Patrocinador",
      activo: raw.activo !== false,
      desde: raw.desde != null ? raw.desde : null,
      hasta: raw.hasta != null ? raw.hasta : null,
      prioridad: Number(raw.prioridad) || 0,
      peso: Math.max(0, Number(raw.peso) || 1),
      clubs: Array.isArray(raw.clubs) ? raw.clubs.slice() : [],
      slots: Array.isArray(raw.slots) ? raw.slots.slice() : [],
      creativo: raw.creativo || null,
    };
    if (!c.creativo || !Array.isArray(c.creativo.acciones) || !c.creativo.acciones.length) return null;
    return c;
  }

  /** Llave de cache de una elección. DEBE incluir el club: una misma página
   *  puede pintar tarjetas de clubes distintos (guardados, perfil), y cachear
   *  solo por espacio filtraba el anuncio a clubes que no lo contrataron.
   *  Fue un bug real, cazado en la prueba de integración del 9-sep-2026. */
  function llaveEleccion(slot, clubId) {
    return String(slot) + "|" + (clubId || "");
  }

  /** Elige campaña para (espacio, club) reusando lo ya elegido, para que el
   *  anuncio no cambie a media página. `cache` lo pone quien llama. */
  function elegirConCache(cache, campanas, slot, clubId, ahoraMs, aleatorio) {
    var llave = llaveEleccion(slot, clubId);
    if (Object.prototype.hasOwnProperty.call(cache, llave)) return cache[llave];
    var c = elegir(candidatas(campanas, slot, clubId, ahoraMs), aleatorio);
    // Copia por club: `_club` viaja a la medición y no debe pisarse entre clubes.
    if (c) c = Object.assign({}, c, { _club: clubId || null });
    cache[llave] = c;
    return c;
  }

  /** Le pone reloj a una promesa. Sin esto, una promesa que se CUELGA (ni
   *  resuelve ni rechaza) deja el respaldo sin disparar para siempre.
   *  Pasa de verdad: Firestore se queda colgado en redes malas —el problema
   *  ya documentado con ciertas antenas móviles—. Rechazar por tiempo es lo
   *  que permite caer al JSON. */
  function conReloj(promesa, ms, etiqueta) {
    return new Promise(function (resolve, reject) {
      var listo = false;
      var t = setTimeout(function () {
        if (listo) return;
        listo = true;
        reject(new Error("timeout " + (etiqueta || "")));
      }, ms);
      Promise.resolve(promesa).then(function (v) {
        if (listo) return;
        listo = true; clearTimeout(t); resolve(v);
      }, function (e) {
        if (listo) return;
        listo = true; clearTimeout(t); reject(e);
      });
    });
  }

  /** Prueba las fuentes en orden y se queda con la primera que responda a
   *  tiempo. SIEMPRE termina: si todas fallan o se cuelgan, devuelve lista
   *  vacía con fuente "vacio". Nunca lanza.
   *  `fuentes` = [{nombre, fn}] — inyectables para poder testear los cuelgues. */
  function cargarDeFuentes(fuentes, ms) {
    var i = 0;
    function intenta() {
      if (i >= fuentes.length) return Promise.resolve({ fuente: "vacio", campanas: [] });
      var f = fuentes[i++];
      var p;
      try { p = f.fn(); } catch (e) { return intenta(); }   // throw sincrono = siguiente
      return conReloj(p, ms, f.nombre)
        .then(function (lista) {
          return { fuente: f.nombre, campanas: (lista || []) };
        })
        .catch(function () { return intenta(); });
    }
    return intenta();
  }

  var LOGICA = {
    conReloj: conReloj,
    cargarDeFuentes: cargarDeFuentes,
    parseFecha: parseFecha,
    vigente: vigente,
    aplicaAClub: aplicaAClub,
    aplicaASlot: aplicaASlot,
    candidatas: candidatas,
    elegir: elegir,
    normalizar: normalizar,
    llaveEleccion: llaveEleccion,
    elegirConCache: elegirConCache,
    SLOTS: SLOTS,
  };

  // En node solo interesa la lógica: no hay DOM que construir.
  if (typeof document === "undefined") return LOGICA;

  // ═══════════════════════════════════════════════════════════
  // NAVEGADOR — carga, medición y pintado
  // ═══════════════════════════════════════════════════════════

  var _campanas = null;      // cache en memoria
  var _fuente = null;        // "firestore" | "json" | "vacio" — para diagnostico
  var _cargando = null;      // promesa en vuelo (una sola carga por página)
  var _elegidas = {};        // slot -> campaña, para que no cambie a media página
  var _apagado = null;

  function apagadoPorURL() {
    if (_apagado !== null) return _apagado;
    try { _apagado = new URLSearchParams(location.search).has("nosponsor"); }
    catch (e) { _apagado = false; }
    return _apagado;
  }

  /** Club del contexto, del parámetro o de la URL (?loc= en lado.html). */
  function clubDeContexto(ctx) {
    if (ctx && ctx.club) return ctx.club;
    try {
      var p = new URLSearchParams(location.search);
      return p.get("loc") || null;
    } catch (e) { return null; }
  }

  function desdeFirestore() {
    return new Promise(function (resolve, reject) {
      var db = null;
      try { db = window.PuntazoFirebase && window.PuntazoFirebase.db(); } catch (e) { db = null; }
      if (!db) { reject(new Error("sin firestore")); return; }
      db.collection(COLECCION).get().then(function (snap) {
        var out = [];
        snap.forEach(function (d) {
          var c = normalizar(d.data(), d.id);
          if (c) out.push(c);
        });
        resolve(out);
      }).catch(reject);
    });
  }

  function desdeJSON() {
    return fetch(RUTA_JSON, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        return (j.campanas || []).map(function (c) { return normalizar(c); })
          .filter(Boolean);
      });
  }

  var TIMEOUT_MS = 2500;

  /** Carga las campañas: Firestore primero, JSON de respaldo. La lógica del
   *  reloj y del encadenado vive arriba (cargarDeFuentes), donde los tests
   *  la cubren; aquí solo se le pasan las dos fuentes reales. */
  function cargar() {
    if (_campanas) return Promise.resolve(_campanas);
    if (_cargando) return _cargando;
    _cargando = cargarDeFuentes([
      { nombre: "firestore", fn: desdeFirestore },
      { nombre: "json",      fn: desdeJSON },
    ], TIMEOUT_MS).then(function (r) {
      _fuente = r.fuente;
      _campanas = r.campanas;
      return _campanas;
    });
    return _cargando;
  }

  function track(evento, campana, slot, destino) {
    // Conteo exacto en Firestore (assets/metricas.js). GA4, abajo, queda para
    // análisis: redondea y esconde los números chicos.
    try {
      var M = (typeof window !== "undefined") ? window.PuntazoMetricas : null;
      var sujeto = campana.id || campana.sponsorId;
      if (M && sujeto) {
        if (evento === "sponsor_impression") M.vista(sujeto, slot, campana._club);
        else if (evento === "sponsor_click") M.click(sujeto, slot, destino, campana._club);
      }
    } catch (e) {}
    try {
      if (typeof gtag !== "function") return;
      var p = {
        event_category: "Sponsor",
        event_label: (campana.sponsorId || "?") + ":" + slot + (destino ? ":" + destino : ""),
        sponsor_id: campana.sponsorId || null,
        campaign_id: campana.id || null,
        sponsor_slot: slot,
      };
      if (destino) p.sponsor_target = destino;
      if (campana._club) p.club = campana._club;
      gtag("event", evento, p);
    } catch (e) {}
  }

  // ── construcción del DOM ────────────────────────────────────
  function el(tag, clase) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    return n;
  }

  function pintarColores(nodo, creativo) {
    var c = (creativo && creativo.colores) || {};
    var mapa = {
      "--pz-sp-bg": c.bg, "--pz-sp-bg2": c.bg2, "--pz-sp-borde": c.borde,
      "--pz-sp-acento": c.acento, "--pz-sp-acento-texto": c.acentoTexto,
      "--pz-sp-texto": c.texto,
    };
    Object.keys(mapa).forEach(function (k) {
      if (mapa[k]) nodo.style.setProperty(k, mapa[k]);
    });
  }

  function logoEl(creativo, clase) {
    if (!creativo || !creativo.logo) return null;
    var img = el("img", clase);
    img.src = creativo.logo;
    if (creativo.logo2x) img.srcset = creativo.logo + " 1x, " + creativo.logo2x + " 2x";
    img.alt = "";               // decorativo: el nombre ya va en el texto
    img.setAttribute("aria-hidden", "true");
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 48; img.height = 48;
    return img;
  }

  function enlaceBase(accion, campana, slot, clase) {
    var a = el("a", clase);
    a.href = accion.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer sponsored";     // lo correcto para un enlace pagado
    a.addEventListener("click", function () {
      track("sponsor_click", campana, slot, accion.destino || "web");
    });
    return a;
  }

  function accionEl(accion, campana, slot, corto) {
    var a = enlaceBase(accion, campana, slot,
      "pz-sponsor-btn is-" + (accion.estilo === "ghost" ? "ghost" : "primary"));
    a.textContent = (corto && accion.textoCorto) ? accion.textoCorto : accion.texto;
    return a;
  }

  // Destinos que tienen icono propio en sponsor.css. Cualquier otro se pinta
  // como texto corto, asi un patrocinador nuevo nunca se queda sin boton.
  var ICONO_DESTINO = { instagram: "Instagram", web: "su sitio web" };

  function accionIcono(accion, campana, slot) {
    var a = enlaceBase(accion, campana, slot, "pz-sponsor-chip-ico");
    a.dataset.destino = accion.destino;
    var nombre = campana.nombre + " en " + ICONO_DESTINO[accion.destino];
    a.setAttribute("aria-label", nombre);
    a.title = accion.texto || nombre;
    return a;
  }

  /** Pastilla compacta (slot card_inline): moneda + accion principal + el
   *  resto como iconos. Va en la misma fila que descargar / guardar /
   *  pantalla completa, asi que tiene que caber en un telefono junto a ellos. */
  function construirInline(campana) {
    var cr = campana.creativo;
    var chip = el("div", "pz-sponsor-chip");
    chip.dataset.sponsor = campana.sponsorId || "";
    chip.dataset.campana = campana.id || "";
    chip.dataset.slot = SLOTS.INLINE;
    // Se declara como publicidad aunque la pastilla no tenga espacio para decirlo.
    chip.title = cr.kickerCta || ("Patrocinado por " + campana.nombre);
    chip.setAttribute("role", "group");
    chip.setAttribute("aria-label", chip.title);
    pintarColores(chip, cr);

    var logo = logoEl(cr, "pz-sponsor-chip-coin");
    if (logo) { logo.width = 30; logo.height = 30; chip.appendChild(logo); }

    cr.acciones.forEach(function (a, i) {
      if (i > 0 && ICONO_DESTINO[a.destino]) {
        chip.appendChild(accionIcono(a, campana, SLOTS.INLINE));
      } else {
        var b = enlaceBase(a, campana, SLOTS.INLINE,
          "pz-sponsor-chip-btn" + (i === 0 ? " is-primary" : ""));
        b.textContent = a.textoCorto || a.texto;
        chip.appendChild(b);
      }
    });

    impresionAlVerse(chip, campana, SLOTS.INLINE);
    return chip;
  }

  /** Bloque grande arriba del feed de lado (slot feed_top), el mas completo:
   *  foto del producto, claim, detalle, beneficios y las acciones completas.
   *  Todo sale de la campana; si falta un campo, esa pieza no se pinta (un
   *  patrocinador sin foto se sigue viendo bien). */
  function construirHero(campana) {
    var cr = campana.creativo;
    var box = el("div", "pz-sponsor-hero" + (cr.imagen ? "" : " sin-foto"));
    box.dataset.sponsor = campana.sponsorId || "";
    box.dataset.campana = campana.id || "";
    box.dataset.slot = SLOTS.TOP;
    pintarColores(box, cr);

    // Es publicidad y se declara, como en las fotos patrocinadas de cualquier red.
    var tag = el("span", "pz-sponsor-hero-etiqueta");
    tag.textContent = "Patrocinado";
    box.appendChild(tag);

    if (cr.imagen) {
      var foto = el("img", "pz-sponsor-hero-foto");
      foto.src = cr.imagen;
      foto.alt = cr.imagenAlt || "";
      foto.decoding = "async";
      foto.width = 960; foto.height = 320;   // proporcion real: evita saltos al cargar
      box.appendChild(foto);
    }

    var cuerpo = el("div", "pz-sponsor-hero-cuerpo");
    var cabeza = el("div", "pz-sponsor-hero-cabeza");
    var logo = logoEl(cr, "pz-sponsor-coin is-hero");
    if (logo) cabeza.appendChild(logo);
    var txt = el("div", "pz-sponsor-hero-txt");
    var k = el("span", "pz-sponsor-kicker"); k.textContent = cr.kicker || campana.nombre;
    var c = el("strong", "pz-sponsor-claim"); c.textContent = cr.claim || "";
    txt.appendChild(k); txt.appendChild(c);
    if (cr.detalle) {
      var d = el("span", "pz-sponsor-detalle"); d.textContent = cr.detalle;
      txt.appendChild(d);
    }
    cabeza.appendChild(txt);
    cuerpo.appendChild(cabeza);

    if (Array.isArray(cr.beneficios) && cr.beneficios.length) {
      var lista = el("ul", "pz-sponsor-beneficios");
      cr.beneficios.slice(0, 4).forEach(function (b) {
        var li = el("li"); li.textContent = b; lista.appendChild(li);
      });
      cuerpo.appendChild(lista);
    }

    var acc = el("div", "pz-sponsor-acciones");
    cr.acciones.forEach(function (a) { acc.appendChild(accionEl(a, campana, SLOTS.TOP, false)); });
    cuerpo.appendChild(acc);
    box.appendChild(cuerpo);

    impresionAlVerse(box, campana, SLOTS.TOP);
    return box;
  }

  /** Impresion VISTA, no impresion pintada. Con una pastilla en cada clip del
   *  feed, contar al construir inflaria el numero: una pagina de 20 clips daria
   *  20 impresiones aunque la persona vea 3, y eso es cobrarle mal a quien paga.
   *  Se cuenta cuando al menos la mitad del anuncio lleva 1 segundo seguido en
   *  pantalla (el criterio de visibilidad estandar de la industria para
   *  display), una sola vez por anuncio. Sin IntersectionObserver se cuenta al
   *  construir, como antes. */
  var _obsVista = null;
  var _porVer = (typeof WeakMap === "function") ? new WeakMap() : null;

  function impresionAlVerse(nodo, campana, slot) {
    if (typeof IntersectionObserver !== "function" || !_porVer) {
      track("sponsor_impression", campana, slot);
      return;
    }
    if (!_obsVista) {
      _obsVista = new IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) {
          var d = _porVer.get(e.target);
          if (!d) return;
          if (e.isIntersecting) {
            if (d.t) return;
            d.t = setTimeout(function () {
              if (!_porVer.has(e.target)) return;
              _porVer.delete(e.target);
              _obsVista.unobserve(e.target);
              track("sponsor_impression", d.campana, d.slot);
            }, 1000);
          } else if (d.t) {
            clearTimeout(d.t);
            d.t = null;
          }
        });
      }, { threshold: 0.5 });
    }
    _porVer.set(nodo, { campana: campana, slot: slot, t: null });
    _obsVista.observe(nodo);
  }

  function textoEl(kicker, claim, clase) {
    var d = el("div", clase);
    var k = el("span", "pz-sponsor-kicker"); k.textContent = kicker;
    var c = el("strong", "pz-sponsor-claim"); c.textContent = claim;
    d.appendChild(k); d.appendChild(c);
    return d;
  }

  function construir(campana, slot) {
    if (slot === SLOTS.INLINE) return construirInline(campana);
    if (slot === SLOTS.TOP) return construirHero(campana);
    var cr = campana.creativo;
    var esFeed = slot === SLOTS.FEED;
    var box = el("div", esFeed ? "pz-sponsor-banner" : "pz-sponsor-cta");
    box.dataset.sponsor = campana.sponsorId || "";
    box.dataset.campana = campana.id || "";
    box.dataset.slot = slot;
    pintarColores(box, cr);

    var logo = logoEl(cr, "pz-sponsor-coin" + (esFeed ? " is-big" : ""));

    if (esFeed) {
      if (logo) box.appendChild(logo);
      var tf = textoEl(cr.kicker || campana.nombre, cr.claim || "", "pz-sponsor-banner-txt");
      // Mas detalle en el banner del feed: los beneficios en una linea.
      if (Array.isArray(cr.beneficios) && cr.beneficios.length) {
        var bl = el("span", "pz-sponsor-beneficios-linea");
        bl.textContent = cr.beneficios.slice(0, 3).join(" · ");
        tf.appendChild(bl);
      }
      box.appendChild(tf);
    } else {
      var head = el("div", "pz-sponsor-cta-head");
      if (logo) head.appendChild(logo);
      head.appendChild(textoEl(
        cr.kickerCta || ("Patrocinado por " + campana.nombre),
        cr.claim || "", "pz-sponsor-cta-txt"));
      box.appendChild(head);
    }

    var acc = el("div", "pz-sponsor-acciones");
    cr.acciones.forEach(function (a) { acc.appendChild(accionEl(a, campana, slot, esFeed)); });
    box.appendChild(acc);

    impresionAlVerse(box, campana, slot);
    return box;
  }

  /** Campaña que toca en este espacio y club. La lógica (y su cache) vive
   *  arriba, en la parte pura, para que los tests la cubran. */
  function elegirPara(slot, clubId) {
    return elegirConCache(_elegidas, _campanas, slot, clubId, Date.now());
  }

  // ═══════════════════════════════════════════════════════════
  // API pública del navegador
  // ═══════════════════════════════════════════════════════════

  /** Devuelve YA un contenedor vacío y lo llena cuando las campañas lleguen.
   *  Así el anuncio nunca está en el camino crítico del clip. */
  function crearHueco(slot, ctx) {
    var hueco = el("div", "pz-sponsor-hueco");
    if (apagadoPorURL()) return hueco;
    var club = clubDeContexto(ctx);
    cargar().then(function () {
      var c = elegirPara(slot, club);
      if (!c) return;
      try { hueco.appendChild(construir(c, slot)); }
      catch (e) { console.warn("[pz-sponsor] construir", e); }
    });
    return hueco;
  }

  /** Igual que crearHueco pero para quien ya tiene un contenedor. */
  function montar(slot, contenedor, ctx) {
    if (!contenedor) return null;
    var h = crearHueco(slot, ctx);
    contenedor.appendChild(h);
    return h;
  }

  var _inyectando = false;
  function inyectando() { return _inyectando; }

  function esVisible(e) {
    return !!(e.offsetParent !== null || (e.style && e.style.display !== "none"));
  }

  /** Intercala banners cada `cada` tarjetas VISIBLES del feed.
   *  Cuida dos cosas del feed de lado.html: el filtro por partido oculta
   *  tarjetas con display:none (contarlas amontonaría banners), y quien
   *  llama tiene un MutationObserver sobre el mismo contenedor (el guard
   *  evita el bucle). */
  function inyectarEnFeed(contenedor, opts) {
    opts = opts || {};
    var cada = Math.max(2, Number(opts.cada) || 4);
    var selector = opts.selector || ".video-card";
    if (!contenedor || _inyectando || apagadoPorURL()) return Promise.resolve(0);

    var club = clubDeContexto(opts);
    return cargar().then(function () {
      if (_inyectando) return 0;
      _inyectando = true;
      try {
        // Solo los hijos DIRECTOS del feed son banners de este espacio. Las
        // pastillas de card_inline viven DENTRO de cada tarjeta y tambien son
        // .pz-sponsor-hueco: limpiar con un selector de descendientes las
        // borraba todas (bug real, cazado el 10-sep-2026 con el constructor real).
        var MIOS = ":scope > .pz-sponsor-banner, :scope > .pz-sponsor-hueco";
        var c = elegirPara(SLOTS.FEED, club);
        var tarjetas = Array.prototype.filter.call(
          contenedor.querySelectorAll(":scope > " + selector), esVisible);
        // Con pocos clips el banner competiria con el contenido.
        var anclas = [];
        if (c && tarjetas.length >= cada) {
          for (var i = cada - 1; i < tarjetas.length; i += cada) anclas.push(tarjetas[i]);
        }

        // RECONCILIAR, no borrar y repintar. El observer de lado.html dispara con
        // cualquier cambio del feed, incluidas estas inserciones: repintar cada vez
        // era un ciclo sin fin que hacia parpadear el banner y le impedia llegar al
        // segundo en pantalla que exige la impresion vista. Si ya esta en su lugar,
        // no se toca nada y el ciclo se corta solo.
        Array.prototype.forEach.call(contenedor.querySelectorAll(MIOS), function (n) {
          var enSuLugar = n.classList.contains("pz-sponsor-banner") &&
            anclas.indexOf(n.previousElementSibling) !== -1;
          if (!enSuLugar) n.remove();
        });
        var puestos = 0;
        anclas.forEach(function (t) {
          var sig = t.nextElementSibling;
          if (!(sig && sig.classList.contains("pz-sponsor-banner"))) {
            t.insertAdjacentElement("afterend", construir(c, SLOTS.FEED));
          }
          puestos++;
        });
        return puestos;
      } finally {
        _inyectando = false;
      }
    }).catch(function (e) {
      _inyectando = false;
      console.warn("[pz-sponsor] feed", e);
      return 0;
    });
  }

  function activo() { return !apagadoPorURL(); }

  /** Para pruebas manuales desde la consola del navegador. */
  function _debug() {
    return {
      campanas: _campanas, elegidas: _elegidas,
      fuente: _fuente, apagado: apagadoPorURL(),
    };
  }

  var API = {
    SLOTS: SLOTS,
    activo: activo,
    cargar: cargar,
    crearHueco: crearHueco,
    montar: montar,
    inyectarEnFeed: inyectarEnFeed,
    inyectando: inyectando,
    _debug: _debug,
  };
  for (var k in LOGICA) if (Object.prototype.hasOwnProperty.call(LOGICA, k)) API[k] = LOGICA[k];
  return API;
});
