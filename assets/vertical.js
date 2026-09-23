/* ═══════════════════════════════════════════════════════════
   Botón "Vertical" (9:16) en cada clip.

   La NUC del club genera, en su tiempo libre, una versión vertical de cada
   clip con una cámara que sigue la pelota (vision/vertical en la central) y
   la registra en Firestore `clip_verticals/<nombre sin .mp4>` con su `url`.
   Este módulo:
   - junta las consultas de todas las tarjetas visibles y las hace en lotes de
     30 (una lectura por lote, no una por clip);
   - pinta el botón SOLO si ese clip ya tiene su vertical;
   - al tocarlo baja el mp4 con progreso y abre "compartir" del teléfono
     (TikTok, Reels, WhatsApp); si no se puede compartir, lo descarga.
   Si la consulta falla (sin red, reglas), el botón simplemente no aparece.
   Lo usan el feed de lado.html (script.js) y PuntazoCard (card.js).
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
      d.collection(COLECCION).where(firebase.firestore.FieldPath.documentId(), 'in', lote).get()
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

  /**
   * Botón redondo "Vertical". Nace oculto; se muestra cuando el clip tiene su vertical.
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
    const compartir = async (f) => {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
        await navigator.share({ files: [f], title: 'Puntazo', text: '¡Mira este puntazo! 🎾' });
        return true;
      }
      return false;
    };
    const guardar = (f) => {
      const u = URL.createObjectURL(f);
      const a = document.createElement('a');
      a.href = u; a.download = nombreArchivo;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 800);
      aviso('Video vertical descargado');
    };

    btn.addEventListener('click', async () => {
      if (!doc) return;
      if (estado === 'listo' && archivo) {
        let ok = false;
        try { ok = await compartir(archivo); } catch (e) {}
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
        try { ok = await compartir(f); } catch (e) { ok = false; }
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
        try {
          const a = document.createElement('a');
          a.href = urlForzarDescarga(doc.url); a.download = nombreArchivo;
          document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
        } catch (e) {}
        ponerLibre();
        aviso('No se pudo compartir, se intentó descargar');
      }
    });
    return btn;
  }

  return { crearPill, buscar };
})();
