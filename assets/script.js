// assets/script.js

// ----------------------- utilidades -----------------------
function getQueryParams() {
  const params = {};
  window.location.search
    .substring(1)
    .split("&")
    .forEach(pair => {
      const [key, value] = pair.split("=");
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || "");
    });
  return params;
}

function formatAmPm(hour) {
  const h = parseInt(hour, 10);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12} ${suffix}`;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToVideoById(id) {
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ----------------------- GATE POR CANCHA -----------------------
// Archivo: data/passwords.json
// Estructura esperada: { canchas: [{ loc, can, enabled, sha256, remember_hours }] }
// Seguridad: filtro ligero del lado del cliente. No sustituye auth del servidor.

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function loadPasswords() {
  try {
    const url = `data/passwords.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  } catch (e) {
    console.warn('[gate] No se pudo cargar passwords.json:', e);
    return null; // si no carga, no aplicamos gate (filtro ligero)
  }
}

function findCanchaRule(pwCfg, locId, canId) {
  if (!pwCfg?.canchas?.length) return null;
  return pwCfg.canchas.find(x => x.loc === locId && x.can === canId) || null;
}

function getAuthKey(locId, canId) {
  return `gate:${locId}:${canId}`;
}

function isAuthorized(rule) {
  if (!rule) return true; // si no hay regla, no requiere contraseña
  if (!rule.enabled) return true; // desactivada
  const k = getAuthKey(rule.loc || '', rule.can || '');
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj?.ok || typeof obj.exp !== 'number') return false;
    return Date.now() < obj.exp;
  } catch { return false; }
}

function setAuthorized(rule) {
  const remember = (Number(rule.remember_hours) > 0 ? Number(rule.remember_hours) : 24) * 3600 * 1000;
  const exp = Date.now() + remember;
  const k = getAuthKey(rule.loc, rule.can);
  localStorage.setItem(k, JSON.stringify({ ok: true, exp }));
}

async function requireCanchaPassword(locId, canId) {
  const pwCfg = await loadPasswords();
  const rule = findCanchaRule(pwCfg, locId, canId);
  if (!rule || !rule.enabled) return true; // no protegida

  if (isAuthorized(rule)) return true; // ya autorizado vigente

  // Hasta 3 intentos. Cancelar devuelve false.
  for (let i = 0; i < 3; i++) {
    const input = window.prompt('Esta cancha requiere contraseña.');
    if (input === null) return false; // canceló
    const h = await sha256Hex(input);
    if (h === rule.sha256) {
      setAuthorized(rule);
      return true;
    }
    alert('Contraseña incorrecta. Inténtalo de nuevo.');
  }
  return false;
}

/* ===================== Helpers de asociación (opuesto automático) ===================== */
/**
 * Parsea nombres tipo:
 * Loc_Can_Lado_YYYYMMDD_HHMMSS.mp4
 */
function parseFromName(name) {
  const re = /^(.+?)_(.+?)_(.+?)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/;
  const m = name.match(re);
  if (!m) return null;
  const [, loc, can, lado, Y, M, D, h, mi, s] = m;
  const date = new Date(
    Number(Y), Number(M) - 1, Number(D),
    Number(h), Number(mi), Number(s)
  );
  return { loc, can, lado, date, ymd: `${Y}${M}${D}`, h: Number(h), mi: Number(mi), s: Number(s) };
}
function absSeconds(a, b) { return Math.abs((a - b) / 1000); }

/**
 * En lugar de leer "opuesto" del config, lo deducimos:
 * - Si la cancha tiene exactamente 2 lados, el opuesto es el otro.
 * - Si hay 1 lado o más de 2, no definimos opuesto (null).
 */
async function findOppositeConfig(cfg, locId, canId, ladoId) {
  const loc = cfg.locaciones.find(l => l.id === locId);
  const can = loc?.cancha.find(c => c.id === canId);
  if (!can) return null;

  const otros = (can.lados || []).filter(l => l.id !== ladoId);
  if (otros.length === 1) {
    const opp = otros[0];
    return { oppId: opp.id, oppUrl: opp.json_url, oppName: opp.nombre || opp.id };
  }
  return null;
}

/**
 * Busca el clip del lado opuesto con marca de tiempo más cercana (±15s).
 * Devuelve { lado, nombre, url } o null.
 */
async function findOppositeVideo(entry, cfg, locId, canId, ladoId) {
  const meta = parseFromName(entry.nombre);
  if (!meta) return null;

  const oppCfg = await findOppositeConfig(cfg, locId, canId, ladoId);
  if (!oppCfg || !oppCfg.oppUrl) return null;

  try {
    const res = await fetch(`${oppCfg.oppUrl}?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const dataOpp = await res.json();
    const sameDay = dataOpp.videos?.filter(v => {
      const m = parseFromName(v.nombre);
      return m && m.ymd === meta.ymd;
    }) || [];

    let best = null;
    let bestDelta = Infinity;

    sameDay.forEach(v => {
      const mv = parseFromName(v.nombre);
      if (!mv) return;
      const delta = absSeconds(mv.date, meta.date);
      if (delta <= 15 && delta < bestDelta) {
        best = v;
        bestDelta = delta;
      }
    });

    return best ? { lado: oppCfg.oppId, nombre: best.nombre, url: best.url } : null;
  } catch {
    return null;
  }
}
/* =================== FIN Helpers de asociación =================== */

// ----------------------- navegación -----------------------
async function populateLocaciones() {
  try {
    const url = `data/config_locations.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const config = await res.json();
    const ul = document.getElementById("locaciones-lista");
    if (!ul) return;
    ul.innerHTML = "";
    config.locaciones.forEach(loc => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      li.style.marginBottom = "10px";
      const a = document.createElement("a");
      a.href = `locacion.html?loc=${loc.id}`;
      a.textContent = loc.nombre;
      a.classList.add("link-blanco");
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (err) {
    console.error("Error en populateLocaciones():", err);
  }
}

async function populateCanchas() {
  try {
    const params = getQueryParams();
    const locId = params.loc;
    const url = `data/config_locations.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const config = await res.json();
    const loc = config.locaciones.find(l => l.id === locId);
    const ul = document.getElementById("canchas-lista");
    if (!ul || !loc) return;
    ul.innerHTML = "";
    const nombreEl = document.getElementById("nombre-locacion");
    if (nombreEl) nombreEl.textContent = loc.nombre;
    loc.cancha.forEach(can => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      li.style.marginBottom = "10px";
      const a = document.createElement("a");
      a.href = `cancha.html?loc=${locId}&can=${can.id}`;
      a.textContent = can.nombre;
      a.classList.add("link-blanco");
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (err) {
    console.error("Error en populateCanchas():", err);
  }
}

async function populateLados() {
  try {
    const params = getQueryParams();
    const locId = params.loc;
    const canId = params.can;
    const url = `data/config_locations.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const config = await res.json();
    const loc = config.locaciones.find(l => l.id === locId);
    const cancha = loc?.cancha.find(c => c.id === canId);
    const ul = document.getElementById("lados-lista");
    if (!ul || !loc || !cancha) return;
    ul.innerHTML = "";
    const linkClub = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    if (linkClub) {
      linkClub.textContent = loc.nombre;
      linkClub.href = `locacion.html?loc=${locId}`;
    }
    if (linkCancha) {
      linkCancha.textContent = cancha.nombre;
      linkCancha.href = "#";
    }
    const sep2 = document.getElementById("breadcrumb-sep2");
    if (sep2) sep2.style.display = "none";
    const nombreLado = document.getElementById("nombre-lado");
    if (nombreLado) nombreLado.style.display = "none";

    cancha.lados.forEach(lado => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      li.style.marginBottom = "10px";
      const a = document.createElement("a");
      a.href = `lado.html?loc=${locId}&can=${canId}&lado=${lado.id}`;
      a.textContent = lado.nombre || lado.id;
      a.classList.add("link-blanco");
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (err) {
    console.error("Error en populateLados():", err);
  }
}

// ----------------------- video + filtros -----------------------
let allVideos = [];
let visibilityMap = new Map(); // (se mantiene aunque ya no se usa activamente)
let currentPreviewActive = null; // (se mantiene para mínimo cambio)

function createHourFilterUI(videos) {
  const params = getQueryParams();
  const filtroHoraActivo = params.filtro;
  const filtroDiv = document.getElementById("filtro-horario");
  if (!filtroDiv) return;
  filtroDiv.innerHTML = "";
  const horasSet = new Set();

  videos.forEach(v => {
    const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
    if (m) horasSet.add(m[1]);
  });
  [...horasSet].sort().forEach(h => {
    const btn = document.createElement("button");
    btn.textContent = `${formatAmPm(h)} - ${formatAmPm((+h + 1) % 24)}`;
    btn.className = "btn-filtro";
    if (filtroHoraActivo === h) btn.classList.add("activo");
    btn.addEventListener("click", () => {
      const p = getQueryParams();
      window.location.href = `lado.html?loc=${p.loc}&can=${p.can}&lado=${p.lado}&filtro=${h}`;
    });
    filtroDiv.appendChild(btn);
  });

  const quitarBtn = document.createElement("button");
  quitarBtn.textContent = "Quitar filtro";
  quitarBtn.className = "btn-filtro quitar";
  if (!filtroHoraActivo) quitarBtn.style.display = "none";
  quitarBtn.addEventListener("click", () => {
    const p = getQueryParams();
    window.location.href = `lado.html?loc=${p.loc}&can=${p.can}&lado=${p.lado}`;
  });
  filtroDiv.appendChild(quitarBtn);
  filtroDiv.style.display = "flex";
}

/* === NUEVO: preview estático (frame a 20 s del final) === */
function createStaticPreviewImage(videoSrc, declaredDuration, parentCard, onClickShowReal) {
  const img = document.createElement("img");
  img.className = "video-preview-img";
  img.alt = "Vista previa";
  img.style.width = "100%";
  img.style.borderRadius = "6px";
  img.style.display = "block";
  img.decoding = "async";
  img.loading = "lazy";

  const fallbackSVG =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <defs><style>
          .bg{fill:#111}
          .txt{fill:#fff;font: 48px sans-serif}
          .tri{fill:#fff}
        </style></defs>
        <rect class="bg" width="1280" height="720" rx="24"/>
        <polygon class="tri" points="520,360 520,260 720,360 520,460"/>
        <text class="txt" x="50%" y="85%" text-anchor="middle">Toca para reproducir</text>
      </svg>`
    );

  // Intento de generar thumbnail real con <video> temporal + canvas
  (async () => {
    try {
      const vid = document.createElement("video");
      vid.crossOrigin = "anonymous";
      vid.preload = "metadata";
      vid.src = videoSrc;
      vid.muted = true; // algunos navegadores requieren mute para manipular

      const ensureMeta = new Promise((res, rej) => {
        vid.addEventListener("loadedmetadata", () => res(), { once: true });
        vid.addEventListener("error", () => rej(new Error("metadata error")), { once: true });
      });

      // Cargar metadatos
      await ensureMeta;

      const dur = Number.isFinite(declaredDuration) && declaredDuration > 0
        ? declaredDuration
        : (isFinite(vid.duration) ? vid.duration : 60);

      const target = Math.max(0, dur - 20);

      const seeked = new Promise((res, rej) => {
        vid.currentTime = Math.min(target, (vid.duration || target));
        vid.addEventListener("seeked", () => res(), { once: true });
        vid.addEventListener("error", () => rej(new Error("seek error")), { once: true });
      });

      await seeked;

      const canvas = document.createElement("canvas");
      const w = vid.videoWidth || 1280;
      const h = vid.videoHeight || 720;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(vid, 0, 0, w, h);

      try {
        img.src = canvas.toDataURL("image/jpeg", 0.7);
      } catch {
        img.src = fallbackSVG;
      }

      // liberar
      vid.src = "";
    } catch {
      img.src = fallbackSVG;
    }
  })();

  img.addEventListener("click", onClickShowReal);
  parentCard.appendChild(img);
  return img;
}

/* (Se mantiene por compatibilidad: exclusión de reproducción entre reales) */
function setupMutualExclusion(list) {
  list.forEach(v => v.addEventListener("play", () => {
    list.forEach(o => { if (o !== v) o.pause(); });
  }));
}

// (Ya no se usa la precarga de previews de video)
// async function loadPreviewsSequentially(previews) { ... }  // eliminado

async function crearBotonAccionCompartir(entry) {
  const btn = document.createElement("button");
  btn.className = "btn-share-large";
  btn.textContent = "Compartir | Descargar";
  btn.title = "Compartir video";
  btn.setAttribute("aria-label", "Compartir video");

  btn.addEventListener("click", async e => {
    e.preventDefault();
    const orig = btn.textContent;
    btn.textContent = "Espera un momento...";
    btn.disabled = true;
    try {
      const res = await fetch(entry.url);
      const blob = await res.blob();
      const file = new File([blob], entry.nombre, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Video Puntazo",
          text: "Mira este _*PUNTAZO*_ \n www.puntazoclips.com"
        });
      }
    } catch (err) {
      console.warn("Share sheet falló:", err);
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  });

  return btn;
}

async function populateVideos() {
  const params = getQueryParams();
  const { loc, can, lado, filtro, video: targetId } = params;
  const urlCfg = `data/config_locations.json?cb=${Date.now()}`;
  try {
    const resCfg = await fetch(urlCfg, { cache: "no-store" });
    const cfg = await resCfg.json();
    const locObj = cfg.locaciones.find(l => l.id === loc);
    const canObj = locObj?.cancha.find(c => c.id === can);
    const ladoObj = canObj?.lados.find(l => l.id === lado);
    if (!ladoObj?.json_url) {
      const el = document.getElementById("videos-container");
      if (el) el.innerHTML = "<p style='color:#fff;'>Lado no encontrado.</p>";
      return;
    }

    const res = await fetch(`${ladoObj.json_url}?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo acceder al JSON.");
    const data = await res.json();
    const container = document.getElementById("videos-container");
    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "block";
    container.innerHTML = "";

    // Breadcrumbs
    const linkClub = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    const nombreLado = document.getElementById("nombre-lado");
    if (linkClub) { linkClub.textContent = locObj.nombre; linkClub.href = `locacion.html?loc=${loc}`; }
    if (linkCancha) { linkCancha.textContent = canObj.nombre; linkCancha.href = `cancha.html?loc=${loc}&can=${can}`; }
    if (nombreLado) nombreLado.textContent = ladoObj.nombre;

    // Filtro horario
    createHourFilterUI(data.videos);

    // Aplica filtro si existe
    let list = data.videos;
    if (filtro) {
      list = list.filter(v => {
        const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
        return m && m[1] === filtro;
      });
    }

    allVideos = [];
    for (const entry of list) {
      // Calcula displayTime
      const m = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
      let displayTime = entry.nombre.replace(".mp4", "");
      if (m) {
        const hr = parseInt(m[1],10), mn = m[2], ap = hr>=12?"PM":"AM";
        displayTime = `${hr%12||12}:${mn} ${ap}`;
      }

      // Card
      const card = document.createElement("div");
      card.className = "video-card";
      card.id = entry.nombre;

      const title = document.createElement("div");
      title.className = "video-title";
      title.textContent = displayTime;
      card.appendChild(title);

      // Wrapper
      const wrap = document.createElement("div");
      wrap.style.position = "relative";
      wrap.style.width = "100%";

      // Real video (oculto)
      const real = document.createElement("video");
      real.className = "real";
      real.controls = true;
      real.playsInline = true;
      real.preload = "metadata";
      real.src = entry.url;
      real.style.display = "none";
      real.style.width = "100%";
      real.style.borderRadius = "6px";

      // NUEVO: Preview estático (imagen de t = duración-20 s)
      const onShowReal = () => {
        const previewImg = wrap.querySelector("img.video-preview-img");
        if (previewImg) previewImg.style.display = "none";
        real.style.display = "block";
        real.currentTime = 0;
        real.play().catch(()=>{});
      };
      createStaticPreviewImage(entry.url, entry.duracion || 60, wrap, onShowReal);

      wrap.appendChild(real);
      card.appendChild(wrap);

      // Contenedor de botones
      const btnContainer = document.createElement("div");
      btnContainer.className = "botones-container";
      btnContainer.style.display = "flex";
      btnContainer.style.alignItems = "center";
      btnContainer.style.marginTop = "12px";

      // Botón compartir/descargar
      const actionBtn = await crearBotonAccionCompartir(entry);
      actionBtn.style.removeProperty('flex');
      btnContainer.appendChild(actionBtn);

      // Botón "Ver otra perspectiva"
      (async () => {
        try {
          const opposite = await findOppositeVideo(entry, cfg, loc, can, lado);
          if (opposite && opposite.nombre) {
            const btnAlt = document.createElement("a");
            btnAlt.className = "btn-alt";
            btnAlt.textContent = "Ver otra perspectiva";
            btnAlt.title = "Cambiar a la otra cámara";
            btnAlt.href = `lado.html?loc=${loc}&can=${can}&lado=${opposite.lado}&video=${encodeURIComponent(opposite.nombre)}`;
            btnContainer.appendChild(btnAlt);
          }
        } catch (e) {
          // silencioso
        }
      })();

      card.appendChild(btnContainer);

      container.appendChild(card);
      allVideos.push(real);
    }

    setupMutualExclusion(allVideos);

    // (Eliminado) Carga previews de video en serie: ya no hay elementos <video> de preview

    if (loading) loading.style.display = "none";
    if (targetId) scrollToVideoById(targetId);
  } catch (err) {
    console.error("Error en populateVideos():", err);
    const vc = document.getElementById("videos-container");
    if (vc) vc.innerHTML = "<p style='color:#fff;'>No hay videos disponibles.</p>";
    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "none";
  }
}

// ----------------------- scroll-top -----------------------
function createScrollToTopBtn() {
  const btn = document.createElement("button");
  btn.textContent = "↑";
  btn.className = "scroll-top";
  btn.style.display = "none";
  btn.setAttribute("aria-label", "Ir arriba");
  btn.addEventListener("click", scrollToTop);
  document.body.appendChild(btn);

  let lastY = window.scrollY;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (y > 100 && y < lastY && allVideos.length > 3) btn.style.display = "block";
    else btn.style.display = "none";
    lastY = y;
  });
}

// ----------------------- arranque -----------------------
document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  const p = getQueryParams();

  (async () => {
    if (path.endsWith("index.html") || path.endsWith("/")) {
      populateLocaciones();
      return;
    }

    if (path.endsWith("locacion.html")) {
      populateCanchas();
      return;
    }

    if (path.endsWith("cancha.html")) {
      const ok = await requireCanchaPassword(p.loc, p.can);
      if (!ok) {
        // si canceló o falló, regresar al listado de canchas del club
        window.location.href = `locacion.html?loc=${p.loc}`;
        return;
      }
      populateLados();
      return;
    }

    if (path.endsWith("lado.html")) {
      const ok = await requireCanchaPassword(p.loc, p.can);
      if (!ok) {
        window.location.href = `cancha.html?loc=${p.loc}&can=${p.can}`;
        return;
      }
      populateVideos();
      createScrollToTopBtn();
      return;
    }
  })();

  const btnVolver = document.getElementById("btn-volver");
  if (btnVolver) {
    if (path.endsWith("lado.html")) {
      btnVolver.href = `cancha.html?loc=${p.loc}&can=${p.can}`;
    } else if (path.endsWith("cancha.html")) {
      btnVolver.href = `locacion.html?loc=${p.loc}`;
    } else if (path.endsWith("locacion.html")) {
      btnVolver.href = "index.html";
    }
  }
});

// Cierra navbar al scrollear o click fuera
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.navbar');

  if (btn && nav) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      nav.classList.toggle('show');
    });

    // cerrar al hacer click fuera
    document.addEventListener('click', (e) => {
      if (nav.classList.contains('show') && !nav.contains(e.target) && e.target !== btn) {
        nav.classList.remove('show');
      }
    });

    // cerrar al scrollear
    window.addEventListener('scroll', () => {
      if (nav.classList.contains('show')) nav.classList.remove('show');
    });
  }
});

// === NAVBAR: toggle + cerrar al scroll o click fuera ===
function initNavbar(){
  const btn = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.navbar');
  if (!btn || !nav) return;

  const close = () => nav.classList.remove('show');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    nav.classList.toggle('show');
  });

  // Cerrar al click fuera
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('show') && !nav.contains(e.target) && e.target !== btn) {
      close();
    }
  });

  // Cerrar al scrollear o al cambiar de tamaño
  window.addEventListener('scroll', close);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) close();
  });
}

// Llama al init junto con lo que ya tienes en DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
});
