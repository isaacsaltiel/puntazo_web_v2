// assets/clip.js — logic for clip.html
(function () {
  function getQueryParams() {
    const o = {};
    location.search.substring(1).split('&').forEach(p => { const [k,v]=p.split('='); if(k) o[decodeURIComponent(k)]=decodeURIComponent(v||''); });
    return o;
  }

  function toast(msg){
    try{ const el=document.querySelector('.pz-toast'); if(!el){ const t=document.createElement('div'); t.className='pz-toast'; t.style.position='fixed'; t.style.left='50%'; t.style.bottom='24px'; t.style.transform='translateX(-50%)'; t.style.background='rgba(0,0,0,.8)'; t.style.color='#fff'; t.style.padding='8px 12px'; t.style.borderRadius='8px'; document.body.appendChild(t); t.textContent=msg; setTimeout(()=>t.remove(),1600); } else { el.textContent=msg; setTimeout(()=>el.remove(),1600);} }catch{}
  }

  async function findVideoById(videoId) {
    try {
      const cfg = await fetch('data/config_locations.json?cb='+Date.now(), {cache:'no-store'}).then(r=>r.json());
      for (const loc of (cfg.locaciones||[])){
        for (const can of (loc.cancha||[])){
          for (const lado of (can.lados||[])){
            try{
              const data = await fetch(lado.json_url + '?cb=' + Date.now(), {cache:'no-store'}).then(r=>r.json());
              const v = (data.videos||[]).find(x => x.nombre === videoId);
              if (v) return {entry: v, loc: loc.id || '', can: can.id || '', lado: lado.id || '', locName: loc.nombre||'', canName: can.nombre||'', ladoName: lado.nombre||'' };
            }catch(e){/* ignore fetch errors */}
          }
        }
      }
    } catch (e) { console.warn('[clip] findVideoById error', e); }
    return null;
  }

  async function incrementViewCount(db, videoId, meta) {
    try{
      await db.collection('reactions').doc(videoId).set(Object.assign({ views: firebase.firestore.FieldValue.increment(1), lastView: firebase.firestore.FieldValue.serverTimestamp(), videoId: videoId }, meta), { merge: true });
    }catch(e){ console.warn('[clip] view increment failed', e); }
  }

  async function init() {
    const params = getQueryParams();
    const vid = params.videoId || '';
    const loading = document.getElementById('loading');
    const container = document.getElementById('clipContainer');
    if (!vid) { if(loading) loading.textContent = 'No se indicó videoId'; return; }

    const found = await findVideoById(vid);
    if (!found) { if(loading) loading.textContent = 'Clip no encontrado'; return; }

    const entry = found.entry;
    const videoEl = document.getElementById('clipVideo');
    videoEl.src = entry.url;
    videoEl.setAttribute('aria-label', entry.nombre || 'Clip');

    // show UI
    loading.style.display = 'none';
    container.style.display = '';

    // reactions
    try{
      const meta = {
        videoId: entry.nombre,
        videoUrl: entry.url,
        club: found.locName || found.loc,
        cancha: found.canName || found.can,
        lado: found.ladoName || found.lado,
        fecha: entry._meta ? (entry._meta.Y + '-' + entry._meta.M + '-' + entry._meta.D) : ''
      };

      // increment views in reactions doc so metrics count this view
      const db = window.PuntazoFirebase && window.PuntazoFirebase.db ? window.PuntazoFirebase.db() : (window.firebase && firebase.firestore ? firebase.firestore() : null);
      if (db) incrementViewCount(db, entry.nombre, meta).catch(()=>{});

      const target = document.getElementById('reactionsTarget');
      if (window.PuntazoReactions && target) {
        PuntazoReactions.attach(target, {
          videoId: entry.nombre,
          videoUrl: entry.url,
          club: meta.club,
          cancha: meta.cancha,
          lado: meta.lado,
          fecha: meta.fecha
        });
      }
    }catch(e){ console.warn('[clip] reactions attach failed', e); }

    // share button
    const shareBtn = document.getElementById('shareBtn');
    shareBtn.addEventListener('click', async () => {
      const link = location.origin + '/clip.html?videoId=' + encodeURIComponent(entry.nombre);
      try{
        if (navigator.share) {
          await navigator.share({ title: 'Puntazo', text: 'Mira este puntazo', url: link });
          toast('Compartido');
          return;
        }
      }catch(e){ /* ignore */ }
      try{ await navigator.clipboard.writeText(link); toast('Enlace copiado'); }catch(e){ window.open(link,'_blank'); }
    });

    // save button
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.addEventListener('click', async () => {
      try{
        if (!window.PuntazoAuth || !PuntazoAuth.currentUser) {
          if (window.PuntazoAuth && typeof PuntazoAuth.requireAuth === 'function') {
            PuntazoAuth.requireAuth(() => toast('Autenticado — vuelve a pulsar guardar'));
          } else {
            toast('Inicia sesión para guardar');
          }
          return;
        }
        const user = PuntazoAuth.currentUser;
        const db = window.PuntazoFirebase && window.PuntazoFirebase.db ? window.PuntazoFirebase.db() : (window.firebase && firebase.firestore ? firebase.firestore() : null);
        if (!db) { toast('Servicio no listo'); return; }

        const meta = {
          videoId: entry.nombre,
          videoUrl: entry.url,
          club: found.locName || found.loc,
          cancha: found.canName || found.can,
          lado: found.ladoName || found.lado,
          fecha: entry._meta ? (entry._meta.Y + '-' + entry._meta.M + '-' + entry._meta.D) : '',
          savedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('usuarios').doc(user.uid).collection('guardados').doc(entry.nombre).set(meta);
        toast('Guardado en tu perfil');
      }catch(e){ console.warn('[clip] save failed', e); toast('No se pudo guardar'); }
    });

    // fullscreen button
    document.getElementById('fullBtn').addEventListener('click', async () => {
      try{
        if (videoEl.requestFullscreen) await videoEl.requestFullscreen();
        else if (videoEl.webkitRequestFullscreen) await videoEl.webkitRequestFullscreen();
      }catch(e){ console.warn(e); }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
