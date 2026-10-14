/* ══════════════════════════════════════════════════════════════
   PUNTAZO — editor.js  (2026-10-01, editor nuevo de clips)

   Recorta un clip EN EL NAVEGADOR y lo entrega para compartir / guardar.
   - Mediabunny (/assets/lib/mediabunny, MPL-2.0) lee el mp4 por rangos del
     host directo de Dropbox (dl.dropboxusercontent.com, con CORS) y copia
     los cuadros SIN recodificar (Conversion con trim + copy forzado). Solo
     se baja el tramo elegido (~1 MB por segundo del clip de 2560×1440).
   - Sin recodificar, el corte empieza en un cuadro clave (uno cada ~2 s en
     los clips de las NUCs). Por eso el INICIO de la selección se ajusta a los
     cuadros clave reales (se leen del índice del mp4): lo que se ve es lo
     que sale. El final se corta en cualquier cuadro.
   - Selección inicial: los últimos 15 s terminando ~2 s antes del final
     (Isaac: lo bueno del punto pasa en los últimos ~35 s).
   - No pide sesión y NO usa la cola de GitHub Actions (clip_edits).
   - Si el navegador no puede (sin import() dinámico, sin CORS, falla
     Mediabunny): aviso claro + "Descargar el clip completo".
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MB_URL = '/assets/lib/mediabunny/mediabunny.min.js?v=20261001';
  var MIN_SEL = 3;          // s
  var DEF_SEL = 15;         // s
  var DEF_FIN_ANTES = 2;    // s antes del final
  var PASO_TECLA = 0.5;     // s por flecha

  function $(id) { return document.getElementById(id); }
  var $video = $('edVideo'), $stage = $('edStage'), $tl = $('edTl'), $track = $('edTrack');
  var $thumbs = $('edThumbs'), $sel = $('edSel'), $dimL = $('edDimL'), $dimR = $('edDimR'), $ph = $('edPh');
  var $hl = $('edHL'), $hr = $('edHR'), $export = $('edExport'), $sound = $('edSound'), $mute = $('edMute');
  var $loading = $('edLoading'), $loadingTxt = $('edLoadingTxt');

  // ── Parámetros ──
  var qs = new URLSearchParams(location.search);
  var nombre = qs.get('v') || qs.get('videoId') || '';
  if (nombre && !/\.mp4$/i.test(nombre)) nombre += '.mp4';
  var srcParam = qs.get('src') || '';
  var quiereVertical = (qs.get('formato') || '').toLowerCase() === 'vertical';

  // Club_CanchaN_LadoX[_TAG_ID]_AAAAMMDD_hhmmss.mp4 (mismo formato que card.js)
  var meta = (function () {
    var m = String(nombre).match(/^(.+?)_(.+?)_(Lado[A-Z])(?:_[A-Z][A-Z_]*_[A-Za-z0-9]+)?_(\d{8})_(\d{6})\.mp4$/i);
    if (!m) return null;
    return { loc: m[1], can: m[2], lado: m[3] };
  })();
  var fecha = (window.PuntazoContext && PuntazoContext.dateFromName(nombre)) || null;

  // ── Estado ──
  var S = {
    fmt: 'h',
    url: { h: '', v: '' },
    dur: 0, start: 0, end: 0,
    keys: [],               // cuadros clave para ajustar el inicio (s); vacío = selección libre
    snap: false,
    selInicial: false,
    MB: null,               // módulo de Mediabunny
    listoExport: false,
    sinAudio: false,
    token: 0,               // cambia al cambiar de archivo (evita carreras)
    drag: null,             // { modo, ... }
    exportando: null,       // { conv, cancelado }
    archivo: null           // File del último export
  };

  // ── Utilidades ──
  function evento(n, extra) {
    try {
      if (typeof window.gtag === 'function') {
        var p = { video_name: nombre };
        if (extra) for (var k in extra) p[k] = extra[k];
        window.gtag('event', n, p);
      }
    } catch (e) {}
  }
  function fmt(t) {
    t = Math.max(0, t || 0);
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  var _toastT = null;
  function toast(msg, ms) {
    var t = $('edToast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(_toastT);
    _toastT = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }
  function directa(url) {
    try { return window.PuntazoContext ? PuntazoContext.directUrl(url) : url; } catch (e) { return url; }
  }
  function esTactil() { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }
  function conTope(p, ms, porDefecto) {
    return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(porDefecto); }, ms); })]);
  }
  function nombreArchivo() {
    var club = (meta && meta.loc) || 'clip';
    var d = fecha, sello = '';
    if (d) {
      var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      sello = '_' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes());
    }
    return 'Puntazo_' + club.replace(/[^A-Za-z0-9-]/g, '') + sello + (S.fmt === 'v' ? '_vertical' : '') + '_recorte.mp4';
  }

  // ── Cuadros clave ──
  function keyCerca(t) {
    if (!S.keys.length) return t;
    var best = S.keys[0];
    for (var i = 1; i < S.keys.length; i++) if (Math.abs(S.keys[i] - t) < Math.abs(best - t)) best = S.keys[i];
    return best;
  }
  function keyAntes(t) {   // último cuadro clave <= t
    if (!S.keys.length) return t;
    var r = S.keys[0];
    for (var i = 0; i < S.keys.length; i++) { if (S.keys[i] <= t + 1e-3) r = S.keys[i]; else break; }
    return r;
  }
  function keyDespues(t) { // primer cuadro clave > t
    for (var i = 0; i < S.keys.length; i++) if (S.keys[i] > t + 1e-3) return S.keys[i];
    return null;
  }
  // Inicio válido: cuadro clave y deja al menos MIN_SEL antes de `limite`.
  function inicioValido(t, limite) {
    var s = keyCerca(t);
    if (s > limite - MIN_SEL) s = keyAntes(limite - MIN_SEL);
    return clamp(s, 0, Math.max(0, limite - MIN_SEL));
  }

  // ── Selección ──
  function selInicial() {
    var d = S.dur;
    var end = d > DEF_SEL + DEF_FIN_ANTES ? d - DEF_FIN_ANTES : d;
    var start = Math.max(0, end - DEF_SEL);
    S.start = inicioValido(start, end);
    S.end = end;
    S.selInicial = true;
  }
  function ajustarASnaps() {
    // Tras leer los cuadros clave (o cambiar de archivo): acomodar la selección.
    if (!S.dur) return;
    S.end = clamp(S.end, Math.min(MIN_SEL, S.dur), S.dur);
    S.start = inicioValido(clamp(S.start, 0, S.end), S.end);
    if (S.end - S.start < MIN_SEL) S.end = Math.min(S.dur, S.start + MIN_SEL);
    pintar();
  }

  function pintar() {
    if (!S.dur) return;
    var a = S.start / S.dur * 100, b = S.end / S.dur * 100;
    $sel.style.left = a + '%';
    $sel.style.width = (b - a) + '%';
    $dimL.style.width = a + '%';
    $dimR.style.width = (100 - b) + '%';
    $('edDur').textContent = fmt(Math.round(S.end - S.start));
    $('edRange').textContent = fmt(S.start) + ' – ' + fmt(S.end);
    [[$hl, S.start, 0, S.end - MIN_SEL], [$hr, S.end, S.start + MIN_SEL, S.dur]].forEach(function (x) {
      x[0].setAttribute('aria-valuemin', x[2].toFixed(1));
      x[0].setAttribute('aria-valuemax', x[3].toFixed(1));
      x[0].setAttribute('aria-valuenow', x[1].toFixed(1));
      x[0].setAttribute('aria-valuetext', fmt(x[1]));
    });
  }
  function pintarCabezal(t) {
    if (!S.dur) return;
    $ph.style.left = clamp(t / S.dur * 100, 0, 100) + '%';
  }

  // ── Video: reproduce SOLO la selección, en bucle ──
  // Durante el arrastre: no amontonar seeks. Si el video sigue buscando, se
  // guarda el último pedido y se aplica al terminar ('seeked'); con tope de
  // 350 ms por si el navegador no avisa (p. ej. seek al mismo tiempo).
  var pendiente = null, ultimoSeek = 0;
  function aplicarSeek() {
    if (pendiente === null) return;
    var t = pendiente; pendiente = null;
    ultimoSeek = performance.now();
    try { $video.currentTime = t; } catch (e) {}
  }
  function ir(t) {
    pendiente = t;
    if (!$video.seeking || performance.now() - ultimoSeek > 350) aplicarSeek();
  }
  $video.addEventListener('seeked', aplicarSeek);
  function estadoPausa() { $stage.classList.toggle('is-paused', $video.paused); }
  $video.addEventListener('play', estadoPausa);
  $video.addEventListener('pause', estadoPausa);
  $video.addEventListener('ended', function () { if (!S.drag) { $video.currentTime = S.start; reproducir(); } });

  function reproducir() {
    var p = $video.play();
    if (p && p.catch) p.catch(function () { estadoPausa(); });
  }
  (function bucle() {
    if (S.dur && !S.drag) {
      var t = $video.currentTime;
      if (!$video.paused && !$video.seeking && (t >= S.end - 0.04 || t < S.start - 0.3)) {
        try { $video.currentTime = S.start; } catch (e) {}
      }
      pintarCabezal(t);
    }
    requestAnimationFrame(bucle);
  })();

  $('edTap').addEventListener('click', function () {
    if (!S.dur) return;
    if ($video.paused) {
      var t = $video.currentTime;
      if (t < S.start - 0.05 || t >= S.end - 0.05) $video.currentTime = S.start;
      reproducir();
    } else $video.pause();
  });
  $sound.addEventListener('click', function () {
    $video.muted = !$video.muted;
    $sound.setAttribute('aria-pressed', String(!$video.muted));
    $sound.setAttribute('aria-label', $video.muted ? 'Activar sonido' : 'Quitar sonido');
    if (!$video.muted && $video.paused) reproducir();
  });
  $mute.addEventListener('click', function () {
    S.sinAudio = !S.sinAudio;
    $mute.setAttribute('aria-pressed', String(S.sinAudio));
    // La vista previa refleja lo que va a salir.
    if (S.sinAudio) { $video.muted = true; $sound.setAttribute('aria-pressed', 'false'); }
    $sound.disabled = S.sinAudio;
    toast(S.sinAudio ? 'El clip se descargará sin sonido' : 'El clip se descargará con sonido', 1800);
  });

  // ── Barra de miniaturas: arrastrar manijas / mover la ventana ──
  function xAT(clientX) {
    var r = $track.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * S.dur;
  }
  $tl.addEventListener('pointerdown', function (e) {
    if (!S.dur || S.exportando) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var r = $track.getBoundingClientRect();
    var x = e.clientX - r.left;
    var xs = S.start / S.dur * r.width, xe = S.end / S.dur * r.width;
    var dl = Math.abs(x - (xs - 9)), dr = Math.abs(x - (xe + 9));   // centro de cada manija
    var modo = null;
    if (Math.min(dl, dr) <= 22) modo = dl <= dr ? 'l' : 'r';
    else if (x > xs && x < xe) modo = 'm';
    if (!modo) return;
    e.preventDefault();
    try { $tl.setPointerCapture(e.pointerId); } catch (_) {}
    S.drag = { modo: modo, id: e.pointerId, x0: e.clientX, t0: xAT(e.clientX), s0: S.start, e0: S.end, movio: false, tocaba: !$video.paused };
    $video.pause();
    if (modo === 'l') $hl.classList.add('is-drag');
    if (modo === 'r') $hr.classList.add('is-drag');
  });
  $tl.addEventListener('pointermove', function (e) {
    var d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    if (Math.abs(e.clientX - d.x0) > 4) d.movio = true;
    if (!d.movio) return;
    var t = xAT(e.clientX), vista;
    if (d.modo === 'l') {
      S.start = inicioValido(clamp(d.s0 + (t - d.t0), 0, S.end - MIN_SEL), S.end);
      vista = S.start;
    } else if (d.modo === 'r') {
      S.end = clamp(d.e0 + (t - d.t0), S.start + MIN_SEL, S.dur);
      vista = S.end;
    } else {
      var len = d.e0 - d.s0;
      var s = keyCerca(clamp(d.s0 + (t - d.t0), 0, S.dur - len));
      if (s + len > S.dur + 1e-3) s = keyAntes(S.dur - len);
      S.start = Math.max(0, s); S.end = Math.min(S.dur, S.start + len);
      vista = S.start;
    }
    pintar();
    pintarCabezal(vista);
    ir(vista);   // el video muestra ese cuadro
  });
  function soltar(e) {
    var d = S.drag;
    if (!d || (e && e.pointerId !== d.id)) return;
    S.drag = null;
    $hl.classList.remove('is-drag'); $hr.classList.remove('is-drag');
    pendiente = null;
    var desde = S.start;
    if (!d.movio && d.modo === 'm') desde = clamp(xAT(d.x0), S.start, S.end - 0.3);   // toque: brincar ahí
    else if (d.modo === 'r') desde = Math.max(S.start, S.end - 2.5);                  // ver cómo termina
    try { $video.currentTime = desde; } catch (_) {}
    pintarCabezal(desde);
    if (d.tocaba || d.movio) reproducir();
  }
  $tl.addEventListener('pointerup', soltar);
  $tl.addEventListener('pointercancel', soltar);
  $tl.addEventListener('lostpointercapture', soltar);

  // Teclado (role="slider"): ←/→ mueven la manija enfocada 0.5 s
  // (la de inicio salta al cuadro clave anterior/siguiente: el corte solo
  // puede empezar ahí).
  function tecla(e, cual) {
    if (!S.dur || S.exportando) return;
    var dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0);
    if (!dir) return;
    e.preventDefault();
    if (cual === 'l') {
      var obj = S.start + dir * PASO_TECLA, s;
      if (S.keys.length) s = dir > 0 ? (keyDespues(S.start) != null ? keyDespues(S.start) : S.start) : keyAntes(S.start - 1e-2);
      else s = obj;
      if (s <= S.end - MIN_SEL && s >= 0) S.start = s;
      ir(S.start); pintarCabezal(S.start);
    } else {
      S.end = clamp(S.end + dir * PASO_TECLA, S.start + MIN_SEL, S.dur);
      ir(S.end); pintarCabezal(S.end);
    }
    pintar();
  }
  $hl.addEventListener('keydown', function (e) { tecla(e, 'l'); });
  $hr.addEventListener('keydown', function (e) { tecla(e, 'r'); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' || S.exportando) return;
    var tg = e.target && e.target.tagName;
    if (tg === 'BUTTON' || tg === 'INPUT' || tg === 'A' || (e.target && e.target.getAttribute && e.target.getAttribute('role') === 'slider')) return;
    e.preventDefault(); $('edTap').click();
  });

  // ── Cargar un archivo (horizontal o vertical) ──
  function cargarVideo(url) {
    $loading.hidden = false;
    $loadingTxt.textContent = 'Cargando clip…';
    $video.src = url;
    $video.load();
  }
  $video.addEventListener('loadedmetadata', function () {
    if (!isFinite($video.duration) || !$video.duration) return;
    if (!S.dur || !S.listoExport) S.dur = $video.duration;   // Mediabunny da la duración exacta después
    if (!S.selInicial) selInicial(); else ajustarASnaps();
    pintar();
    $tl.classList.remove('is-disabled');
    try { $video.currentTime = S.start; } catch (e) {}
    reproducir();
  });
  $video.addEventListener('canplay', function () { $loading.hidden = true; });

  // El marco del video toma su forma exacta (16:9 o 9:16) dentro del espacio libre.
  var $frame = $('edFrame');
  function medirMarco() {
    var W = $stage.clientWidth, H = $stage.clientHeight;
    var ar = ($video.videoWidth && $video.videoHeight) ? $video.videoWidth / $video.videoHeight : (S.fmt === 'v' ? 9 / 16 : 16 / 9);
    var w = W, h = W / ar;
    if (h > H) { h = H; w = H * ar; }
    $frame.style.width = Math.round(w) + 'px';
    $frame.style.height = Math.round(h) + 'px';
  }
  $video.addEventListener('loadedmetadata', medirMarco);
  window.addEventListener('resize', medirMarco);
  if (window.ResizeObserver) new ResizeObserver(medirMarco).observe($stage);
  $video.addEventListener('error', function () {
    if (!$video.getAttribute('src')) return;
    $loadingTxt.textContent = 'No se pudo cargar el video.';
    fallback('No se pudo cargar este clip aquí. Puedes descargarlo completo.');
  });

  // Mediabunny: se carga una vez; luego se abre el mp4 por rangos.
  var _mbP = null;
  function cargarMB() {
    if (!_mbP) {
      _mbP = (function () {
        if (typeof fetch !== 'function' || typeof ReadableStream === 'undefined' || typeof Uint8Array === 'undefined') {
          return Promise.reject(new Error('sin fetch/streams'));
        }
        // import() dinámico: en navegadores viejos es error de sintaxis, por eso va en Function.
        var imp;
        try { imp = new Function('u', 'return import(u)'); } catch (e) { return Promise.reject(new Error('sin import()')); }
        return imp(MB_URL);
      })();
    }
    return _mbP;
  }
  function abrirInput(MB, url, opts) {
    return new MB.Input({
      formats: MB.ALL_FORMATS,
      source: new MB.UrlSource(directa(url), Object.assign({ parallelism: 4 }, opts || {}))
    });
  }

  async function prepararRecorte(url) {
    var tok = ++S.token;
    S.listoExport = false;
    S.keys = [];
    S.snap = false;
    $export.disabled = true;
    $('edNote').textContent = 'Preparando recorte…';
    var MB, input, vt;
    try {
      MB = S.MB = await cargarMB();
      input = abrirInput(MB, url, { maxCacheSize: 24 * 1024 * 1024 });
      vt = await input.getPrimaryVideoTrack();
      if (!vt) throw new Error('sin pista de video');
      var dur = await input.computeDuration();
      // Cuadros clave (solo metadatos: no baja video).
      var sink = new MB.EncodedPacketSink(vt), keys = [];
      var k = await sink.getFirstKeyPacket({ metadataOnly: true });
      while (k && keys.length < 5000) { keys.push(k.timestamp); k = await sink.getNextKeyPacket(k, { metadataOnly: true }); }
      if (tok !== S.token) return;
      // Cuadros clave cada ≤3 s (clips horizontales de las NUCs: 2 s): la
      // selección se ajusta a ellos y se copia sin recodificar. Más espaciados
      // (verticales: ~12 s): selección libre y corte exacto al exportar.
      var gop = keys.length > 1 ? (keys[keys.length - 1] - keys[0]) / (keys.length - 1) : 0;
      S.snap = gop > 0 && gop <= 3;
      S.keys = S.snap ? keys : [];
      if (dur && isFinite(dur)) S.dur = dur;
      if (!S.selInicial) selInicial();
      ajustarASnaps();
      S.listoExport = true;
      $export.disabled = false;
      $tl.classList.remove('is-disabled');   // ya se puede recortar aunque el video siga cargando
      $('edNote').textContent = S.snap && gop > 0.6 ? 'El inicio se ajusta ±' + Math.max(1, Math.round(gop / 2)) + ' s' : '';
    } catch (err) {
      if (tok !== S.token) return;
      console.warn('[editor] no se pudo preparar el recorte:', err);
      evento('editor_error', { etapa: 'preparar', error: String(err && err.message || err).slice(0, 90) });
      $('edNote').textContent = '';
      fallback('Tu navegador no puede recortar este clip aquí. Puedes descargarlo completo.');
      return;
    }
    miniaturas(MB, vt, tok).catch(function (e) {
      console.warn('[editor] miniaturas:', e);
      $thumbs.classList.remove('is-loading');
    });
  }

  // ── Miniaturas (10–14 cuadros del clip) ──
  // Cada miniatura es un cuadro CLAVE (se decodifica solo, sin los vecinos).
  // Los cuadros clave (~500 KB c/u en 2560×1440) se bajan en paralelo y se
  // decodifican de uno en uno con un solo VideoDecoder (los teléfonos tienen
  // pocos decodificadores por hardware).
  function pintarCelda(dst, src, sw, sh) {
    var cw = dst.width, ch = dst.height;
    var esc = Math.max(cw / sw, ch / sh), dw = sw * esc, dh = sh * esc;   // "cover"
    dst.getContext('2d').drawImage(src, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    dst.classList.add('is-on');
    $thumbs.classList.remove('is-loading');
  }
  async function miniaturas(MB, vt, tok) {
    $thumbs.innerHTML = '';
    $thumbs.classList.add('is-loading');
    var w = $track.clientWidth || 300, h = $track.clientHeight || 56;
    var n = clamp(Math.round(w / 34), 10, 14);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = Math.round(w / n * dpr), ch = Math.round(h * dpr);
    var cvs = [];
    for (var i = 0; i < n; i++) {
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      $thumbs.appendChild(c); cvs.push(c);
    }
    if (typeof VideoDecoder === 'undefined') { $thumbs.classList.remove('is-loading'); return; }
    var ts = [];
    for (var j = 0; j < n; j++) ts.push((j + 0.5) / n * S.dur);
    try {
      await miniaturasDecoder(MB, vt, tok, ts, cvs);
    } catch (e) {
      // Plan B: el CanvasSink de Mediabunny (más lento, pero más tolerante).
      console.warn('[editor] miniaturas con VideoDecoder fallaron, uso CanvasSink:', e);
      if (tok !== S.token || !(await vt.canDecode())) return;
      var sink = new MB.CanvasSink(vt, { height: ch, poolSize: 2 }), k = 0;
      for await (var wc of sink.canvasesAtTimestamps(ts.map(keyAntes))) {
        if (tok !== S.token) return;
        var dst = cvs[k++];
        if (wc && dst && !dst.classList.contains('is-on')) pintarCelda(dst, wc.canvas, wc.canvas.width, wc.canvas.height);
      }
    }
    $thumbs.classList.remove('is-loading');
  }
  async function miniaturasDecoder(MB, vt, tok, ts, cvs) {
    var cfg = await vt.getDecoderConfig();
    if (!cfg) throw new Error('sin config de decodificador');
    var sup = await VideoDecoder.isConfigSupported(cfg);
    if (!sup || !sup.supported) throw new Error('códec no soportado');
    var es = new MB.EncodedPacketSink(vt);
    // Descargas en paralelo (máx. 4 a la vez), en orden.
    var proms = new Array(ts.length), sig = 0, activos = 0;
    function lanzar() {
      while (activos < 4 && sig < ts.length) {
        (function (i) {
          activos++;
          proms[i] = es.getKeyPacket(ts[i]).finally(function () { activos--; lanzar(); });
          proms[i].catch(function () {});
        })(sig++);
      }
    }
    lanzar();
    var destino = null, err = null;
    var dec = new VideoDecoder({
      output: function (f) {
        try { if (destino) pintarCelda(destino, f, f.displayWidth, f.displayHeight); } finally { f.close(); }
      },
      error: function (e) { err = e; }
    });
    dec.configure(Object.assign({}, cfg, { optimizeForLatency: true }));
    try {
      for (var i = 0; i < ts.length; i++) {
        while (!proms[i]) await new Promise(function (r) { setTimeout(r, 30); });
        var pk = await proms[i];
        if (tok !== S.token) return;
        if (!pk) continue;
        destino = cvs[i];
        dec.decode(pk.toEncodedVideoChunk());
        await dec.flush();
        if (err) throw err;
      }
    } finally {
      try { if (dec.state !== 'closed') dec.close(); } catch (_) {}
    }
  }

  // ── Formato horizontal / vertical ──
  var $fmtBtns = Array.prototype.slice.call(document.querySelectorAll('#edFmt [data-fmt]'));
  function marcarFmt() {
    $fmtBtns.forEach(function (b) {
      var on = b.dataset.fmt === S.fmt;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $stage.dataset.formato = S.fmt;
  }
  function cambiarFmt(f) {
    if (f === S.fmt || S.exportando || !S.url[f]) return;
    S.fmt = f;
    marcarFmt();
    medirMarco();
    // Se conserva la selección en segundos (se ajusta si el otro archivo dura distinto).
    cargarVideo(S.url[f]);
    prepararRecorte(S.url[f]);
  }
  $fmtBtns.forEach(function (b) { b.addEventListener('click', function () { cambiarFmt(b.dataset.fmt); }); });

  // ── Exportar ──
  var $sheet = $('edSheet'), $sheetBg = $('edSheetBg');
  function abrirHoja(paso) {
    $sheet.hidden = false; $sheetBg.hidden = false;
    $('edStepWork').hidden = paso !== 'work';
    $('edStepDone').hidden = paso !== 'done';
  }
  function cerrarHoja() { $sheet.hidden = true; $sheetBg.hidden = true; }
  function progreso(p) {
    var pct = Math.round(clamp(p, 0, 1) * 100);
    $('edProgBar').style.transform = 'scaleX(' + (pct / 100) + ')';
    $('edProgN').textContent = pct + '%';
    $('edProg').setAttribute('aria-valuenow', String(pct));
  }

  $export.addEventListener('click', async function () {
    if (!S.listoExport || S.exportando) return;
    var MB = S.MB, t0 = performance.now();
    var ini = S.start, fin = S.end;
    $video.pause();
    S.archivo = null;
    progreso(0);
    $('edSheetT').textContent = 'Preparando tu clip';
    $('edWorkSub').textContent = 'Bajando solo el tramo elegido (' + fmt(Math.round(fin - ini)) + ')…';
    abrirHoja('work');
    var st = S.exportando = { conv: null, cancelado: false, input: null };
    evento('editor_exportar', { formato: S.fmt === 'v' ? 'vertical' : 'horizontal', duracion_s: Math.round(fin - ini), sin_audio: S.sinAudio });
    // Un intento de exportación. `exacto`: el inicio no cae en cuadro clave
    // (archivos con cuadros clave espaciados, p. ej. los verticales: ~12 s);
    // se copia si hay uno a <0.6 s y, si no, se recodifica SOLO el video.
    async function intento(exacto) {
      var input = st.input = abrirInput(MB, S.url[S.fmt], { maxCacheSize: 32 * 1024 * 1024 });
      var output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
      var conv = st.conv = await MB.Conversion.init({
        input: input, output: output,
        trim: { start: ini, end: fin },
        audio: S.sinAudio ? { discard: true } : undefined,
        // Normal: copiar SIN recodificar (forzado; el inicio ya está en un cuadro clave).
        copy: exacto ? { mode: 'preferred', boundaryTolerance: 0.6 } : { mode: 'forced', boundaryPolicy: 'expand' },
        showWarnings: false
      });
      var sinVideo = conv.discardedTracks.some(function (d) { return d.track && d.track.type === 'video' && d.reason !== 'discarded_by_user'; });
      if (!conv.isValid || sinVideo) throw new Error('conversión no válida: ' + conv.discardedTracks.map(function (d) { return d.reason; }).join(','));
      conv.onProgress = function (p) { progreso(p); };
      await conv.execute();
      return output;
    }
    try {
      var exacto = !S.snap, output;
      if (exacto) $('edWorkSub').textContent = 'Ajustando el corte exacto (' + fmt(Math.round(fin - ini)) + ')…';
      try {
        output = await intento(exacto);
      } catch (e1) {
        if (!exacto || st.cancelado || (e1 && /cancel/i.test(e1.name + ' ' + e1.message))) throw e1;
        // Este navegador no puede recodificar: copia desde el cuadro clave anterior.
        console.warn('[editor] corte exacto no disponible, copio desde el cuadro clave:', e1);
        try { if (st.input && st.input.dispose) st.input.dispose(); } catch (_) {}
        progreso(0);
        $('edWorkSub').textContent = 'El inicio se movió al cuadro clave anterior…';
        output = await intento(false);
      }
      if (st.cancelado) return;
      var buf = output.target.buffer;
      if (!buf || !buf.byteLength) throw new Error('archivo vacío');
      S.archivo = new File([buf], nombreArchivo(), { type: 'video/mp4' });
      progreso(1);
      var mb = (buf.byteLength / 1048576).toFixed(1);
      evento('editor_exportado', { segundos_proceso: Math.round((performance.now() - t0) / 100) / 10, mb: +mb });
      // Duración REAL del archivo (por si el inicio se movió al cuadro clave).
      var real = fin - ini;
      try { real = await conTope(new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BufferSource(buf) }).computeDuration(), 2000, real) || real; } catch (_) {}
      mostrarListo(real, mb);
    } catch (err) {
      if (st.cancelado || (err && /cancel/i.test(err.name + ' ' + err.message))) return;
      console.warn('[editor] export falló:', err);
      evento('editor_error', { etapa: 'exportar', error: String(err && err.message || err).slice(0, 90) });
      cerrarHoja();
      fallback('No pudimos recortar este clip en tu teléfono. Puedes descargarlo completo.');
    } finally {
      try { if (st.input && st.input.dispose) st.input.dispose(); } catch (_) {}
      if (S.exportando === st) S.exportando = null;
    }
  });
  $('edWorkCancel').addEventListener('click', function () {
    var st = S.exportando;
    if (st) {
      st.cancelado = true;
      try { if (st.conv) st.conv.cancel(); } catch (_) {}
      S.exportando = null;
    }
    cerrarHoja();
    toast('Descarga cancelada');
  });

  function puedeCompartir(f) {
    try { return !!(f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; }
  }
  function mostrarListo(seg, mb) {
    $('edDoneT').textContent = 'Tu clip está listo';
    $('edDoneS').textContent = fmt(Math.round(seg)) + ' · ' + mb + ' MB' + (S.sinAudio ? ' · sin sonido' : '');
    var share = puedeCompartir(S.archivo);
    $('edShare').hidden = !share;
    // En compu no hay "teléfono": el mismo botón baja el archivo.
    $('edSave').querySelector('span').textContent = esTactil() ? 'Guardar en el teléfono' : 'Descargar archivo';
    $('edSave').classList.toggle('ed-main--alt', share);
    abrirHoja('done');
    try { (share ? $('edShare') : $('edSave')).focus({ preventScroll: true }); } catch (e) {}
  }
  function guardar(f) {
    var u = URL.createObjectURL(f);
    var a = document.createElement('a');
    a.href = u; a.download = f.name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000);
  }
  // Compartir necesita un toque nuevo (la activación del primer toque ya caducó).
  $('edShare').addEventListener('click', async function () {
    var f = S.archivo; if (!f) return;
    try {
      await navigator.share({ files: [f], title: 'Puntazo', text: '¡Mira este puntazo!' });
      evento('editor_compartir', { via: 'share' });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      guardar(f);
      evento('editor_compartir', { via: 'descarga_fallback' });
    }
  });
  $('edSave').addEventListener('click', function () {
    var f = S.archivo; if (!f) return;
    guardar(f);
    evento('editor_compartir', { via: 'guardar' });
    toast(esTactil() ? 'Guardando… búscalo en Descargas o en Fotos' : 'Video descargado');
  });
  $('edBack').addEventListener('click', function () { cerrarHoja(); reproducir(); });
  $sheetBg.addEventListener('click', function () { if (!S.exportando) { cerrarHoja(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$sheet.hidden && !S.exportando) cerrarHoja(); });

  // ── Sin soporte: descargar el clip completo ──
  function fallback(msg) {
    $('edFallbackTxt').textContent = msg;
    $('edFallback').hidden = false;
    $export.hidden = true;
    $('ed').classList.add('is-fallback');
  }
  $('edFull').addEventListener('click', function () {
    var url = S.url[S.fmt] || S.url.h || srcParam;
    if (!url) return;
    var nom = String(nombre || 'puntazo.mp4').replace(/\.mp4$/i, '') + (S.fmt === 'v' ? '_vertical' : '') + '.mp4';
    evento('editor_descarga_completa', { formato: S.fmt });
    if (window.PuntazoVertical && PuntazoVertical.descargarArchivo) {
      PuntazoVertical.descargarArchivo({ url: url, nombreArchivo: nom, titulo: 'Descargando clip', video: $video, nombre: nombre, modo: 'editor' });
    } else {
      location.href = url;
    }
  });

  // ── Cancelar ──
  $('edCancel').addEventListener('click', function () {
    var mismoSitio = false;
    try { mismoSitio = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
    if (mismoSitio && history.length > 1) history.back();
    else location.href = nombre ? '/clip.html?v=' + encodeURIComponent(nombre) : '/inicio.html';
  });

  // ── Encontrar el clip ──
  async function resolverUrl() {
    if (srcParam) return srcParam;
    try {
      var r = await fetch('/data/videos_index.json?cb=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        var idx = await r.json();
        var hit = idx && idx.videos && idx.videos[nombre];
        if (hit && hit.url) return hit.url;
      }
    } catch (e) {}
    // Respaldo (igual que clip.html): el índice de su cancha.
    if (meta && window.PuntazoContext) {
      try {
        var lista = await PuntazoContext.fetchClips({ loc: meta.loc, can: meta.can, lado: meta.lado });
        var h = lista.find(function (x) { return x.nombre === nombre; });
        if (h && h.url) return h.url;
      } catch (e) {}
    }
    return '';
  }
  async function subtitulo() {
    var C = window.PuntazoContext, partes = [];
    try {
      if (C && meta) {
        var n = await C.names({ loc: meta.loc, can: meta.can });
        if (n.club) partes.push(n.club);
        if (n.cancha) partes.push(n.cancha);
      }
      if (C && fecha) {
        // En teléfono no cabe todo: la hora identifica el clip; el día solo si no es hoy (y en compu).
        var dia = C.diaLabel(fecha);
        partes.push((dia === 'Hoy' || innerWidth < 420 ? '' : dia + ' ') + C.horaLabel(fecha));
      }
    } catch (e) {}
    $('edSub').textContent = partes.join(' · ');
  }
  function buscarVertical() {
    if (!window.PuntazoVertical || !PuntazoVertical.buscar) return Promise.resolve(null);
    return conTope(PuntazoVertical.buscar(nombre).catch(function () { return null; }), 7000, null);
  }

  async function iniciar() {
    evento('editor_abrir');
    if (!nombre) {
      $loadingTxt.textContent = 'No encontramos el clip.';
      $tl.classList.add('is-disabled');
      return;
    }
    $tl.classList.add('is-disabled');
    subtitulo();
    medirMarco();
    // Igual que clip.html: si el jugador no tiene cancha elegida, la del clip se vuelve su contexto.
    try { if (meta && window.PuntazoContext && !PuntazoContext.get()) PuntazoContext.set(meta.loc, meta.can, meta.lado); } catch (e) {}
    var pVert = buscarVertical();
    var url = await resolverUrl();
    S.url.h = url;
    if (quiereVertical || !url) {
      var doc = await pVert;
      if (doc && doc.url) { S.url.v = doc.url; S.fmt = 'v'; }
    }
    var inicial = S.url[S.fmt];
    if (!inicial) {
      $loadingTxt.textContent = 'Este clip ya no está disponible.';
      $('edFallbackTxt').textContent = 'Los clips se guardan solo unos días.';
      evento('editor_error', { etapa: 'no_encontrado' });
      return;
    }
    marcarFmt();
    cargarVideo(inicial);
    prepararRecorte(inicial);
    // ¿Tiene vertical? (habilita la ficha)
    pVert.then(function (doc) {
      if (doc && doc.url) {
        S.url.v = doc.url;
        var b = document.querySelector('#edFmt [data-fmt="v"]');
        b.disabled = false; b.removeAttribute('title');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
