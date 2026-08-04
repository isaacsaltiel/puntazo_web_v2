// =============================================================
// card.js — Puntazo · Constructor universal de tarjeta de video
// =============================================================
window.PuntazoCard = (function () {
  'use strict';

  // F123-D: reconoce sufijo opcional _TAG_TAGID entre lado y fecha
  // (espejo de F123-A en matches.js). Backwards-compatible.
  function parseFromName(name) {
    const re = /^(.+?)_(.+?)_(Lado[A-Z])(?:_([A-Z][A-Z_]*)_([A-Za-z0-9]+))?_(\d{8})_(\d{6})\.mp4$/i;
    const m = String(name || '').match(re);
    if (!m) return null;
    const [, loc, can, lado, tag, tagId, date8, time6] = m;
    const tryYYYYMMDD = () => {
      const Y=Number(date8.slice(0,4)),Mo=Number(date8.slice(4,6)),D=Number(date8.slice(6,8));
      if(Y>=1900&&Y<=2100&&Mo>=1&&Mo<=12&&D>=1&&D<=31) return{Y:String(Y),M:date8.slice(4,6),D:date8.slice(6,8)};
      return null;
    };
    const tryDDMMYYYY = () => {
      const D=Number(date8.slice(0,2)),Mo=Number(date8.slice(2,4)),Y=Number(date8.slice(4,8));
      if(Y>=1900&&Y<=2100&&Mo>=1&&Mo<=12&&D>=1&&D<=31) return{Y:String(Y),M:date8.slice(2,4),D:date8.slice(0,2)};
      return null;
    };
    const d = tryYYYYMMDD() || tryDDMMYYYY();
    if (!d) return null;
    const h=time6.slice(0,2),mi=time6.slice(2,4),s=time6.slice(4,6);
    return { loc, can, lado, tsKey:Number(`${d.Y}${d.M}${d.D}${h}${mi}${s}`),
             date:new Date(Number(d.Y),Number(d.M)-1,Number(d.D),Number(h),Number(mi),Number(s)),
             ymd:`${d.Y}${d.M}${d.D}`, Y:d.Y, M:d.M, D:d.D, h, mi, s,
             tag: tag || null, tagId: tagId || null };
  }

  function formatDisplayTime(nombre) {
    const m = String(nombre||'').match(/_(\d{2})(\d{2})\d{2}\.mp4$/i);
    if (!m) return '';
    const hr=parseInt(m[1],10), mn=m[2];
    return `${hr%12||12}:${mn} ${hr>=12?'PM':'AM'}`;
  }

  function escapeHTML(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Analytics (GA4, guardado si no hay gtag) ──────────────────
  function trackEvent(name, params) {
    try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch {}
  }

  // ── Toast ──────────────────────────────────────────────────
  let _toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('__pz_card_toast__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__pz_card_toast__';
      el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:rgba(0,0,0,.86);color:#fff;padding:10px 18px;border-radius:10px;z-index:9999;font-weight:600;font-size:14px;pointer-events:none;white-space:nowrap;transition:opacity .2s;';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.display = 'block'; el.style.opacity = '1';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(()=>{ el.style.opacity='0'; setTimeout(()=>{ el.style.display='none'; },200); }, 1800);
  }

  // ── Firebase / Auth ────────────────────────────────────────
  function getDb() { try { return window.PuntazoFirebase?.db(); } catch { return null; } }
  function getUser() { try { return window.PuntazoAuth?.currentUser || null; } catch { return null; } }
  function getTs() { try { return firebase.firestore.FieldValue.serverTimestamp(); } catch { return new Date(); } }

  // ── Save helpers ───────────────────────────────────────────
  async function isVideoSaved(videoId) {
    const user=getUser(), db=getDb();
    if (!user||!db) return false;
    try { return (await db.collection('usuarios').doc(user.uid).collection('guardados').doc(videoId).get()).exists; }
    catch { return false; }
  }

  async function saveVideo(entry) {
    const user=getUser(), db=getDb();
    if (!user||!db) throw new Error('Sin auth/DB');
    const meta = {
      videoId:entry.nombre, videoUrl:entry.url||'',
      club:entry.club||'', cancha:entry.cancha||'', lado:entry.lado||'',
      fecha:entry.fecha||(entry._meta?`${entry._meta.Y}-${entry._meta.M}-${entry._meta.D}`:''),
      // F136: origin distingue cómo llegó el clip a "Mis clips":
      //   'manual' = guardado a mano con 💾 (este path).
      //   'boton'  = auto-persistido al resolverse un pulso del botón.
      // matchId opcional si el call-site lo conoce (la mayoría no; Mis clips
      // lo deriva por ventana de tiempo contra los partidos del user).
      origin: entry.origin || 'manual',
      matchId: entry.matchId || null,
      savedAt:getTs(), nombreArchivo:entry.nombre,
    };
    await db.collection('usuarios').doc(user.uid).collection('guardados').doc(entry.nombre).set(meta,{merge:true});
  }

  async function unsaveVideo(videoId) {
    const user=getUser(), db=getDb();
    if (!user||!db) throw new Error('Sin auth/DB');
    await db.collection('usuarios').doc(user.uid).collection('guardados').doc(videoId).delete();
  }

  // ── Fullscreen ─────────────────────────────────────────────
  let _fsEventsBound = false;
  const _fsSyncers = new Set();

  function bindFsEvents() {
    if (_fsEventsBound) return; _fsEventsBound = true;
    const run = ()=>{ _fsSyncers.forEach(fn=>{ try{fn();}catch{} }); };
    document.addEventListener('fullscreenchange', run);
    document.addEventListener('webkitfullscreenchange', run);
  }

  function isFs(video) {
    return !!(document.fullscreenElement===video||document.webkitFullscreenElement===video||video.webkitDisplayingFullscreen);
  }
  function unlockOri() { try { if(screen.orientation?.unlock) screen.orientation.unlock(); } catch {} }

  async function requestFs(video) {
    if (video.requestFullscreen) return video.requestFullscreen();
    if (video.webkitRequestFullscreen) return video.webkitRequestFullscreen();
    if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return; }
    throw new Error('No fullscreen');
  }
  async function exitFs() {
    try { if(document.fullscreenElement&&document.exitFullscreen){await document.exitFullscreen();return;} } catch {}
    try { if(document.webkitFullscreenElement&&document.webkitExitFullscreen){document.webkitExitFullscreen();return;} } catch {}
  }

  // ── Pills de acción ────────────────────────────────────────
  function makePill(emoji, title, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action-pill' + (extraClass ? ' '+extraClass : '');
    btn.textContent = emoji;
    if (title) { btn.title = title; btn.setAttribute('aria-label', title); }
    return btn;
  }

  // ── Compartir el video real (MP4), no el link ─────────────────
  // Dropbox a veces redirige www.dropbox.com → dl.dropboxusercontent.com al
  // hacer fetch(), y ese salto entre hosts puede romper CORS. Vamos directo
  // al host servible y quitamos raw/dl para no arrastrar el redirect.
  function toDirectFetchUrl(url) {
    try {
      const u = new URL(url, location.href);
      if (u.hostname === 'www.dropbox.com') u.hostname = 'dl.dropboxusercontent.com';
      u.searchParams.delete('raw'); u.searchParams.delete('dl');
      return u.toString();
    } catch { return url; }
  }
  function toForceDownloadUrl(url) {
    try {
      const u = new URL(url, location.href);
      if (u.hostname === 'dl.dropboxusercontent.com') u.hostname = 'www.dropbox.com';
      u.searchParams.delete('raw'); u.searchParams.set('dl', '1');
      return u.toString();
    } catch { return url; }
  }

  async function downloadWithProgress(url, { onProgress, signal } = {}) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = parseInt(res.headers.get('Content-Length') || '0', 10);
    const type = url.toLowerCase().includes('.mp4') ? 'video/mp4' : (res.headers.get('Content-Type') || 'video/mp4');
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) {
      const blob = await res.blob();
      if (onProgress) onProgress({ percent: 100, indeterminate: false });
      return new Blob([blob], { type: blob.type || type });
    }
    const chunks = []; let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength || 0;
      if (onProgress) {
        if (total) onProgress({ percent: Math.max(0, Math.min(100, Math.round(received / total * 100))), indeterminate: false });
        else onProgress({ percent: null, indeterminate: true });
      }
    }
    return new Blob(chunks, { type });
  }

  function buildSharePill(entry, opts) {
    opts = opts || {};
    const btn = makePill('📤', 'Compartir video');
    const shareText = opts.shareMessage || '¡Mira este puntazo! 🎾';

    let state = 'idle'; // idle | downloading | ready
    let pendingFile = null;
    let controller = null;
    let fillEl = null, labelEl = null;

    const setIdle = () => {
      state = 'idle'; pendingFile = null; controller = null; fillEl = null; labelEl = null;
      btn.classList.remove('is-progress');
      btn.disabled = false;
      btn.innerHTML = '';
      btn.textContent = '📤';
      btn.title = 'Compartir video';
    };

    const tryShareFile = async (file) => {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Puntazo', text: shareText });
        return true;
      }
      return false;
    };

    const downloadToDisk = (file) => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = entry.nombre;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
      toast('Video descargado');
    };

    const setProgress = ({ percent, indeterminate }) => {
      if (!fillEl || !labelEl) return;
      if (indeterminate) {
        fillEl.style.transform = '';
        fillEl.classList.add('is-indeterminate');
        labelEl.textContent = '';
      } else {
        fillEl.classList.remove('is-indeterminate');
        fillEl.style.transform = `scaleX(${(percent || 0) / 100})`;
        labelEl.textContent = percent + '%';
      }
    };

    btn.addEventListener('click', async () => {
      // El share automático no se disparó tras la descarga (navegador sin
      // soporte, o el usuario cerró el sheet): reintenta con el archivo ya listo.
      if (state === 'ready' && pendingFile) {
        let ok = false;
        try { ok = await tryShareFile(pendingFile); } catch {}
        if (ok) trackEvent('share_success', { video_name: entry.nombre, mode: 'manual_ready' });
        else downloadToDisk(pendingFile);
        setIdle();
        return;
      }

      if (state === 'downloading') {
        try { controller && controller.abort(); } catch {}
        return;
      }

      if (!entry.url) { toast('Video no disponible'); return; }

      trackEvent('click_share_download', { video_name: entry.nombre });
      if (window.PZ && PZ.trackDownload) PZ.trackDownload(entry.nombre, { club: entry.loc || entry.club || null, cancha: entry.can || entry.cancha || null, lado: entry.lado || null, mode: 'click' });
      if (opts.video) { try { opts.video.pause(); } catch {} }

      state = 'downloading';
      btn.classList.add('is-progress');
      btn.title = 'Toca para cancelar';
      btn.innerHTML = '';
      fillEl = document.createElement('span'); fillEl.className = 'pill-fill';
      labelEl = document.createElement('span'); labelEl.className = 'pill-label'; labelEl.textContent = '0%';
      btn.appendChild(fillEl); btn.appendChild(labelEl);

      controller = new AbortController();
      try {
        const blob = await downloadWithProgress(toDirectFetchUrl(entry.url), {
          signal: controller.signal,
          onProgress: setProgress,
        });
        const file = new File([blob], entry.nombre, { type: blob.type || 'video/mp4' });

        let shared = false;
        try { shared = await tryShareFile(file); } catch { shared = false; }

        if (shared) {
          trackEvent('share_success', { video_name: entry.nombre, mode: 'auto_share' });
          setIdle();
          return;
        }

        if (navigator.canShare) {
          // Soporta compartir archivos pero este intento falló o se canceló:
          // deja el archivo ya descargado listo para un segundo toque.
          trackEvent('share_ready', { video_name: entry.nombre });
          pendingFile = file; state = 'ready';
          btn.classList.remove('is-progress');
          btn.innerHTML = ''; btn.textContent = '📤 Listo';
          btn.title = 'Toca para compartir';
        } else {
          trackEvent('download_fallback', { video_name: entry.nombre, mode: 'local_blob' });
          downloadToDisk(file);
          setIdle();
        }
      } catch (err) {
        if (err && err.name === 'AbortError') { setIdle(); toast('Descarga cancelada'); return; }
        console.warn('[PuntazoCard share]', err);
        try {
          const a = document.createElement('a');
          a.href = toForceDownloadUrl(entry.url);
          a.download = entry.nombre;
          document.body.appendChild(a); a.click();
          setTimeout(() => a.remove(), 500);
          trackEvent('download_fallback', { video_name: entry.nombre, mode: 'force_dl' });
        } catch {}
        setIdle();
        toast('No se pudo compartir, se intentó descargar');
      }
    });

    return btn;
  }

  function buildSavePill(entry, opts) {
    opts = opts || {};
    const btn = makePill('💾', 'Guardar en tu perfil');
    btn.dataset.saved = '0'; btn.dataset.loading = '0';
    btn.textContent = '💾'; // siempre el mismo emoji

    const sync = async () => {
      const user = getUser();
      if (!user) { btn.classList.remove('is-saved'); btn.title='Guardar en tu perfil'; return; }
      try {
        const saved = await isVideoSaved(entry.nombre);
        btn.dataset.saved = saved ? '1' : '0';
        btn.classList.toggle('is-saved', saved);
        btn.title = saved ? 'Guardado (toca para quitar)' : 'Guardar en tu perfil';
      } catch {}
    };
    btn._sync = sync;

    btn.addEventListener('click', async () => {
      const auth = window.PuntazoAuth;
      if (!auth?.currentUser) { if (auth?.requireAuth) auth.requireAuth(()=>sync()); return; }
      if (btn.dataset.loading==='1') return;
      btn.dataset.loading='1'; btn.disabled=true;
      try {
        const alreadySaved = btn.dataset.saved==='1';
        if (alreadySaved) {
          await unsaveVideo(entry.nombre); toast('Quitado de guardados');
          btn.dataset.saved='0'; btn.classList.remove('is-saved'); btn.title='Guardar en tu perfil';
          if (typeof opts.onUnsave==='function') opts.onUnsave();
        } else {
          await saveVideo(entry); toast('¡Guardado en tu perfil!');
          btn.dataset.saved='1'; btn.classList.add('is-saved'); btn.title='Guardado (toca para quitar)';
        }
      } catch(e) { console.warn('[PuntazoCard save]', e); }
      btn.disabled=false; btn.dataset.loading='0';
      setTimeout(()=>sync().catch(()=>{}), 400);
    });

    window.addEventListener('puntazo:auth-changed', ()=>sync());
    Promise.resolve().then(sync);
    return btn;
  }

  function buildFullscreenPill(video) {
    bindFsEvents();
    const btn = makePill('⛶', 'Pantalla completa');
    btn.style.display = 'none';

    const syncLabel = ()=>{ btn.classList.toggle('is-active',isFs(video)); btn.textContent=isFs(video)?'✕':'⛶'; };
    const syncVis   = ()=>{ btn.style.display=(!video.paused||isFs(video))?'inline-flex':'none'; };
    const syncAll   = ()=>{ syncLabel(); syncVis(); };
    _fsSyncers.add(syncAll);

    btn.addEventListener('click', async () => {
      try {
        if (isFs(video)) { await exitFs(); unlockOri(); }
        else {
          if (video.paused) { try { await video.play(); } catch {} }
          await requestFs(video);
          try { if(screen.orientation?.lock) await screen.orientation.lock('landscape'); } catch {}
        }
        syncAll();
      } catch(e) { console.warn('[fs]',e); toast('No se pudo abrir pantalla completa'); }
    });

    video.addEventListener('play',  syncVis);
    video.addEventListener('pause', syncVis);
    video.addEventListener('ended', syncVis);
    video.addEventListener('webkitbeginfullscreen', syncAll);
    video.addEventListener('webkitendfullscreen', ()=>{ unlockOri(); syncAll(); });
    return btn;
  }

  // ── build() ────────────────────────────────────────────────
  /**
   * opts:
   *   showSave, showShare, showFullscreen: true
   *   showClubInfo: false
   *   onUnsave: null | fn()
   *   topLabel: null | string   → texto en card-time (null = hora del archivo)
   *   shareMessage: null | string
   */
  function build(entry, opts) {
    opts = Object.assign({
      showSave:true, showShare:true, showFullscreen:true,
      showClubInfo:false, onUnsave:null,
      topLabel:null, shareMessage:null,
    }, opts||{});

    if (!entry._meta && entry.nombre) entry._meta = parseFromName(entry.nombre);

    const card = document.createElement('div');
    card.className = 'video-card';
    if (entry.nombre) card.id = entry.nombre;

    // F123-D: badge "PARTIDO COMPLETO" si el video tiene tag=PARTIDO.
    // El sufijo _PARTIDO_<id> lo emite la NUC (Worker E) para distinguir
    // partidos completos de clips sueltos. Card recibe clase extra para
    // borde azul brillante; un span arriba muestra el badge.
    const isPartido = !!(entry._meta && entry._meta.tag === 'PARTIDO');
    if (isPartido) {
      card.classList.add('is-partido-completo');
      const badge = document.createElement('div');
      badge.className = 'card-partido-badge';
      badge.textContent = '🎾 PARTIDO COMPLETO';
      card.appendChild(badge);
    }

    // 1. Header: label
    const topEl = document.createElement('div');
    topEl.className = 'card-top';

    const labelEl = document.createElement('div');
    labelEl.className = 'card-time';
    labelEl.textContent = opts.topLabel !== null && opts.topLabel !== undefined
      ? opts.topLabel
      : (formatDisplayTime(entry.nombre) || entry.fecha || '');
    topEl.appendChild(labelEl);

    card.appendChild(topEl);

    // Subtítulo (club·cancha)
    if (opts.showClubInfo && (entry.club||entry.cancha)) {
      const sub = document.createElement('div');
      sub.className = 'card-subtitle';
      sub.textContent = [entry.club, entry.cancha?'· '+entry.cancha:''].filter(Boolean).join(' ');
      card.appendChild(sub);
    }

    // 2. Video
    const wrap = document.createElement('div');
    wrap.className = 'video-wrap';
    const video = document.createElement('video');
    video.className = 'real';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    // Poster-imagen ligero: si la NUC ya generó la miniatura, se ve AL INSTANTE en
    // cualquier dispositivo (sin bajar/decodificar el video) y sobra el seek de portada.
    if (entry.poster_url) { video.poster = entry.poster_url; video.preload = 'none'; }
    if (entry.url) {
      video.src = entry.url;
      // Fallback sin poster: pinta un frame REAL del inicio como portada para que nunca
      // se vea el rectángulo negro de preload='metadata'. El seek a 0.2s fuerza al
      // navegador a decodificar ese frame; lo perdido en la reproducción es imperceptible.
      if (!entry.poster_url) {
        video.addEventListener('loadedmetadata', function () { try { video.currentTime = 0.2; } catch (e) {} }, { once: true });
      }
    }
    // (2026-06-10) Métrica de reproducciones: 1 view por video por sesión.
    video.addEventListener('play', function () {
      if (window.PZ && PZ.trackVideoView) {
        PZ.trackVideoView(entry.nombre, { club: entry.loc || entry.club || null, cancha: entry.can || entry.cancha || null, lado: entry.lado || null });
      }
    });
    wrap.appendChild(video);
    card.appendChild(wrap);

    // 3. Action pills
    const pillsEl = document.createElement('div');
    pillsEl.className = 'action-pills';
    if (opts.showShare) pillsEl.appendChild(buildSharePill(entry, { shareMessage: opts.shareMessage, video }));
    if (opts.showSave)  pillsEl.appendChild(buildSavePill(entry, { onUnsave: opts.onUnsave }));
    if (opts.showFullscreen) pillsEl.appendChild(buildFullscreenPill(video));
    card.appendChild(pillsEl);

    return card;
  }

  // ── loadEntryFromConfig ────────────────────────────────────
  async function loadEntryFromConfig(videoId) {
    const meta = parseFromName(videoId);
    if (!meta) return null;
    let cfg;
    try {
      const res = await fetch(`/data/config_locations.json?cb=${Date.now()}`,{cache:'no-store'});
      if (!res.ok) throw new Error('config HTTP '+res.status);
      cfg = await res.json();
    } catch { return null; }

    const locObj  = cfg.locaciones.find(l=>l.id===meta.loc);
    const canObj  = locObj?.cancha.find(c=>c.id===meta.can);
    const ladoObj = canObj?.lados.find(l=>l.id===meta.lado);
    if (!ladoObj?.json_url) return null;

    let json;
    try {
      const res = await fetch(`${ladoObj.json_url}?cb=${Date.now()}`,{cache:'no-store'});
      if (!res.ok) throw new Error('json HTTP '+res.status);
      json = await res.json();
    } catch { return null; }

    const found = (json.videos||[]).find(v=>v.nombre===videoId);
    if (!found) return null;

    return {
      nombre: found.nombre, url: found.url,
      poster_url: found.poster_url || null,
      club:   locObj.nombre  || meta.loc,
      cancha: canObj.nombre  || meta.can,
      lado:   ladoObj.nombre || meta.lado,
      fecha:  `${meta.Y}-${meta.M}-${meta.D}`,
      _meta:  meta,
      _ladoHref:   `/lado.html?loc=${encodeURIComponent(meta.loc)}&can=${encodeURIComponent(meta.can)}&lado=${encodeURIComponent(meta.lado)}`,
      _canchaHref: `/cancha.html?loc=${encodeURIComponent(meta.loc)}&can=${encodeURIComponent(meta.can)}`,
    };
  }

  return {
    build,
    buildSharePill, buildSavePill, buildFullscreenPill,
    loadEntryFromConfig,
    parseFromName, formatDisplayTime, escapeHTML,
    isVideoSaved, saveVideo, unsaveVideo,
    getUser, getDb, toast,
  };
})();
