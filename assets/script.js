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
    return null;
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
  if (!rule) return true;
  if (!rule.enabled) return true;
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
  if (!rule || !rule.enabled) return true;

  if (isAuthorized(rule)) return true;

  for (let i = 0; i < 3; i++) {
    const input = window.prompt('Esta cancha requiere contraseña.');
    if (input === null) return false;
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
 * Opuesto: si la cancha tiene exactamente 2 lados, el opuesto es el otro.
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
 * Busca clip del lado opuesto con timestamp ±15s.
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

// ----------------------- video + filtros + paginación -----------------------
let allVideos = [];
let visibilityMap = new Map();
let currentPreviewActive = null;

// Estado de paginación
const PAGE_SIZE = 10;
let videosListaCompleta = [];
let paginacionHabilitada = false;
let paginaActual = 0; // 0-based
let cfgGlobal = null;
let oppInfoCache = null;
let contenedorVideos = null;

let contenedorTopControls = null;     // arriba: paginador superior
let contenedorBottomControls = null;  // abajo: paginador + filtros
let contFiltroArriba = null;
let contFiltroAbajo = null;

let ultimoFiltroActivo = null;

// ---- Helpers UI ----
function ensureTopControlsContainer() {
  if (!contenedorTopControls) {
    contenedorTopControls = document.getElementById("top-controls");
    if (!contenedorTopControls) {
      contenedorTopControls = document.createElement("div");
      contenedorTopControls.id = "top-controls";
      contenedorTopControls.style.margin = "12px 0";
      const parent = contenedorVideos?.parentElement;
      if (parent) parent.insertBefore(contenedorTopControls, contenedorVideos);
    }
  }
  // Paginador superior
  let pagTop = document.getElementById("paginator-top");
  if (!pagTop) {
    pagTop = document.createElement("div");
    pagTop.id = "paginator-top";
    contenedorTopControls.appendChild(pagTop);
  }
}

function ensureBottomControlsContainer() {
  if (!contenedorBottomControls) {
    contenedorBottomControls = document.getElementById("bottom-controls");
    if (!contenedorBottomControls) {
      contenedorBottomControls = document.createElement("div");
      contenedorBottomControls.id = "bottom-controls";
      contenedorBottomControls.style.margin = "24px 0 12px 0";
      contenedorVideos.parentElement.insertBefore(contenedorBottomControls, contenedorVideos.nextSibling);
    }
  }
  // Paginador inferior
  let pagBottom = document.getElementById("paginator-bottom");
  if (!pagBottom) {
    pagBottom = document.createElement("div");
    pagBottom.id = "paginator-bottom";
    contenedorBottomControls.appendChild(pagBottom);
  }
  // Filtros abajo
  contFiltroAbajo = document.getElementById("filtro-horario-bottom");
  if (!contFiltroAbajo) {
    contFiltroAbajo = document.createElement("div");
    contFiltroAbajo.id = "filtro-horario-bottom";
    contFiltroAbajo.style.marginTop = "12px";
    contenedorBottomControls.appendChild(contFiltroAbajo);
  }
}

function renderPaginator(container, totalItems, pageIndex, pageSize, onChange, oppHref) {
  if (!container) return;
  container.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages === 1) return;

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.alignItems = "center";
  wrap.style.gap = "8px";

  const btn = (label, disabled, handler, title) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title || label;
    b.disabled = !!disabled;
    b.style.padding = "6px 10px";
    b.style.border = "none";
    b.style.borderRadius = "8px";
    b.style.cursor = disabled ? "default" : "pointer";
    b.addEventListener("click", handler);
    return b;
  };

  // Prev
  wrap.appendChild(btn("‹ Anterior", pageIndex === 0, () => onChange(pageIndex - 1), "Página anterior"));

  // Números (ventana de hasta 5)
  const windowSize = 5;
  let start = Math.max(0, pageIndex - Math.floor(windowSize / 2));
  let end = Math.min(totalPages - 1, start + windowSize - 1);
  start = Math.max(0, Math.min(start, Math.max(0, end - windowSize + 1)));

  for (let i = start; i <= end; i++) {
    const num = document.createElement("button");
    num.textContent = String(i + 1);
    num.style.padding = "6px 10px";
    num.style.border = "none";
    num.style.borderRadius = "8px";
    num.style.cursor = "pointer";
    if (i === pageIndex) {
      num.style.fontWeight = "700";
      num.style.outline = "1px solid rgba(255,255,255,0.3)";
    }
    num.addEventListener("click", () => onChange(i));
    wrap.appendChild(num);
  }

  // Next (o Ir al lado opuesto si estás en la última página)
  if (pageIndex < totalPages - 1) {
    wrap.appendChild(btn("Siguiente ›", false, () => onChange(pageIndex + 1), "Página siguiente"));
  } else if (oppHref) {
    const opp = document.createElement("a");
    opp.textContent = "Ir al lado opuesto";
    opp.href = oppHref;
    opp.style.padding = "6px 10px";
    opp.style.borderRadius = "8px";
    opp.style.textDecoration = "none";
    opp.style.outline = "1px solid rgba(255,255,255,0.3)";
    wrap.appendChild(opp);
  }

  // Info “Mostrando X–Y de Z”
  const info = document.createElement("span");
  const first = pageIndex * pageSize + 1;
  const last = Math.min((pageIndex + 1) * pageSize, totalItems);
  info.textContent = `Mostrando ${first}–${last} de ${totalItems}`;
  info.style.marginLeft = "auto";
  info.style.opacity = "0.8";
  wrap.appendChild(info);

  container.appendChild(wrap);
}

// ---- Filtros (arriba y abajo idénticos, con navegación por URL clásica) ----
function renderHourFilterIn(container, videos) {
  if (!container) return;
  const params = getQueryParams();
  const filtroHoraActivo = params.filtro;

  container.innerHTML = "";
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
    container.appendChild(btn);
  });

  const quitarBtn = document.createElement("button");
  quitarBtn.textContent = "Quitar filtro";
  quitarBtn.className = "btn-filtro quitar";
  if (!filtroHoraActivo) quitarBtn.style.display = "none";
  quitarBtn.addEventListener("click", () => {
    const p = getQueryParams();
    window.location.href = `lado.html?loc=${p.loc}&can=${p.can}&lado=${p.lado}`;
  });
  container.appendChild(quitarBtn);
  container.style.display = "flex";
}

function createHourFilterUI(videos) {
  // Arriba
  const filtroDiv = document.getElementById("filtro-horario");
  contFiltroArriba = filtroDiv || null;
  renderHourFilterIn(contFiltroArriba, videos);

  // Abajo (misma estructura y orden)
  ensureBottomControlsContainer();
  renderHourFilterIn(contFiltroAbajo, videos);
}

// ---- Previews / reproducción ----
function createPreviewOverlay(videoSrc, duration, parentCard) {
  const preview = document.createElement("video");
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = "none";
  preview.src = videoSrc;
  preview.className = "video-preview";
  preview.setAttribute("aria-label", "Vista previa");

  let start = duration > 15 ? duration - 15 : 0;
  const len = 5, end = start + len;

  const onLoadedMeta = () => { try { preview.currentTime = start; } catch {} };
  const onTimeUpdate = () => {
    try { if (preview.currentTime >= end) preview.currentTime = start; } catch {}
  };
  preview.addEventListener("loadedmetadata", onLoadedMeta);
  preview.addEventListener("timeupdate", onTimeUpdate);

  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      visibilityMap.set(preview, entry.intersectionRatio);
      let max = 0, winner = null;
      visibilityMap.forEach((ratio, node) => {
        if (ratio > max) [max, winner] = [ratio, node];
      });
      if (winner === preview && entry.isIntersecting) {
        const realPlaying = parentCard.querySelector("video.real")?.paused === false;
        if (!realPlaying) {
          if (currentPreviewActive && currentPreviewActive !== preview) currentPreviewActive.pause();
          currentPreviewActive = preview;
          preview.play().catch(() => {});
        }
      } else {
        preview.pause();
      }
    });
  }, { threshold: [0.25, 0.5, 0.75] });

  io.observe(preview);
  preview._observer = io;
  preview._onLoadedMeta = onLoadedMeta;
  preview._onTimeUpdate = onTimeUpdate;

  preview.addEventListener("click", () => {
    const realVideo = parentCard.querySelector("video.real");
    if (realVideo) {
      preview.style.display = "none";
      realVideo.style.display = "block";
      realVideo.currentTime = 0;
      realVideo.play();
    }
  });

  return preview;
}

function setupMutualExclusion(list) {
  list.forEach(v => v.addEventListener("play", () => {
    list.forEach(o => { if (o !== v) o.pause(); });
  }));
}

async function loadPreviewsSequentially(previews) {
  for (const v of previews) {
    v.preload = "metadata"; // solo cabeceras; sin buffering pesado
    await new Promise(res => {
      v.addEventListener("loadedmetadata", res, { once: true });
      v.load();
    });
  }
}

// Pausar todo y desactivar preloads (para priorizar acciones como compartir)
function pauseAllVideos() {
  try { if (currentPreviewActive) currentPreviewActive.pause(); } catch {}
  document.querySelectorAll("video.video-preview, video.real").forEach(v => {
    try { v.pause(); } catch {}
    try { v.preload = "none"; } catch {}
  });
}

async function crearBotonAccionCompartir(entry) {
  const btn = document.createElement("button");
  btn.className = "btn-share-large";
  btn.textContent = "Compartir | Descargar";
  btn.title = "Compartir video";
  btn.setAttribute("aria-label", "Compartir video");

  btn.addEventListener("click", async e => {
    e.preventDefault();
    const orig = btn.textContent;
    btn.textContent = "Abriendo opciones…";
    btn.disabled = true;

    // Priorizar esta acción: pausar todo y cortar preloads
    pauseAllVideos();

    try {
      // Compartir rápido con URL (sin descargar el archivo)
      if (navigator.share) {
        await navigator.share({
          title: "Video Puntazo",
          text: "Mira este _*PUNTAZO*_",
          url: entry.url
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(entry.url);
        alert("Enlace copiado al portapapeles.");
      } else {
        window.open(entry.url, "_blank");
      }
    } catch (err) {
      console.warn("Share falló:", err);
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(entry.url);
          alert("Enlace copiado al portapapeles.");
        }
      } catch {}
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  });

  return btn;
}

// ---- Render de página con descarga completa de la anterior ----
function limpiarRecursosDePagina() {
  try { if (currentPreviewActive) currentPreviewActive.pause(); } catch {}
  currentPreviewActive = null;
  visibilityMap = new Map();

  if (!contenedorVideos) return;
  const cards = Array.from(contenedorVideos.children);
  cards.forEach(card => {
    const real = card.querySelector("video.real");
    const prev = card.querySelector("video.video-preview");

    [real, prev].forEach(v => {
      if (!v) return;
      try { v.pause?.(); } catch {}
      if (v === prev && v._observer) {
        try { v._observer.disconnect(); } catch {}
        v.removeEventListener?.("loadedmetadata", v._onLoadedMeta);
        v.removeEventListener?.("timeupdate", v._onTimeUpdate);
        v._observer = null;
      }
      try { v.removeAttribute("src"); v.load?.(); } catch {}
    });
  });

  contenedorVideos.innerHTML = "";
  allVideos = [];
}

async function renderPaginaActual({ fueCambioDePagina = false } = {}) {
  limpiarRecursosDePagina();

  const params = getQueryParams();
  const { loc, can, lado } = params;

  const start = paginaActual * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, videosListaCompleta.length);
  const pageSlice = videosListaCompleta.slice(start, end);

  for (const entry of pageSlice) {
    // displayTime
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

    // Preview
    const preview = createPreviewOverlay(entry.url, entry.duracion||60, card);

    wrap.appendChild(real);
    wrap.appendChild(preview);
    card.appendChild(wrap);

    // Botones
    const btnContainer = document.createElement("div");
    btnContainer.className = "botones-container";
    btnContainer.style.display = "flex";
    btnContainer.style.alignItems = "center";
    btnContainer.style.marginTop = "12px";

    const actionBtn = await crearBotonAccionCompartir(entry);
    actionBtn.style.removeProperty('flex');
    btnContainer.appendChild(actionBtn);

    (async () => {
      try {
        const opposite = await findOppositeVideo(entry, cfgGlobal, loc, can, lado);
        if (opposite && opposite.nombre) {
          const btnAlt = document.createElement("a");
          btnAlt.className = "btn-alt";
          btnAlt.textContent = "Ver otra perspectiva";
          btnAlt.title = "Cambiar a la otra cámara";
          btnAlt.href = `lado.html?loc=${loc}&can=${can}&lado=${opposite.lado}&video=${encodeURIComponent(opposite.nombre)}`;
          btnContainer.appendChild(btnAlt);
        }
      } catch {}
    })();

    card.appendChild(btnContainer);
    contenedorVideos.appendChild(card);
    allVideos.push(real);
  }

  setupMutualExclusion(allVideos);

  // Carga previews en serie SOLO de esta página
  const previews = Array.from(contenedorVideos.querySelectorAll("video.video-preview"));
  loadPreviewsSequentially(previews);

  // Paginadores (arriba/abajo)
  const total = videosListaCompleta.length;
  const params2 = getQueryParams();
  const oppHref = oppInfoCache?.oppId
    ? `lado.html?loc=${params2.loc}&can=${params2.can}&lado=${oppInfoCache.oppId}`
    : null;

  const pagTop = document.getElementById("paginator-top");
  const pagBottom = document.getElementById("paginator-bottom");

  const onChange = (newPage) => {
    if (newPage < 0) newPage = 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (newPage > totalPages - 1) newPage = totalPages - 1;
    paginaActual = newPage;
    renderPaginaActual({ fueCambioDePagina: true });
    scrollToTop();
  };

  renderPaginator(pagTop, total, paginaActual, PAGE_SIZE, onChange, oppHref);
  renderPaginator(pagBottom, total, paginaActual, PAGE_SIZE, onChange, oppHref);

  // Desplazamiento suave al inicio del bloque nuevo
  if (fueCambioDePagina && contenedorVideos.firstElementChild) {
    contenedorVideos.firstElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function populateVideos() {
  const params = getQueryParams();
  const { loc, can, lado, filtro, video: targetId } = params;
  const urlCfg = `data/config_locations.json?cb=${Date.now()}`;

  try {
    const resCfg = await fetch(urlCfg, { cache: "no-store" });
    cfgGlobal = await resCfg.json();

    const locObj = cfgGlobal.locaciones.find(l => l.id === loc);
    const canObj = locObj?.cancha.find(c => c.id === can);
    const ladoObj = canObj?.lados.find(l => l.id === lado);
    contenedorVideos = document.getElementById("videos-container");
    const loading = document.getElementById("loading");
    if (!ladoObj?.json_url || !contenedorVideos) {
      if (contenedorVideos) contenedorVideos.innerHTML = "<p style='color:#fff;'>Lado no encontrado.</p>";
      return;
    }

    const res = await fetch(`${ladoObj.json_url}?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo acceder al JSON.");
    const data = await res.json();
    if (loading) loading.style.display = "block";
    contenedorVideos.innerHTML = "";

    // Breadcrumbs
    const linkClub = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    const nombreLado = document.getElementById("nombre-lado");
    if (linkClub) { linkClub.textContent = locObj?.nombre || loc; linkClub.href = `locacion.html?loc=${loc}`; }
    if (linkCancha) { linkCancha.textContent = canObj?.nombre || can; linkCancha.href = `cancha.html?loc=${loc}&can=${can}`; }
    if (nombreLado) nombreLado.textContent = ladoObj?.nombre || lado;

    // Filtros arriba/abajo (idénticos)
    createHourFilterUI(data.videos);

    // Aplica filtro si existe
    let list = data.videos || [];
    if (filtro) {
      list = list.filter(v => {
        const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
        return m && m[1] === filtro;
      });
    }

    ultimoFiltroActivo = filtro || null;

    // Guardar lista completa y estado de paginación
    videosListaCompleta = list;
    paginacionHabilitada = videosListaCompleta.length > 7;

    // Preparar contenedores de paginación
    ensureTopControlsContainer();
    ensureBottomControlsContainer();

    // Resolver info de lado opuesto (para el link cuando estás en la última página)
    oppInfoCache = await findOppositeConfig(cfgGlobal, loc, can, lado);

    // Calcular página inicial
    const totalPages = Math.max(1, Math.ceil(videosListaCompleta.length / PAGE_SIZE));
    paginaActual = 0;

    // Si viene ?video=, ubicar la página donde está
    if (targetId) {
      const idx = videosListaCompleta.findIndex(v => v.nombre === targetId);
      if (idx >= 0 && paginacionHabilitada) paginaActual = Math.floor(idx / PAGE_SIZE);
    }
    paginaActual = Math.min(Math.max(0, paginaActual), totalPages - 1);

    // Render inicial
    await renderPaginaActual({ fueCambioDePagina: false });

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

    document.addEventListener('click', (e) => {
      if (nav.classList.contains('show') && !nav.contains(e.target) && e.target !== btn) {
        nav.classList.remove('show');
      }
    });

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

  document.addEventListener('click', (e) => {
    if (nav.classList.contains('show') && !nav.contains(e.target) && e.target !== btn) {
      close();
    }
  });

  window.addEventListener('scroll', close);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) close();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
});