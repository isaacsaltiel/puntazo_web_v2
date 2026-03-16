// =============================================================
// card.js — Puntazo · Constructor universal de tarjeta de video
// =============================================================
window.PuntazoCard = (function () {
  'use strict';

  function parseFromName(name) {
    const re = /^(.+?)_(.+?)_(.+?)_(\d{8})_(\d{6})\.mp4$/i;
    const m = String(name || '').match(re);
    if (!m) return null;
    const [, loc, can, lado, date8, time6] = m;
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
             ymd:`${d.Y}${d.M}${d.D}`, Y:d.Y, M:d.M, D:d.D, h, mi, s };
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
    el.textContent = msg;
    el.style.display = 'block';
    el.style.opacity = '1';
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
      savedAt:getTs(), nombreArchivo:entry.nombre,
    };
    await db.collection('usuarios').doc(user.uid).collection('guardados').doc(entry.nombre).set(meta,{merge:true});
    try {
      await db.collection('reactions').doc(entry.nombre).set({
        immortal:true, immortal_reasons:{saved_by_user:{uid:user.uid,at:getTs()}},
        immortal_markedAt:getTs(), saves:firebase.firestore.FieldValue.increment(1),
      },{merge:true});
    } catch {}
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

  function buildSharePill(entry) {
    const btn = makePill('🔗', 'Copiar enlace');
    btn.addEventListener('click', async () => {
      const link = `${location.origin}/clip.html?videoId=${encodeURIComponent(entry.nombre)}`;
      try {
        if (navigator.share) { await navigator.share({title:'Puntazo',text:'Mira este puntazo 🎾',url:link}); toast('Compartido'); return; }
      } catch {}
      try { await navigator.clipboard.writeText(link); btn.textContent='✓'; setTimeout(()=>{btn.textContent='🔗';},1500); toast('Enlace copiado'); }
      catch { window.open(link,'_blank'); }
    });
    return btn;
  }

  /**
   * buildSavePill
   * - 💾 siempre (mismo emoji)
   * - Azul cuando está guardado, gris/normal cuando no
   * - opts.onUnsave?: fn() — llamada extra cuando se quita de guardados (ej: para remover la card del DOM)
   */
  function buildSavePill(entry, opts) {
    opts = opts || {};
    const btn = makePill('💾', 'Guardar en tu perfil');
    btn.dataset.saved = '0';
    btn.dataset.loading = '0';

    const sync = async () => {
      const user = getUser();
      if (!user) {
        btn.classList.remove('is-saved');
        btn.title = 'Guardar en tu perfil';
        return;
      }
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
      if (!auth?.currentUser) {
        if (auth?.requireAuth) auth.requireAuth(()=>sync());
        return;
      }
      if (btn.dataset.loading === '1') return;
      btn.dataset.loading = '1';
      btn.disabled = true;

      try {
        const alreadySaved = btn.dataset.saved === '1';
        if (alreadySaved) {
          await unsaveVideo(entry.nombre);
          toast('Quitado de guardados');
          btn.dataset.saved = '0';
          btn.classList.remove('is-saved');
          btn.title = 'Guardar en tu perfil';
          // Si hay callback de unsave (ej: perfil.html quiere remover la card), llamarlo
          if (typeof opts.onUnsave === 'function') opts.onUnsave();
        } else {
          await saveVideo(entry);
          toast('¡Guardado en tu perfil!');
          btn.dataset.saved = '1';
          btn.classList.add('is-saved');
          btn.title = 'Guardado (toca para quitar)';
        }
      } catch(e) { console.warn('[PuntazoCard save]', e); }

      btn.disabled = false;
      btn.dataset.loading = '0';
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
   * build(entry, opts) → HTMLElement
   *
   * opts:
   *   showSave, showShare, showFullscreen: true
   *   showClaim, showReactions, showComments: true
   *   showClubInfo: false
   *   rankBadge: null | 1|2|3
   *   onUnsave: null | fn()  → llamado cuando se quita de guardados
   *                            (típicamente: () => card.remove() en perfil.html)
   */
  function build(entry, opts) {
    opts = Object.assign({
      showSave:true, showShare:true, showFullscreen:true,
      showClaim:true, showReactions:true, showComments:true,
      showClubInfo:false, rankBadge:null, onUnsave:null,
    }, opts||{});

    if (!entry._meta && entry.nombre) entry._meta = parseFromName(entry.nombre);

    const card = document.createElement('div');
    card.className = 'video-card';
    if (entry.nombre) card.id = entry.nombre;

    // Rank badge
    if (opts.rankBadge) {
      const badge = document.createElement('div');
      const cls   = opts.rankBadge===1?'top1':opts.rankBadge===2?'top2':opts.rankBadge===3?'top3':'';
      badge.className = `rank-badge ${cls}`;
      badge.textContent = opts.rankBadge===1?'🥇':opts.rankBadge===2?'🥈':opts.rankBadge===3?'🥉':'#'+opts.rankBadge;
      card.appendChild(badge);
    }

    // 1. Header: tiempo + rxn preview
    const topEl = document.createElement('div');
    topEl.className = 'card-top';
    const timeEl = document.createElement('span');
    timeEl.className = 'card-time';
    timeEl.textContent = formatDisplayTime(entry.nombre) || (entry.fecha||'');
    const rxnPreview = document.createElement('div');
    rxnPreview.className = 'card-rxn-preview';
    rxnPreview.setAttribute('data-rxn-preview','');
    topEl.appendChild(timeEl);
    topEl.appendChild(rxnPreview);
    card.appendChild(topEl);

    // Subtítulo (club/cancha)
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
    if (entry.url) video.src = entry.url;
    wrap.appendChild(video);
    card.appendChild(wrap);

    // 3. Participants slot
    const pSlot = document.createElement('div');
    pSlot.setAttribute('data-participants-slot','');
    card.appendChild(pSlot);

    // 4. Action pills
    const pillsEl = document.createElement('div');
    pillsEl.className = 'action-pills';

    if (opts.showShare)       pillsEl.appendChild(buildSharePill(entry));
    if (opts.showSave)        pillsEl.appendChild(buildSavePill(entry, { onUnsave: opts.onUnsave }));
    if (opts.showFullscreen)  pillsEl.appendChild(buildFullscreenPill(video));
    card.appendChild(pillsEl);

    // 5. Reactions slot
    if (opts.showReactions) {
      const rxnSlot = document.createElement('div');
      rxnSlot.setAttribute('data-rxn-slot','');
      card.appendChild(rxnSlot);
    }

    // 6. Comments slot
    if (opts.showComments) {
      const cSlot = document.createElement('div');
      cSlot.setAttribute('data-comments-slot','');
      card.appendChild(cSlot);
    }

    // 7. Claim slot
    if (opts.showClaim) {
      const clSlot = document.createElement('div');
      clSlot.setAttribute('data-claim-slot','');
      card.appendChild(clSlot);
    }

    return card;
  }

  function attachReactions(card, entry) {
    function tryAttach(retries) {
      if (window.PuntazoReactions) {
        const _meta = entry._meta || parseFromName(entry.nombre);
        const fecha = entry.fecha || (_meta?`${_meta.Y}-${_meta.M}-${_meta.D}`:'');
        PuntazoReactions.attach(card, {
          videoId: entry.nombre, videoUrl: entry.url||'',
          club: entry.club||'', cancha: entry.cancha||'', lado: entry.lado||'', fecha,
        });
      } else if ((retries||0) > 0) {
        setTimeout(()=>tryAttach((retries||0)-1), 200);
      }
    }
    tryAttach(20);
  }

  function buildAndAppend(entry, opts, container) {
    const card = build(entry, opts);
    container.appendChild(card);
    attachReactions(card, entry);
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
      club:   locObj.nombre  || meta.loc,
      cancha: canObj.nombre  || meta.can,
      lado:   ladoObj.nombre || meta.lado,
      fecha:  `${meta.Y}-${meta.M}-${meta.D}`,
      _meta:  meta,
      _ladoHref: `/lado.html?loc=${encodeURIComponent(meta.loc)}&can=${encodeURIComponent(meta.can)}&lado=${encodeURIComponent(meta.lado)}`,
    };
  }

  return {
    build, buildAndAppend, attachReactions,
    buildSharePill, buildSavePill, buildFullscreenPill,
    loadEntryFromConfig,
    parseFromName, formatDisplayTime, escapeHTML,
    isVideoSaved, saveVideo, unsaveVideo,
    getUser, getDb, toast,
  };
})();
