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
let visibilityMap = new Map();
let currentPreviewActive = null;

// Estado para paginación
const PAGE_SIZE = 10;
let videosListaCompleta = [];      // lista final tras filtro horario
let paginacionHabilitada = false;
let paginaActual = 0;              // índice de página (0-based)
let cfgGlobal = null;              // cache config_locations para enlaces opuestos
let oppInfoCache = null;           // info de lado opuesto si existe {oppId, oppUrl, oppName}
let contenedorVideos = null;       // #videos-container
let contenedorControles = null;    // contenedor bajo la grilla para "ver más" + filtros abajo
let btnVerMas = null;              // botón de paginado
let contFiltroArriba = null;       // #filtro-horario (arriba)
let contFiltroAbajo = null;        // #filtro-horario-bottom (abajo)

// ---- Filtros (arriba y abajo sincronizados) ----
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

function ensureBottomControlsContainer() {
  // Crea contenedor bajo la grilla si no existe: incluye botón "Ver más" + barra filtros de abajo
  if (!contenedorControles) {
    contenedorControles = document.getElementById("bottom-controls");
    if (!contenedorControles) {
      contenedorControles = document.createElement("div");
      contenedorControles.id = "bottom-controls";
      contenedorControles.style.margin = "24px 0 12px 0";
      contenedorVideos.parentElement.insertBefore(contenedorControles, contenedorVideos.nextSibling);
    }
  }

  // Botón "Ver más"
  if (!btnVerMas) {
    btnVerMas = document.createElement("button");
    btnVerMas.id = "load-more-btn";
    btnVerMas.className = "btn-ver-mas";
    btnVerMas.textContent = "Ver más";
    btnVerMas.style.display = "none";
    btnVerMas.style.margin = "12px 0";
    btnVerMas.style.padding = "10px 16px";
    btnVerMas.style.borderRadius = "8px";
    btnVerMas.style.border = "none";
    btnVerMas.style.cursor = "pointer";
    btnVerMas.addEventListener("click", () => {
      // Avanza una página y renderiza, descargando la anterior
      paginaActual += 1;
      renderPaginaActual(true);
    });
    contenedorControles.appendChild(btnVerMas);
  }

  // Filtros abajo
  contFiltroAbajo = document.getElementById("filtro-horario-bottom");
  if (!contFiltroAbajo) {
    contFiltroAbajo = document.createElement("div");
    contFiltroAbajo.id = "filtro-horario-bottom";
    contFiltroAbajo.style.marginTop = "12px";
    contenedorControles.appendChild(contFiltroAbajo);
  }
}

function createHourFilterUI(videos) {
  // Arriba
  const filtroDiv = document.getElementById("filtro-horario");
  contFiltroArriba = filtroDiv || null;
  renderHourFilterIn(contFiltroArriba, videos);

  // Abajo (siempre visible arriba del footer)
  ensureBottomControlsContainer();
  renderHourFilterIn(contFiltroAbajo, videos);
}

// ---- Previews y videos ----
function createPreviewOverlay(videoSrc, duration, parentCard) {
  const preview = document.createElement("video");
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = "none"; // carga secuencial
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
  // guardar referencias para depuración/limpieza de recursos
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

// ---- Render de una página (10 máx) descargando completamente la anterior ----
function limpiarRecursosDePagina() {
  // Pausar preview activo
  try { if (currentPreviewActive) currentPreviewActive.pause(); } catch {}
  currentPreviewActive = null;

  // Reiniciar mapa de visibilidad
  visibilityMap = new Map();

  // Descargar videos DOM actuales del contenedor
  if (!contenedorVideos) return;
  const cards = Array.from(contenedorVideos.children);
  cards.forEach(card => {
    const real = card.querySelector("video.real");
    const prev = card.querySelector("video.video-preview");

    // Pausar y cortar flujos
    [real, prev].forEach(v => {
      if (!v) return;
      try { v.pause?.(); } catch {}
      // Desconectar observers y eventos del preview
      if (v === prev && v._observer) {
        try { v._observer.disconnect(); } catch {}
        v.removeEventListener?.("loadedmetadata", v._onLoadedMeta);
        v.removeEventListener?.("timeupdate", v._onTimeUpdate);
        v._observer = null;
      }
      // Cortar src y recargar para abortar cualquier descarga
      try { v.removeAttribute("src"); v.load?.(); } catch {}
    });
  });

  // Limpiar DOM
  contenedorVideos.innerHTML = "";
  allVideos = [];
}

function actualizarBotonVerMas(oppLinkHref) {
  if (!btnVerMas) return;

  const total = videosListaCompleta.length;
  const start = paginaActual * PAGE_SIZE;
  const quedan = total - (start + PAGE_SIZE);

  if (!paginacionHabilitada) {
    btnVerMas.style.display = "none";
    return;
  }

  if (quedan > 0) {
    btnVerMas.textContent = "Ver más";
    btnVerMas.onclick = () => {
      paginaActual += 1;
      renderPaginaActual(true);
    };
    btnVerMas.style.display = "inline-block";
  } else {
    // No quedan más videos en esta lista
    if (oppLinkHref) {
      btnVerMas.textContent = "Ir al lado opuesto";
      btnVerMas.onclick = () => { window.location.href = oppLinkHref; };
      btnVerMas.style.display = "inline-block";
    } else {
      btnVerMas.style.display = "none";
    }
  }
}

async function renderPaginaActual(fueCambioDePagina = false) {
  limpiarRecursosDePagina();

  const params = getQueryParams();
  const { loc, can, lado } = params;

  // Sublista a mostrar
  const start = paginaActual * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, videosListaCompleta.length);
  const pageSlice = videosListaCompleta.slice(start, end);

  // Render de cards
  for (const entry of pageSlice) {
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

    // Preview
    const preview = createPreviewOverlay(entry.url, entry.duracion||60, card);

    wrap.appendChild(real);
    wrap.appendChild(preview);
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

    // Botón "Ver otra perspectiva" (opuesto automático)
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
      } catch {
        // silencioso
      }
    })();

    card.appendChild(btnContainer);
    contenedorVideos.appendChild(card);
    allVideos.push(real);
  }

  setupMutualExclusion(allVideos);

  // Carga previews en serie solo para la página actual
  const previews = Array.from(contenedorVideos.querySelectorAll("video.video-preview"));
  loadPreviewsSequentially(previews);

  // Actualizar botón "Ver más" / "Ir al lado opuesto"
  let oppHref = null;
  if (oppInfoCache?.oppId) {
    oppHref = `lado.html?loc=${params.loc}&can=${params.can}&lado=${oppInfoCache.oppId}`;
  }
  actualizarBotonVerMas(oppHref);

  // Si fue cambio de página, desplazamos suavemente al inicio de las nuevas cards
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

    // Filtros arriba/abajo
    createHourFilterUI(data.videos);

    // Aplica filtro si existe
    let list = data.videos || [];
    if (filtro) {
      list = list.filter(v => {
        const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
        return m && m[1] === filtro;
      });
    }

    // Guardar lista completa y estado de paginación
    videosListaCompleta = list;
    paginacionHabilitada = videosListaCompleta.length > 7;
    paginaActual = 0;

    // Preparar contenedor de controles al pie (Ver más + filtros abajo)
    ensureBottomControlsContainer();

    // Resolver info de lado opuesto (para "Ir al lado opuesto" al final)
    oppInfoCache = await findOppositeConfig(cfgGlobal, loc, can, lado);

    // Si hay parámetro ?video=..., tratar de arrancar en la página que lo contiene
    if (targetId) {
      const idx = videosListaCompleta.findIndex(v => v.nombre === targetId);
      if (idx >= 0 && paginacionHabilitada) {
        paginaActual = Math.floor(idx / PAGE_SIZE);
      }
    }

    // Render inicial (con descarga total controlada entre páginas)
    await renderPaginaActual(false);

    if (loading) loading.style.display = "none";

    // Si venía ?video=..., hacemos scroll al card ya en la página correcta
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
