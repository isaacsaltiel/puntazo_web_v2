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

function setQueryParams(updates = {}, replace = false) {
  const p = getQueryParams();
  const next = { ...p, ...updates };
  const qs = Object.entries(next)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${location.pathname}${qs ? "?" + qs : ""}`;
  if (replace) history.replaceState({}, "", url);
  else history.pushState({}, "", url);
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
 * Parsea nombres tipo: Loc_Can_Lado_YYYYMMDD_HHMMSS.mp4
 * Devuelve también tsKey = YYYYMMDDHHMMSS como número para ordenar sin zonas horarias.
 */
function parseFromName(name) {
  const re = /^(.+?)_(.+?)_(.+?)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/;
  const m = name.match(re);
  if (!m) return null;
  const [, loc, can, lado, Y, M, D, h, mi, s] = m;
  const tsKey = Number(`${Y}${M}${D}${h}${mi}${s}`);
  const date = new Date(Number(Y), Number(M) - 1, Number(D), Number(h), Number(mi), Number(s));
  return { loc, can, lado, date, tsKey, ymd: `${Y}${M}${D}`, h: Number(h), mi: Number(mi), s: Number(s) };
}
function absSeconds(a, b) { return Math.abs((a - b) / 1000); }

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

// ----------------------- PROMOCIONES (club → promo) -----------------------
let _clubPromos = null;
let _promoDefs = null;

/**
 * Carga asignación club→promo.
 * Soporta: data/club_promotions.json  ó  data/flow_promotions.json
 * Formato esperado:
 * {
 *   "Scorpion": "luckia",
 *   "OtroClub": "otra_promo"
 * }
 */
async function loadClubPromotions() {
  if (_clubPromos) return _clubPromos;
  const tryFiles = [
    "data/club_promotions.json",
    "data/flow_promotions.json" // compat
  ];
  for (const path of tryFiles) {
    try {
      const r = await fetch(`${path}?cb=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      // Si viniera envuelto (e.g., { clubs: { Scorpion: "luckia" } }), desenrollamos
      const map = j?.clubs || j?.promotions || j;
      if (map && typeof map === "object") {
        _clubPromos = map;
        return _clubPromos;
      }
    } catch { /* sigue con el siguiente */ }
  }
  _clubPromos = {};
  return _clubPromos;
}

/**
 * Carga definiciones de promociones.
 * Soporta: data/promotions_config.json  ó  data/promotion_config.json
 * Formato:
 * {
 *   "luckia": {
 *     "text": "Regístrate con Luckia",
 *     "url": "https://www.luckia.mx",
 *     "color": "#EA5B0C",
 *     "logo": "logos/luckia.png"
 *   }
 * }
 */
async function loadPromotionDefinitions() {
  if (_promoDefs) return _promoDefs;
  const tryFiles = [
    "data/promotions_config.json",
    "data/promotion_config.json" // compat
  ];
  for (const path of tryFiles) {
    try {
      const r = await fetch(`${path}?cb=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && typeof j === "object") {
        _promoDefs = j;
        return _promoDefs;
      }
    } catch {/* siguiente */}
  }
  _promoDefs = {};
  return _promoDefs;
}

/**
 * Construye el botón de promoción para el club dado (si corresponde).
 * Retorna {el, applied} donde el es el elemento <a> o null.
 */
async function buildPromoButtonForClub(locId) {
  const clubMap = await loadClubPromotions();
  const promoId = clubMap?.[locId];
  if (!promoId) return { el: null, applied: false };

  const defs = await loadPromotionDefinitions();
  const conf = defs?.[promoId];
  if (!conf) return { el: null, applied: false };

  const color = conf.color || "#EA5B0C"; // naranja solicitado
  const text = conf.text || "Ir a Luckia";
  const href = conf.url || "#";
  const logo = conf.logo || "logos/luckia.png";

  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.className = "btn-promo"; // si existe en CSS, se verá con tu estilo
  // Fallback visual por si no está la clase en CSS
  a.style.display = "inline-flex";
  a.style.alignItems = "center";
  a.style.justifyContent = "center";
  a.style.gap = "10px";
  a.style.padding = "12px 16px";
  a.style.border = "1px solid #fff";
  a.style.borderRadius = "10px";
  a.style.fontWeight = "700";
  a.style.textDecoration = "none";
  a.style.color = "#fff";
  a.style.background = color;
  a.style.width = "100%";
  a.style.minHeight = "44px";
  a.style.boxSizing = "border-box";

  if (logo) {
    const img = document.createElement("img");
    img.src = logo;
    img.alt = "Luckia";
    img.loading = "lazy";
    img.style.height = "20px";
    img.style.width = "auto";
    img.style.objectFit = "contain";
    a.appendChild(img);
  }

  const span = document.createElement("span");
  span.textContent = text;
  span.style.whiteSpace = "nowrap";
  a.appendChild(span);

  return { el: a, applied: true };
}

// ----------------------- video + filtros + paginación -----------------------
let allVideos = [];
let visibilityMap = new Map();
let currentPreviewActive = null;

const PAGE_SIZE = 10;
let videosListaCompleta = [];
let paginacionHabilitada = false;
let paginaActual = 0;
let cfgGlobal = null;
let oppInfoCache = null;
let contenedorVideos = null;

let contenedorBottomControls = null;
let contFiltroArriba = null;
let contFiltroAbajo = null;
let ultimoFiltroActivo = null;

// ---------- Botón fijo de "Ir al lado opuesto" junto a "Regresar a la cancha" ----------
let btnOppTopEl = null;
function ensureOppositeTopButton(oppHref, oppName) {
  const btnVolver = document.getElementById("btn-volver");
  if (!btnVolver) return;

  const parent = btnVolver.parentElement || document.body;
  const csParent = window.getComputedStyle(parent);
  if (csParent.display !== "flex") {
    parent.style.display = "flex";
    parent.style.alignItems = "center";
    parent.style.gap = parent.style.gap || "8px";
    parent.style.justifyContent = parent.style.justifyContent || "space-between";
  } else if (!parent.style.justifyContent) {
    parent.style.justifyContent = "space-between";
  }

  if (!btnOppTopEl) {
    btnOppTopEl = document.createElement("a");
    btnOppTopEl.id = "btn-opposite-top";
    if (btnVolver.className) btnOppTopEl.className = btnVolver.className;
    else btnOppTopEl.className = "btn-alt";
    btnOppTopEl.textContent = "Ir al lado opuesto";
    btnOppTopEl.title = "Cambiar a la otra cámara";
    btnOppTopEl.setAttribute("aria-label", "Ir al lado opuesto");
    btnOppTopEl.style.marginLeft = "auto";
    try {
      const cs = window.getComputedStyle(btnVolver);
      btnOppTopEl.style.padding = btnOppTopEl.style.padding || cs.padding;
      btnOppTopEl.style.borderRadius = btnOppTopEl.style.borderRadius || cs.borderRadius;
      btnOppTopEl.style.fontSize = btnOppTopEl.style.fontSize || cs.fontSize;
      btnOppTopEl.style.lineHeight = btnOppTopEl.style.lineHeight || cs.lineHeight;
    } catch {}
    parent.appendChild(btnOppTopEl);
  }

  if (oppHref) {
    btnOppTopEl.href = oppHref;
    btnOppTopEl.style.display = "";
    if (oppName) btnOppTopEl.title = `Cambiar a ${oppName}`;
  } else {
    btnOppTopEl.style.display = "none";
  }
}

// ---- Contenedor inferior (solo paginador abajo) ----
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
  let pagBottom = document.getElementById("paginator-bottom");
  if (!pagBottom) {
    pagBottom = document.createElement("div");
    pagBottom.id = "paginator-bottom";
    contenedorBottomControls.appendChild(pagBottom);
  }
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
  if (totalPages === 1 && !oppHref) return;

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.alignItems = "center";
  wrap.style.gap = "8px";

  const mkBtn = (label, disabled, handler, title) => {
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

  wrap.appendChild(mkBtn("‹ Anterior", pageIndex === 0, () => onChange(pageIndex - 1), "Página anterior"));

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
    num.style.cursor = i === pageIndex ? "default" : "pointer";
    if (i === pageIndex) {
      num.disabled = true;
      num.setAttribute("aria-current", "page");
      num.style.fontWeight = "700";
      num.style.outline = "1px solid rgba(255,255,255,0.3)";
    }
    num.addEventListener("click", () => onChange(i));
    wrap.appendChild(num);
  }

  wrap.appendChild(mkBtn("Siguiente ›", pageIndex >= totalPages - 1, () => onChange(pageIndex + 1), "Página siguiente"));

  const info = document.createElement("span");
  const first = totalItems === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min((pageIndex + 1) * pageSize, totalItems);
  const pageLabel = totalPages > 1 ? ` · Página ${pageIndex + 1}/${totalPages}` : "";
  info.textContent = `Mostrando ${first}–${last} de ${totalItems}${pageLabel}`;
  info.style.marginLeft = "auto";
  info.style.opacity = "0.85";
  wrap.appendChild(info);

  if (oppHref) {
    const opp = document.createElement("a");
    opp.textContent = "Ir al lado opuesto";
    const btnVolver = document.getElementById("btn-volver");
    if (btnVolver && btnVolver.className) {
      opp.className = btnVolver.className;
    } else {
      opp.className = "btn-alt";
    }
    opp.href = oppHref;
    wrap.appendChild(opp);
  }

  container.appendChild(wrap);
}

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
      setQueryParams({ filtro: h, pg: 0, video: "" });
      populateVideos();
      scrollToTop();
    });
    container.appendChild(btn);
  });

  const quitarBtn = document.createElement("button");
  quitarBtn.textContent = "Quitar filtro";
  quitarBtn.className = "btn-filtro quitar";
  if (!filtroHoraActivo) quitarBtn.style.display = "none";
  quitarBtn.addEventListener("click", () => {
    setQueryParams({ filtro: "", pg: 0, video: "" });
    populateVideos();
    scrollToTop();
  });
  container.appendChild(quitarBtn);
  container.style.display = "flex";
}

function createHourFilterUI(videos) {
  const filtroDiv = document.getElementById("filtro-horario");
  contFiltroArriba = filtroDiv || null;
  renderHourFilterIn(contFiltroArriba, videos);

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
      visibilityMap.forEach((ratio, node) => { if (ratio > max) [max, winner] = [ratio, node]; });
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
    v.preload = "metadata";
    await new Promise(res => {
      v.addEventListener("loadedmetadata", res, { once: true });
      v.load();
    });
  }
}

function pauseAllVideos() {
  try { if (currentPreviewActive) currentPreviewActive.pause(); } catch {}
  document.querySelectorAll("video.video-preview, video.real").forEach(v => {
    try { v.pause(); } catch {}
    try { v.preload = "none"; } catch {}
  });
}

// ---------------- DESCARGA CON PROGRESO + COMPARTIR ----------------
async function downloadWithProgress(url, { onStart, onProgress, onFinish, signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const totalHeader = res.headers.get("Content-Length") || res.headers.get("content-length");
  const total = totalHeader ? parseInt(totalHeader, 10) : 0;

  const defaultType = url.toLowerCase().endsWith(".mp4") ? "video/mp4" : (res.headers.get("Content-Type") || "application/octet-stream");
  const reader = res.body?.getReader?.();

  if (onStart) onStart({ totalKnown: !!total, totalBytes: total });

  if (!reader) {
    const blob = await res.blob();
    if (onProgress) onProgress({ percent: 100, loaded: blob.size, total: blob.size, indeterminate: !total });
    if (onFinish) onFinish();
    return new Blob([blob], { type: blob.type || defaultType });
  }

  const chunks = [];
  let received = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength || value.length || 0;
    if (onProgress) {
      if (total) {
        const pct = Math.max(0, Math.min(100, Math.round((received / total) * 100)));
        onProgress({ percent: pct, loaded: received, total, indeterminate: false });
      } else {
        onProgress({ percent: null, loaded: received, total: 0, indeterminate: true });
      }
    }
  }

  if (onFinish) onFinish();
  return new Blob(chunks, { type: defaultType });
}

async function crearBotonAccionCompartir(entry) {
  const btn = document.createElement("button");
  btn.className = "btn-share-large";
  btn.textContent = "Compartir | Descargar";
  btn.title = "Compartir video";
  btn.setAttribute("aria-label", "Compartir video");
  btn.dataset.state = "idle"; // idle | downloading | ready
  btn._shareFile = null;      // File cache para segundo toque

  const tryShareFile = async (file) => {
    try {
      if (navigator.share) {
        await navigator.share({
          files: [file],
          title: "Video Puntazo",
          text: "Mira este _*PUNTAZO*_"
        });
        return true;
      }
    } catch (e) { throw e; }
    return false;
  };

  btn.addEventListener("click", async (e) => {
    e.preventDefault();

    if (btn.dataset.state === "ready" && btn._shareFile) {
      try { await tryShareFile(btn._shareFile); } catch {}
      if (!navigator.canShare?.({ files: [btn._shareFile] })) {
        const url = URL.createObjectURL(btn._shareFile);
        const a = document.createElement("a");
        a.href = url; a.download = entry.nombre;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
      }
      btn._shareFile = null;
      btn.textContent = "Compartido";
      setTimeout(() => { btn.textContent = "Compartir | Descargar"; btn.dataset.state = "idle"; }, 1200);
      return;
    }

    if (btn.dataset.state === "downloading") return;

    pauseAllVideos();

    btn.dataset.state = "downloading";
    btn.disabled = true;
    const originalContent = btn.textContent;

    btn.textContent = "";
    const wrap = document.createElement("span");
    wrap.className = "btn-progress";

    const label = document.createElement("span");
    label.className = "btn-progress__label";
    label.textContent = "Descargando…";

    const percentSpan = document.createElement("span");
    percentSpan.className = "btn-progress__percent";
    percentSpan.textContent = "0%";

    const bar = document.createElement("span");
    bar.className = "btn-progress__bar";
    const fill = document.createElement("span");
    fill.className = "btn-progress__fill";
    bar.appendChild(fill);

    const spinner = document.createElement("span");
    spinner.className = "btn-progress__spinner";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-progress__cancel";
    cancelBtn.textContent = "Cancelar";

    wrap.appendChild(label);
    wrap.appendChild(percentSpan);
    wrap.appendChild(bar);
    wrap.appendChild(spinner);
    wrap.appendChild(cancelBtn);
    btn.appendChild(wrap);

    const controller = new AbortController();
    const { signal } = controller;

    const restoreIdle = (text = originalContent) => {
      btn.innerHTML = "";
      btn.textContent = text;
      btn.disabled = false;
      btn.dataset.state = "idle";
      btn._shareFile = null;
    };

    cancelBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      try { controller.abort(); } catch {}
      btn.innerHTML = "";
      btn.textContent = "Cancelado";
      setTimeout(() => restoreIdle(originalContent), 1200);
    });

    try {
      const blob = await downloadWithProgress(entry.url, {
        signal,
        onStart({ totalKnown }) {
          if (!totalKnown) {
            spinner.style.display = "inline-block";
            percentSpan.textContent = "";
            fill.style.width = "0%";
            fill.style.opacity = "0.4";
          }
        },
        onProgress({ percent, indeterminate }) {
          if (indeterminate) {
            spinner.style.display = "inline-block";
            percentSpan.textContent = "";
            fill.style.width = "100%";
            fill.style.opacity = "0.4";
          } else {
            spinner.style.display = "none";
            percentSpan.textContent = `${percent}%`;
            fill.style.width = `${percent}%`;
            fill.style.opacity = "1";
          }
        },
        onFinish() {
          percentSpan.textContent = "100%";
          fill.style.width = "100%";
        }
      });

      const file = new File([blob], entry.nombre, { type: blob.type || "video/mp4" });

      let autoShared = false;
      try { autoShared = await tryShareFile(file); } catch { autoShared = false; }

      if (autoShared) {
        btn.innerHTML = "";
        btn.textContent = "Compartido";
        setTimeout(() => restoreIdle(originalContent), 1200);
      } else {
        btn._shareFile = file;
        btn.innerHTML = "";
        btn.textContent = "Listo — Compartir ahora";
        btn.disabled = false;
        btn.dataset.state = "ready";
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.warn("Descarga/compartir falló:", err);
      btn.innerHTML = "";
      btn.textContent = "Error";
      setTimeout(() => restoreIdle(originalContent), 1500);
    }
  });

  return btn;
}

// ---- Render de página y limpieza ----
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
    const m = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
    let displayTime = entry.nombre.replace(".mp4", "");
    if (m) {
      const hr = parseInt(m[1],10), mn = m[2], ap = hr>=12?"PM":"AM";
      displayTime = `${hr%12||12}:${mn} ${ap}`;
    }

    const card = document.createElement("div");
    card.className = "video-card";
    card.id = entry.nombre;

    const title = document.createElement("div");
    title.className = "video-title";
    title.textContent = displayTime;
    card.appendChild(title);

    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.style.width = "100%";

    const real = document.createElement("video");
    real.className = "real";
    real.controls = true;
    real.playsInline = true;
    real.preload = "metadata";
    real.src = entry.url;
    real.style.display = "none";
    real.style.width = "100%";
    real.style.borderRadius = "6px";

    const preview = createPreviewOverlay(entry.url, entry.duracion||60, card);

    wrap.appendChild(real);
    wrap.appendChild(preview);
    card.appendChild(wrap);

    // Contenedor de botones de acción
    const btnContainer = document.createElement("div");
    btnContainer.className = "botones-container";
    btnContainer.style.display = "flex";
    btnContainer.style.alignItems = "center";
    btnContainer.style.marginTop = "12px";

    // === 1) Botón de PROMOCIÓN (arriba del resto) ===
    try {
      const { el: promoEl, applied } = await buildPromoButtonForClub(loc);
      if (applied && promoEl) {
        btnContainer.appendChild(promoEl);
      }
    } catch (e) {
      console.warn("[promo] No fue posible construir el botón:", e);
    }

    // === 2) Botón Compartir/Descargar ===
    const actionBtn = await crearBotonAccionCompartir(entry);
    actionBtn.style.removeProperty('flex');
    btnContainer.appendChild(actionBtn);

    // === 3) Ver otra perspectiva (si existe) ===
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

  const previews = Array.from(contenedorVideos.querySelectorAll("video.video-preview"));
  loadPreviewsSequentially(previews);

  // Paginador SOLO ABAJO
  const total = videosListaCompleta.length;
  const p = getQueryParams();

  const oppHref = oppInfoCache?.oppId
    ? (() => {
        const base = `lado.html?loc=${p.loc}&can=${p.can}&lado=${oppInfoCache.oppId}`;
        const parts = [];
        if (typeof paginaActual === "number") parts.push(`pg=${paginaActual}`);
        if (p.filtro) parts.push(`filtro=${encodeURIComponent(p.filtro)}`);
        return parts.length ? `${base}&${parts.join("&")}` : base;
      })()
    : null;

  const pagBottom = document.getElementById("paginator-bottom");
  const onChange = (newPage) => {
    if (newPage < 0) newPage = 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (newPage > totalPages - 1) newPage = totalPages - 1;
    paginaActual = newPage;
    setQueryParams({ pg: paginaActual }, false);
    renderPaginaActual({ fueCambioDePagina: true });
    scrollToTop();
  };
  renderPaginator(pagBottom, total, paginaActual, PAGE_SIZE, onChange, oppHref);

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

    const linkClub = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    const nombreLado = document.getElementById("nombre-lado");
    if (linkClub) { linkClub.textContent = locObj?.nombre || loc; linkClub.href = `locacion.html?loc=${loc}`; }
    if (linkCancha) { linkCancha.textContent = canObj?.nombre || can; linkCancha.href = `cancha.html?loc=${loc}&can=${can}`; }
    if (nombreLado) { nombreLado.textContent = ladoObj?.nombre || lado; }

    // Info lado opuesto y botón fijo arriba (conserva pg/filtro)
    oppInfoCache = await findOppositeConfig(cfgGlobal, loc, can, lado);
    const oppTopHref = oppInfoCache?.oppId
      ? (() => {
          const base = `lado.html?loc=${loc}&can=${can}&lado=${oppInfoCache.oppId}`;
          const parts = [];
          if (params.pg !== undefined) parts.push(`pg=${encodeURIComponent(params.pg)}`);
          if (params.filtro) parts.push(`filtro=${encodeURIComponent(params.filtro)}`);
          return parts.length ? `${base}&${parts.join("&")}` : base;
        })()
      : null;
    ensureOppositeTopButton(oppTopHref, oppInfoCache?.oppName);

    // Filtros (arriba y abajo)
    createHourFilterUI(data.videos);

    // Lista con filtro horario
    let list = data.videos || [];
    if (filtro) {
      list = list.filter(v => {
        const m = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
        return m && m[1] === filtro;
      });
    }

    // Orden descendente por tsKey (nuevo → antiguo)
    list.sort((a, b) => {
      const pa = parseFromName(a.nombre);
      const pb = parseFromName(b.nombre);
      const ta = pa ? pa.tsKey : -Infinity;
      const tb = pb ? pb.tsKey : -Infinity;
      return tb - ta;
    });

    ultimoFiltroActivo = filtro || null;
    videosListaCompleta = list;
    paginacionHabilitada = videosListaCompleta.length > 7;

    ensureBottomControlsContainer();

    // Página deseada
    const totalPages = Math.max(1, Math.ceil(videosListaCompleta.length / PAGE_SIZE));
    let desiredPg = parseInt(params.pg || "0", 10);
    if (Number.isNaN(desiredPg)) desiredPg = 0;

    if (targetId) {
      const idx = videosListaCompleta.findIndex(v => v.nombre === targetId);
      if (idx >= 0 && paginacionHabilitada) desiredPg = Math.floor(idx / PAGE_SIZE);
    }

    paginaActual = Math.min(Math.max(0, desiredPg), totalPages - 1);
    setQueryParams({ pg: paginaActual }, !("pg" in params));

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

  // href del botón "Regresar a la cancha"
  const btnVolver = document.getElementById("btn-volver");
  if (btnVolver) {
    const path2 = window.location.pathname;
    const p2 = getQueryParams();
    if (path2.endsWith("lado.html")) {
      btnVolver.href = `cancha.html?loc=${p2.loc}&can=${p2.can}`;
    } else if (path2.endsWith("cancha.html")) {
      btnVolver.href = `locacion.html?loc=${p2.loc}`;
    } else if (path2.endsWith("locacion.html")) {
      btnVolver.href = "index.html";
    }
  }
});

window.addEventListener("popstate", () => {
  const p = getQueryParams();
  const newFilter = p.filtro || null;
  if (newFilter !== ultimoFiltroActivo) {
    populateVideos();
  } else {
    const totalPages = Math.max(1, Math.ceil(videosListaCompleta.length / PAGE_SIZE));
    let desiredPg = parseInt(p.pg || "0", 10);
    if (Number.isNaN(desiredPg)) desiredPg = 0;
    paginaActual = Math.min(Math.max(0, desiredPg), totalPages - 1);
    renderPaginaActual({ fueCambioDePagina: true });

    // Recalcular botón opuesto fijo por si cambió de lado con el historial
    if (cfgGlobal && p.loc && p.can && p.lado) {
      findOppositeConfig(cfgGlobal, p.loc, p.can, p.lado).then(info => {
        const base = info?.oppId
          ? `lado.html?loc=${p.loc}&can=${p.can}&lado=${info.oppId}`
          : null;
        const parts = [];
        if (p.pg !== undefined) parts.push(`pg=${encodeURIComponent(p.pg)}`);
        if (p.filtro) parts.push(`filtro=${encodeURIComponent(p.filtro)}`);
        const oppTopHref = base ? (parts.length ? `${base}&${parts.join("&")}` : base) : null;
        ensureOppositeTopButton(oppTopHref, info?.oppName);
      }).catch(() => {});
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
