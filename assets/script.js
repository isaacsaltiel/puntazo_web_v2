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
    document.getElementById("breadcrumb-sep2").style.display = "none";
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
  preview.addEventListener("loadedmetadata", () => preview.currentTime = start);
  preview.addEventListener("timeupdate", () => {
    if (preview.currentTime >= end) preview.currentTime = start;
  });

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
    v.preload = "auto";
    await new Promise(res => {
      v.addEventListener("loadedmetadata", res, { once: true });
      v.load();
    });
  }
}

async function crearBotonAccionCompartir(entry) {
  const btn = document.createElement("button");
  btn.className = "btn-share-large";
  btn.textContent = "Compartir / Descargar";
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
      document.getElementById("videos-container").innerHTML =
        "<p style='color:#fff;'>Lado no encontrado.</p>";
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

      // Preview
      const preview = createPreviewOverlay(entry.url, entry.duracion||60, card);

      wrap.appendChild(real);
      wrap.appendChild(preview);
      card.appendChild(wrap);

      // Botón compartir/descargar
      const btnContainer = document.createElement("div");
      btnContainer.style.display = "flex";
      btnContainer.style.alignItems = "center";
      btnContainer.style.marginTop = "12px";
      const actionBtn = await crearBotonAccionCompartir(entry);
      actionBtn.style.flex = "1";
      btnContainer.appendChild(actionBtn);
      card.appendChild(btnContainer);

      container.appendChild(card);
      allVideos.push(real);
    }

    setupMutualExclusion(allVideos);

    // Carga previews en serie
    const previews = Array.from(document.querySelectorAll("video.video-preview"));
    loadPreviewsSequentially(previews);

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
  if (path.endsWith("index.html") || path.endsWith("/")) {
    populateLocaciones();
  } else if (path.endsWith("locacion.html")) {
    populateCanchas();
  } else if (path.endsWith("cancha.html")) {
    populateLados();
  } else if (path.endsWith("lado.html")) {
    populateVideos();
    createScrollToTopBtn();
  }

  const btnVolver = document.getElementById("btn-volver");
  if (btnVolver) {
    const p = getQueryParams();
    if (path.endsWith("lado.html")) {
      btnVolver.href = `cancha.html?loc=${p.loc}&can=${p.can}`;
    } else if (path.endsWith("cancha.html")) {
      btnVolver.href = `locacion.html?loc=${p.loc}`;
    } else if (path.endsWith("locacion.html")) {
      btnVolver.href = "index.html";
    }
  }
});
