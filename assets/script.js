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
    const cancha = config.locaciones.find(l => l.id === locId)?.cancha.find(c => c.id === canId);
    const loc = config.locaciones.find(l => l.id === locId);
    const ul = document.getElementById("lados-lista");
    if (!ul || !cancha || !loc) return;
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

function createHourFilterUI(videos) {
  const params = getQueryParams();
  const filtroHoraActivo = params.filtro;
  const filtroDiv = document.getElementById("filtro-horario");
  if (!filtroDiv) return;
  filtroDiv.innerHTML = "";
  const horasSet = new Set();

  videos.forEach(v => {
    const match = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
    if (match) horasSet.add(match[1]);
  });
  const horas = [...horasSet].sort();
  horas.forEach(h => {
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
  preview.preload = "auto";
  preview.src = videoSrc;
  preview.className = "video-preview";
  preview.setAttribute("aria-label", "Vista previa");

  let startTime = duration > 15 ? duration - 15 : 0;
  const previewLen = 5;
  const endTime = startTime + previewLen;

  const onLoaded = () => {
    preview.currentTime = startTime;
  };
  preview.addEventListener("loadedmetadata", onLoaded);

  preview.addEventListener("timeupdate", () => {
    if (preview.currentTime >= endTime) {
      preview.currentTime = startTime;
    }
  });

  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      visibilityMap.set(preview, entry.intersectionRatio);
      let maxRatio = 0;
      let winner = null;
      visibilityMap.forEach((ratio, node) => {
        if (ratio > maxRatio) {
          maxRatio = ratio;
          winner = node;
        }
      });
      if (winner === preview) {
        if (entry.isIntersecting) {
          if (currentPreviewActive && currentPreviewActive !== preview) {
            currentPreviewActive.pause();
          }
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

function setupMutualExclusion(videosList) {
  videosList.forEach(v => {
    v.addEventListener("play", () => {
      videosList.forEach(o => {
        if (o !== v) o.pause();
      });
    });
  });
}

async function crearBotonAccionCompartir(entry) {
  const button = document.createElement("button");
  button.className = "btn-share-large";
  button.textContent = "Compartir / Descargar";
  button.title = "Compartir video";
  button.setAttribute("aria-label", "Compartir video");

  button.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(entry.url);
      const blob = await response.blob();
      const file = new File([blob], entry.nombre, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Video Puntazo",
          text: "Mira este clip (se borra en 8 horas)",
        });
        return;
      }
      // si no soporta compartir archivo, solo copio link
      const params = getQueryParams();
      const url = `${location.origin}${location.pathname}?loc=${params.loc}&can=${params.can}&lado=${params.lado}&video=${entry.nombre}`;
      navigator.clipboard.writeText(url);
      alert("No se puede compartir directamente. Enlace copiado."); 
    } catch (err) {
      console.warn("Share sheet falló:", err);
      const params = getQueryParams();
      const url = `${location.origin}${location.pathname}?loc=${params.loc}&can=${params.can}&lado=${params.lado}&video=${entry.nombre}`;
      navigator.clipboard.writeText(url);
      alert("No se puede compartir directamente. Enlace copiado.");
    }
  });

  return button;
}

async function populateVideos() {
  const params = getQueryParams();
  const locId = params.loc;
  const canId = params.can;
  const ladoId = params.lado;
  const filtroHora = params.filtro;
  const targetVideoId = params.video;

  const urlCfg = `data/config_locations.json?cb=${Date.now()}`;
  try {
    const resCfg = await fetch(urlCfg, { cache: "no-store" });
    const config = await resCfg.json();
    const locObj = config.locaciones.find(l => l.id === locId);
    const canObj = locObj?.cancha.find(c => c.id === canId);
    const ladoObj = canObj?.lados.find(l => l.id === ladoId);
    if (!ladoObj || !ladoObj.json_url) {
      document.getElementById("videos-container").innerHTML =
        "<p style='color:#fff;'>Lado no encontrado.</p>";
      return;
    }

    const jsonUrl = `${ladoObj.json_url}?cb=${Date.now()}`;
    const res = await fetch(jsonUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo acceder al JSON de videos.");
    const data = await res.json();

    const container = document.getElementById("videos-container");
    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "block";
    container.innerHTML = "";

    // encabezados / breadcrumbs
    const linkClub = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    const nombreLado = document.getElementById("nombre-lado");
    if (linkClub) {
      linkClub.textContent = locObj?.nombre || "";
      linkClub.href = `locacion.html?loc=${locId}`;
    }
    if (linkCancha) {
      linkCancha.textContent = canObj?.nombre || "";
      linkCancha.href = `cancha.html?loc=${locId}&can=${canId}`;
    }
    if (nombreLado) nombreLado.textContent = ladoObj?.nombre || "";

    // UI de filtro
    createHourFilterUI(data.videos);

    // aplicar filtro
    let videosToRender = data.videos;
    if (filtroHora) {
      videosToRender = data.videos.filter(v => {
        const match = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
        return match && match[1] === filtroHora;
      });
    }

    allVideos = [];
    for (const entry of videosToRender) {
      const rawUrl = entry.url;
      const match = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
      const hour = match ? parseInt(match[1], 10) : null;
      const minute = match ? match[2] : "";
      const ampm = hour !== null ? (hour >= 12 ? "PM" : "AM") : "";
      const displayTime = hour !== null
        ? `${hour % 12 || 12}:${minute} ${ampm}`
        : entry.nombre.replace(".mp4", "");

      const card = document.createElement("div");
      card.className = "video-card";
      card.id = entry.nombre;

      const title = document.createElement("div");
      title.className = "video-title";
      title.textContent = displayTime;
      card.appendChild(title);

      const wrapper = document.createElement("div");
      wrapper.style.position = "relative";
      wrapper.style.width = "100%";

      const realVideo = document.createElement("video");
      realVideo.classList.add("real");
      realVideo.controls = true;
      realVideo.playsInline = true;
      realVideo.preload = "metadata";
      realVideo.src = rawUrl;
      realVideo.style.display = "none";
      realVideo.style.width = "100%";
      realVideo.style.borderRadius = "6px";

      const preview = createPreviewOverlay(rawUrl, entry.duracion || 60, card);

      wrapper.appendChild(realVideo);
      wrapper.appendChild(preview);
      card.appendChild(wrapper);

      // botón único de acción
      const buttonsContainer = document.createElement("div");
      buttonsContainer.style.display = "flex";
      buttonsContainer.style.alignItems = "center";
      buttonsContainer.style.marginTop = "12px";

      const actionBtn = await crearBotonAccionCompartir(entry);
      actionBtn.style.flex = "1";
      buttonsContainer.appendChild(actionBtn);

      card.appendChild(buttonsContainer);
      container.appendChild(card);
      allVideos.push(realVideo);
    }

    setupMutualExclusion(allVideos);

    if (loading) loading.style.display = "none";
    if (targetVideoId) scrollToVideoById(targetVideoId);
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
  btn.addEventListener("click", () => {
    scrollToTop();
  });
  document.body.appendChild(btn);

  let lastScrollY = window.scrollY;
  window.addEventListener("scroll", () => {
    const scrollY = window.scrollY;
    const videoCards = document.querySelectorAll(".video-card");
    if (scrollY > 100 && scrollY < lastScrollY && videoCards.length > 3) {
      btn.style.display = "block";
    } else {
      btn.style.display = "none";
    }
    lastScrollY = scrollY;
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
    const params = getQueryParams();
    if (path.endsWith("lado.html")) {
      btnVolver.href = `cancha.html?loc=${params.loc}&can=${params.can}`;
    } else if (path.endsWith("cancha.html")) {
      btnVolver.href = `locacion.html?loc=${params.loc}`;
    } else if (path.endsWith("locacion.html")) {
      btnVolver.href = "index.html";
    }
  }
});
