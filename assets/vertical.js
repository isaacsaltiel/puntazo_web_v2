/* ═══════════════════════════════════════════════════════════
   Verticales (9:16) de cada clip.

   La NUC del club genera, en su tiempo libre, una versión vertical de cada
   clip con una cámara que sigue la pelota (vision/vertical en la central) y
   la registra en Firestore `clip_verticals/<nombre sin .mp4>` con su `url`.
   Este módulo:
   - junta las consultas de todas las tarjetas visibles y las hace en lotes de
     30 (una lectura por lote, no una por clip);
   - (2026-09-30) DESCARGA UNIFICADA: `menuDescarga(entry, opts)` pregunta
     "Horizontal / Vertical" solo si el clip tiene vertical; si no, descarga
     el horizontal directo. El vertical se baja con una tarjeta flotante de
     progreso (con Cancelar) y luego abre "compartir" del teléfono (TikTok,
     Reels, WhatsApp) o lo guarda.
   - `crearPill` (botón redondo "Vertical") se conserva mientras las páginas
     migran a menuDescarga.
   Si la consulta falla (sin red, reglas), se comporta como "no hay vertical".

   API (window.PuntazoVertical):
     buscar(nombre)            → Promise<doc|null>
     tieneVertical(nombre)     → Promise<boolean>
     urlFeed(entry)            → "/feed.html?loc=..&can=..&v=<nombre.mp4>"
     menuDescarga(entry, opts) → Promise<"horizontal"|"vertical"|null>
         entry: { nombre, loc, can, lado }
         opts:  { descargarHorizontal: function(){...} | null, video?: HTMLVideoElement }
     descargarArchivo(o)       → descarga con tarjeta de progreso y comparte/guarda
         o: { url, nombreArchivo, titulo?, video?, nombre?, modo? }
     registrar(doc)            → siembra la caché con un doc ya leído (feed.html)
     crearPill(entry, opts)    → botón redondo (legado)
   ═══════════════════════════════════════════════════════════ */
window.PuntazoVertical = (function () {
  const COLECCION = 'clip_verticals';
  const cache = new Map();      // id -> doc | null
  let pendientes = new Map();   // id -> [resolve]
  let timer = null;

  function db() {
    try {
      if (window.PuntazoFirebase && typeof window.PuntazoFirebase.db === 'function') return window.PuntazoFirebase.db();
      if (window.firebase && firebase.apps && firebase.apps.length && typeof firebase.firestore === 'function') return firebase.firestore();
    } catch (e) {}
    return null;
  }
  function idDe(nombre) { return String(nombre || '').replace(/\.mp4$/i, ''); }

  function consultar() {
    timer = null;
    const esperas = pendientes;
    pendientes = new Map();
    const ids = Array.from(esperas.keys());
    const responder = (id, v) => (esperas.get(id) || []).forEach(r => r(v));
    const d = db();
    if (!d || !window.firebase || !firebase.firestore || !firebase.firestore.FieldPath) {
      ids.forEach(id => responder(id, null));
      return;
    }
    for (let i = 0; i < ids.length; i += 30) {
      const lote = ids.slice(i, i + 30);
      // (2026-09-30) source 'server': sin red, Firestore respondía VACÍO desde
      // caché y cada clip quedaba marcado "sin vertical" toda la visita.
      d.collection(COLECCION).where(firebase.firestore.FieldPath.documentId(), 'in', lote).get({ source: 'server' })
        .then(snap => {
          const hay = new Map();
          snap.forEach(doc => hay.set(doc.id, doc.data()));
          lote.forEach(id => { const v = hay.get(id) || null; cache.set(id, v); responder(id, v); });
        })
        // Error (p. ej. reglas sin publicar o sin red): no se cachea, se reintenta en la próxima carga.
        .catch(() => lote.forEach(id => responder(id, null)));
    }
  }

  /** Promesa con el documento del vertical de ese clip (o null si todavía no existe). */
  function buscar(nombre) {
    const id = idDe(nombre);
    if (!id) return Promise.resolve(null);
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    return new Promise(res => {
      if (!pendientes.has(id)) pendientes.set(id, []);
      pendientes.get(id).push(res);
      if (!timer) timer = setTimeout(consultar, 60);
    });
  }

  // (2026-09-30) Una página que ya leyó los docs (feed.html) los deja aquí y
  // menuDescarga no vuelve a consultar Firestore.
  function registrar(doc) {
    if (!doc) return;
    const id = idDe(doc.nombre || doc.id);
    if (id && doc.url) cache.set(id, doc);
  }

  function tieneVertical(nombre) {
    return buscar(nombre).then(d => !!(d && d.url)).catch(() => false);
  }

  // (2026-09-30) Link al feed de verticales empezando en ese clip.
  function urlFeed(entry) {
    entry = entry || {};
    const e = encodeURIComponent;
    const n0 = String(entry.nombre || '');
    const nombre = n0 && !/\.mp4$/i.test(n0) ? n0 + '.mp4' : n0;
    const loc = entry.loc || entry.club || '';
    const can = entry.can || entry.cancha || '';
    const q = [];
    if (loc) q.push('loc=' + e(loc));
    if (can) q.push('can=' + e(can));
    if (nombre) q.push('v=' + e(nombre));
    return '/feed.html' + (q.length ? '?' + q.join('&') : '');
  }

  // Dropbox: bajar directo del host servible (evita el salto de dominio que rompe CORS).
  function urlDirecta(url) {
    try {
      const u = new URL(url, location.href);
      if (u.hostname === 'www.dropbox.com') u.hostname = 'dl.dropboxusercontent.com';
      u.searchParams.delete('raw'); u.searchParams.delete('dl');
      return u.toString();
    } catch (e) { return url; }
  }
  function urlForzarDescarga(url) {
    try {
      const u = new URL(url, location.href);
      if (u.hostname === 'dl.dropboxusercontent.com') u.hostname = 'www.dropbox.com';
      u.searchParams.delete('raw'); u.searchParams.set('dl', '1');
      return u.toString();
    } catch (e) { return url; }
  }

  async function bajar(url, onProgreso, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = parseInt(res.headers.get('Content-Length') || '0', 10);
    const lector = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!lector) {
      const b = await res.blob();
      onProgreso(100);
      return new Blob([b], { type: 'video/mp4' });
    }
    const partes = []; let recibido = 0;
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      partes.push(value); recibido += value.byteLength || 0;
      onProgreso(total ? Math.min(100, Math.round(recibido / total * 100)) : null);
    }
    return new Blob(partes, { type: 'video/mp4' });
  }

  // El ícono va aquí y no solo en estilo.css: GitHub Pages deja el CSS en caché
  // hasta 4 h, y con un CSS viejo el botón se vería como un cuadro sólido.
  const ICONO = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='6.5' y='2.5' width='11' height='19' rx='2.6'/%3E%3Cpath d='M10.6 9.2v5.6l4.4-2.8z' fill='%23000' stroke-width='1.6'/%3E%3C/svg%3E")`;

  function evento(nombre, params) {
    try { if (typeof window.gtag === 'function') window.gtag('event', nombre, params || {}); } catch (e) {}
  }
  function aviso(msg) {
    try {
      const t = document.createElement('div');
      t.className = 'pz-vertical-toast';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    } catch (e) {}
  }

  // ── Compartir / guardar un archivo ya descargado (común a todo el módulo) ──
  function puedeCompartir(f) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; }
  }
  async function compartirArchivo(f) {
    if (!puedeCompartir(f)) return false;
    await navigator.share({ files: [f], title: 'Puntazo', text: '¡Mira este puntazo! 🎾' });
    return true;
  }
  function guardarArchivo(f, nombreArchivo, msg) {
    const u = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = u; a.download = nombreArchivo;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 800);
    aviso(msg || 'Video descargado');
  }
  function forzarDescarga(url, nombreArchivo) {
    try {
      const a = document.createElement('a');
      a.href = urlForzarDescarga(url); a.download = nombreArchivo;
      document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
    } catch (e) {}
  }
  // En teléfono se prefiere "compartir" (TikTok, Reels, WhatsApp, Guardar video);
  // en compu, bajar el archivo.
  function esTactil() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
  }

  /**
   * Botón redondo "Vertical" (legado). Nace oculto; se muestra cuando el clip tiene su vertical.
   * opts.video: el <video> de la tarjeta (se pausa al bajar).
   */
  function crearPill(entry, opts) {
    opts = opts || {};
    const TITULO = 'Descargar en vertical (TikTok / Reels)';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action-pill pill-vertical';
    btn.dataset.ico = 'vertical';
    btn.style.setProperty('--ico', ICONO);
    btn.title = TITULO; btn.setAttribute('aria-label', TITULO);
    btn.style.display = 'none';

    const nombreArchivo = idDe(entry.nombre) + '_vertical.mp4';
    let doc = null, estado = 'libre', ctrl = null, archivo = null;

    buscar(entry.nombre).then(d => { if (d && d.url) { doc = d; btn.style.display = ''; } });

    const ponerLibre = () => {
      estado = 'libre'; ctrl = null; archivo = null;
      btn.classList.remove('is-progress', 'is-indet', 'is-ready');
      btn.style.removeProperty('--p');
      btn.innerHTML = ''; btn.dataset.ico = 'vertical'; btn.style.setProperty('--ico', ICONO); btn.title = TITULO;
    };
    const guardar = (f) => guardarArchivo(f, nombreArchivo, 'Video vertical descargado');

    btn.addEventListener('click', async () => {
      if (!doc) return;
      if (estado === 'listo' && archivo) {
        let ok = false;
        try { ok = await compartirArchivo(archivo); } catch (e) {}
        if (!ok) guardar(archivo);
        ponerLibre();
        return;
      }
      if (estado === 'bajando') { try { ctrl && ctrl.abort(); } catch (e) {} return; }

      evento('click_vertical_download', { video_name: entry.nombre });
      if (window.PZ && PZ.trackDownload) {
        PZ.trackDownload(entry.nombre, { club: entry.loc || entry.club || null, cancha: entry.can || entry.cancha || null, lado: entry.lado || null, mode: 'vertical' });
      }
      if (opts.video) { try { opts.video.pause(); } catch (e) {} }

      estado = 'bajando';
      btn.classList.add('is-progress'); btn.title = 'Toca para cancelar';
      btn.innerHTML = '';
      const relleno = document.createElement('span'); relleno.className = 'pill-fill';
      const etiqueta = document.createElement('span'); etiqueta.className = 'pill-label'; etiqueta.textContent = '0%';
      btn.appendChild(relleno); btn.appendChild(etiqueta);
      ctrl = new AbortController();
      try {
        const blob = await bajar(urlDirecta(doc.url), (p) => {
          btn.classList.toggle('is-indet', p === null);
          if (p === null) { relleno.classList.add('is-indeterminate'); etiqueta.textContent = ''; return; }
          relleno.classList.remove('is-indeterminate');
          relleno.style.transform = 'scaleX(' + (p / 100) + ')';
          etiqueta.textContent = p + '%';
          btn.style.setProperty('--p', String(p));
        }, ctrl.signal);
        const f = new File([blob], nombreArchivo, { type: 'video/mp4' });
        let ok = false;
        try { ok = await compartirArchivo(f); } catch (e) { ok = false; }
        if (ok) { evento('share_success', { video_name: entry.nombre, mode: 'vertical' }); ponerLibre(); return; }
        if (navigator.canShare) {
          // iOS: el share tiene que salir de un toque del usuario; queda listo para el segundo.
          archivo = f; estado = 'listo';
          btn.classList.remove('is-progress', 'is-indet'); btn.innerHTML = '';
          btn.style.removeProperty('--ico');   // ícono de "compartir" del CSS
          btn.dataset.ico = 'share'; btn.classList.add('is-ready'); btn.title = 'Toca para compartir';
        } else {
          guardar(f); ponerLibre();
        }
      } catch (err) {
        if (err && err.name === 'AbortError') { ponerLibre(); aviso('Descarga cancelada'); return; }
        forzarDescarga(doc.url, nombreArchivo);
        ponerLibre();
        aviso('No se pudo compartir, se intentó descargar');
      }
    });
    return btn;
  }

  /* ─────────────────────────────────────────────────────────
     (2026-09-30) Estilos del selector y de la tarjeta de progreso.
     Van inyectados desde aquí para que funcionen en cualquier página que
     cargue este módulo, sin depender de estilo.css ni de app-shell.css.
     ───────────────────────────────────────────────────────── */
  function estilos() {
    if (document.getElementById('pzv-estilos')) return;
    const css = `
.pzv-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(0,0,0,.62);opacity:0;transition:opacity .2s;-webkit-tap-highlight-color:transparent;}
.pzv-overlay.is-open{opacity:1;}
.pzv-sheet{position:relative;width:100%;max-width:520px;box-sizing:border-box;
  background:rgba(10,17,34,.98);color:#eaf2ff;font-family:'Montserrat',system-ui,sans-serif;
  border-top:1px solid rgba(255,255,255,.12);border-radius:22px 22px 0 0;
  padding:8px 18px calc(18px + env(safe-area-inset-bottom,0px));
  box-shadow:0 -20px 50px rgba(0,0,0,.5);transform:translateY(105%);transition:transform .26s cubic-bezier(.2,.8,.2,1);}
.pzv-overlay.is-open .pzv-sheet{transform:translateY(0);}
.pzv-grip{width:42px;height:5px;border-radius:5px;background:rgba(255,255,255,.22);margin:4px auto 14px;}
.pzv-title{font-size:1.1rem;font-weight:900;margin:0 0 14px;line-height:1.2;}
.pzv-opt{display:flex;align-items:center;gap:14px;width:100%;box-sizing:border-box;min-height:78px;margin:0 0 10px;
  padding:14px 16px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);
  color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:background .15s,border-color .15s,transform .15s;}
.pzv-opt:active{transform:scale(.98);}
.pzv-opt:focus-visible{outline:2px solid #0B7CFF;outline-offset:2px;}
.pzv-opt[disabled]{opacity:.45;cursor:not-allowed;}
@media (hover:hover){ .pzv-opt:not([disabled]):hover{background:rgba(11,124,255,.14);border-color:rgba(11,124,255,.55);} }
.pzv-opt-ico{flex:0 0 52px;width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;
  background:rgba(11,124,255,.18);color:#8ec2ff;}
.pzv-opt--v .pzv-opt-ico{background:rgba(200,232,53,.14);color:#c8e835;}
.pzv-opt-txt{min-width:0;}
.pzv-opt-t{display:block;font-weight:900;font-size:1.02rem;line-height:1.15;}
.pzv-opt-d{display:block;margin-top:3px;font-size:.84rem;font-weight:600;color:rgba(234,242,255,.7);line-height:1.25;}
.pzv-cancel{display:block;width:100%;min-height:48px;margin-top:2px;border:0;border-radius:999px;background:transparent;
  color:rgba(234,242,255,.72);font:inherit;font-weight:800;font-size:.95rem;cursor:pointer;}
.pzv-cancel:focus-visible{outline:2px solid #0B7CFF;outline-offset:2px;}
@media (min-width:640px){
  .pzv-overlay{align-items:center;}
  .pzv-sheet{max-width:420px;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:20px 20px 14px;
    transform:translateY(10px) scale(.98);opacity:0;transition:opacity .16s,transform .16s;box-shadow:0 24px 60px rgba(0,0,0,.55);}
  .pzv-overlay.is-open .pzv-sheet{transform:none;opacity:1;}
  .pzv-grip{display:none;}
}
.pzv-dl{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);
  z-index:10040;width:min(calc(100vw - 32px),380px);box-sizing:border-box;padding:12px 14px;border-radius:16px;
  background:rgba(10,17,34,.97);border:1px solid rgba(255,255,255,.14);box-shadow:0 14px 40px rgba(0,0,0,.5);
  color:#eaf2ff;font-family:'Montserrat',system-ui,sans-serif;}
@media (min-width:1024px){ .pzv-dl{bottom:24px;} }
.pzv-dl-row{display:flex;align-items:center;gap:10px;}
.pzv-dl-t{flex:1;min-width:0;font-weight:800;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pzv-dl-p{font-weight:900;font-size:.9rem;font-variant-numeric:tabular-nums;color:#c8e835;}
.pzv-dl-bar{position:relative;height:6px;margin:10px 0 8px;border-radius:6px;background:rgba(255,255,255,.14);overflow:hidden;}
.pzv-dl-bar i{position:absolute;left:0;top:0;bottom:0;width:100%;border-radius:6px;background:#0B7CFF;
  transform-origin:0 50%;transform:scaleX(0);transition:transform .2s linear;}
.pzv-dl.is-indet .pzv-dl-bar i{width:30%;transform:none;animation:pzv-indet 1.1s ease-in-out infinite;}
@keyframes pzv-indet{0%{left:-30%}100%{left:100%}}
.pzv-dl-acc{display:flex;gap:8px;justify-content:flex-end;}
.pzv-dl-btn{min-height:44px;padding:0 16px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);
  color:#eaf2ff;font:inherit;font-weight:800;font-size:.86rem;cursor:pointer;}
.pzv-dl-btn:focus-visible{outline:2px solid #0B7CFF;outline-offset:2px;}
.pzv-dl-btn--main{flex:1;border-color:transparent;background:#0B7CFF;color:#fff;animation:pzv-latido 1.4s ease-in-out infinite;}
@keyframes pzv-latido{0%,100%{box-shadow:0 0 0 0 rgba(11,124,255,.5)}50%{box-shadow:0 0 0 7px rgba(11,124,255,0)}}
.pzv-dl-x{width:44px;height:44px;flex:0 0 44px;margin:-8px -8px -8px 0;border:0;background:transparent;color:rgba(234,242,255,.7);
  font-size:1.4rem;line-height:1;cursor:pointer;border-radius:50%;}
.pzv-dl.is-ready .pzv-dl-bar i{background:#c8e835;}
@media (prefers-reduced-motion:reduce){
  .pzv-overlay,.pzv-sheet,.pzv-dl-bar i{transition:none;}
  .pzv-dl-btn--main,.pzv-dl.is-indet .pzv-dl-bar i{animation:none;}
}`;
    const s = document.createElement('style');
    s.id = 'pzv-estilos';
    s.textContent = css;
    document.head.appendChild(s);
  }

  const ICO_H = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="m10 9.5 4.5 2.5-4.5 2.5z" fill="currentColor"/></svg>';
  const ICO_V = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6.5" y="2" width="11" height="20" rx="2.5"/><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor"/></svg>';

  /* ─────────────────────────────────────────────────────────
     (2026-09-30) Tarjeta flotante de descarga con progreso.
     Una descarga a la vez. Al terminar: en teléfono abre "compartir";
     si el navegador exige un toque nuevo (iOS), deja "Listo · toca para
     compartir". En compu, guarda el archivo.
     ───────────────────────────────────────────────────────── */
  let actual = null;   // { estado: 'bajando'|'listo', cerrar() }

  function descargarArchivo(o) {
    o = o || {};
    if (!o.url) { aviso('Video no disponible'); return Promise.resolve(false); }
    if (actual && actual.estado === 'bajando') { aviso('Ya hay una descarga en curso'); return Promise.resolve(false); }
    if (actual) actual.cerrar();
    estilos();
    const nombreArchivo = o.nombreArchivo || 'puntazo.mp4';
    const titulo = o.titulo || 'Descargando video';
    const modo = o.modo || 'click';
    if (o.video) { try { o.video.pause(); } catch (e) {} }

    const card = document.createElement('div');
    card.className = 'pzv-dl';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML =
      '<div class="pzv-dl-row"><span class="pzv-dl-t"></span><span class="pzv-dl-p">0%</span></div>' +
      '<div class="pzv-dl-bar"><i></i></div>' +
      '<div class="pzv-dl-acc"><button type="button" class="pzv-dl-btn" data-a="cancelar">Cancelar</button></div>';
    card.querySelector('.pzv-dl-t').textContent = titulo;
    document.body.appendChild(card);
    const $p = card.querySelector('.pzv-dl-p');
    const $i = card.querySelector('.pzv-dl-bar i');
    const ctrl = new AbortController();
    const st = { estado: 'bajando', cerrar: cerrar };
    actual = st;

    function cerrar() {
      try { card.remove(); } catch (e) {}
      if (actual === st) actual = null;
    }
    card.querySelector('[data-a="cancelar"]').addEventListener('click', () => { try { ctrl.abort(); } catch (e) {} });

    // iOS: el share necesita un toque nuevo; la tarjeta queda "Listo".
    function listo(f) {
      st.estado = 'listo';
      card.classList.remove('is-indet');
      card.classList.add('is-ready');
      $i.style.transform = 'scaleX(1)';
      $p.textContent = '100%';
      card.querySelector('.pzv-dl-row').innerHTML = '<span class="pzv-dl-t">Listo · toca para compartir</span><button type="button" class="pzv-dl-x" data-a="cerrar" aria-label="Cerrar">×</button>';
      card.querySelector('.pzv-dl-acc').innerHTML =
        '<button type="button" class="pzv-dl-btn" data-a="guardar">Guardar archivo</button>' +
        '<button type="button" class="pzv-dl-btn pzv-dl-btn--main" data-a="compartir">Compartir</button>';
      card.querySelector('[data-a="cerrar"]').addEventListener('click', cerrar);
      card.querySelector('[data-a="guardar"]').addEventListener('click', () => { guardarArchivo(f, nombreArchivo); cerrar(); });
      card.querySelector('[data-a="compartir"]').addEventListener('click', async () => {
        let ok = false;
        try { ok = await compartirArchivo(f); }
        catch (e) { if (e && e.name === 'AbortError') return; ok = false; }   // cerró el menú: sigue listo
        if (ok) evento('share_success', { video_name: o.nombre || nombreArchivo, mode: modo });
        else guardarArchivo(f, nombreArchivo);
        cerrar();
      });
      try { card.querySelector('[data-a="compartir"]').focus({ preventScroll: true }); } catch (e) {}
    }

    return (async () => {
      try {
        const blob = await bajar(urlDirecta(o.url), (p) => {
          card.classList.toggle('is-indet', p === null);
          if (p === null) { $p.textContent = ''; return; }
          $i.style.transform = 'scaleX(' + (p / 100) + ')';
          $p.textContent = p + '%';
        }, ctrl.signal);
        const f = new File([blob], nombreArchivo, { type: 'video/mp4' });
        if (esTactil() && puedeCompartir(f)) {
          let ok = false;
          try { ok = await compartirArchivo(f); } catch (e) { ok = false; }
          if (ok) { evento('share_success', { video_name: o.nombre || nombreArchivo, mode: modo }); cerrar(); return true; }
          listo(f);
          return true;
        }
        guardarArchivo(f, nombreArchivo, modo === 'vertical' ? 'Video vertical descargado' : 'Video descargado');
        cerrar();
        return true;
      } catch (err) {
        cerrar();
        if (err && err.name === 'AbortError') { aviso('Descarga cancelada'); return false; }
        forzarDescarga(o.url, nombreArchivo);
        aviso('No se pudo aquí; se abrió la descarga directa');
        return false;
      }
    })();
  }

  /* ─────────────────────────────────────────────────────────
     (2026-09-30) Selector "Horizontal / Vertical".
     Hoja inferior en teléfono, ventana centrada en compu.
     alElegir(op) se llama DENTRO del toque (el navegador pide un gesto
     para descargar / compartir).
     ───────────────────────────────────────────────────────── */
  let selectorAbierto = null;

  function abrirSelector(hayHorizontal, alElegir) {
    estilos();
    if (selectorAbierto) selectorAbierto(null);
    const antes = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'pzv-overlay';
    ov.innerHTML =
      '<div class="pzv-sheet" role="dialog" aria-modal="true" aria-labelledby="pzv-titulo">' +
        '<div class="pzv-grip" aria-hidden="true"></div>' +
        '<p class="pzv-title" id="pzv-titulo">¿Cómo lo quieres descargar?</p>' +
        '<button type="button" class="pzv-opt pzv-opt--h" data-op="horizontal"' + (hayHorizontal ? '' : ' disabled') + '>' +
          '<span class="pzv-opt-ico">' + ICO_H + '</span>' +
          '<span class="pzv-opt-txt"><span class="pzv-opt-t">Horizontal</span>' +
          '<span class="pzv-opt-d">' + (hayHorizontal ? 'Para verlo en la compu o la tele' : 'No disponible desde aquí') + '</span></span>' +
        '</button>' +
        '<button type="button" class="pzv-opt pzv-opt--v" data-op="vertical">' +
          '<span class="pzv-opt-ico">' + ICO_V + '</span>' +
          '<span class="pzv-opt-txt"><span class="pzv-opt-t">Vertical</span>' +
          '<span class="pzv-opt-d">Para Reels, TikTok o estados</span></span>' +
        '</button>' +
        '<button type="button" class="pzv-cancel" data-op="">Cancelar</button>' +
      '</div>';
    document.body.appendChild(ov);
    const sheet = ov.querySelector('.pzv-sheet');
    let cerrado = false;

    function cerrar(op) {
      if (cerrado) return;
      cerrado = true;
      selectorAbierto = null;
      document.removeEventListener('keydown', teclas, true);
      ov.classList.remove('is-open');
      setTimeout(() => { try { ov.remove(); } catch (e) {} }, 240);
      try { if (antes && antes.focus && antes !== document.body) antes.focus({ preventScroll: true }); } catch (e) {}
      alElegir(op || null);   // null = canceló (botón, fuera, Escape u otro selector)
    }
    selectorAbierto = cerrar;

    function teclas(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(null); return; }
      if (e.key === 'Tab') {   // el foco no se sale de la hoja
        const f = Array.prototype.filter.call(sheet.querySelectorAll('button'), b => !b.disabled);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
      e.stopPropagation();   // que el feed no reaccione (espacio, flechas)
    }
    document.addEventListener('keydown', teclas, true);

    ov.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-op]') : null;
      if (b) { if (!b.disabled) cerrar(b.dataset.op || null); return; }
      if (!sheet.contains(e.target)) cerrar(null);   // toque fuera de la hoja
    });
    // Los gestos dentro del selector no llegan al video de abajo.
    ['pointerdown', 'pointerup', 'touchstart'].forEach(t => ov.addEventListener(t, e => e.stopPropagation()));

    requestAnimationFrame(() => {
      ov.classList.add('is-open');
      const primero = sheet.querySelector('.pzv-opt:not([disabled])');
      try { primero && primero.focus({ preventScroll: true }); } catch (e) {}
    });
  }

  /**
   * (2026-09-30) Descarga unificada.
   * - Sin vertical → opts.descargarHorizontal() directo, sin preguntar.
   * - Con vertical → selector Horizontal / Vertical.
   * Devuelve Promise<"horizontal"|"vertical"|null>.
   */
  async function menuDescarga(entry, opts) {
    entry = entry || {};
    opts = opts || {};
    const horiz = typeof opts.descargarHorizontal === 'function' ? opts.descargarHorizontal : null;
    let doc = null;
    try {
      doc = await Promise.race([buscar(entry.nombre), new Promise(r => setTimeout(() => r(null), 5000))]);
    } catch (e) { doc = null; }

    if (!doc || !doc.url) {
      if (horiz) { horiz(); return 'horizontal'; }
      aviso('Este clip no está disponible para descargar');
      return null;
    }

    evento('download_menu', { video_name: entry.nombre });
    return new Promise(resolve => {
      abrirSelector(!!horiz, (op) => {
        evento('download_choice', { video_name: entry.nombre, choice: op });
        if (op === 'horizontal' && horiz) { horiz(); resolve('horizontal'); return; }
        if (op === 'vertical') {
          evento('click_vertical_download', { video_name: entry.nombre });
          if (window.PZ && PZ.trackDownload) {
            PZ.trackDownload(entry.nombre, { club: entry.loc || entry.club || null, cancha: entry.can || entry.cancha || null, lado: entry.lado || null, mode: 'vertical' });
          }
          descargarArchivo({
            url: doc.url,
            nombreArchivo: idDe(entry.nombre) + '_vertical.mp4',
            titulo: 'Descargando vertical',
            video: opts.video,
            nombre: entry.nombre,
            modo: 'vertical'
          });
          resolve('vertical');
          return;
        }
        resolve(null);
      });
    });
  }

  return { crearPill, buscar, registrar, tieneVertical, urlFeed, menuDescarga, descargarArchivo };
})();
