// assets/script.js

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
    document.getElementById("nombre-locacion").textContent = loc.nombre;
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
    document.getElementById("link-club").textContent = loc.nombre;
    document.getElementById("link-club").href = `locacion.html?loc=${locId}`;
    document.getElementById("link-cancha").textContent = cancha.nombre;
    document.getElementById("link-cancha").href = "#";
    document.getElementById("breadcrumb-sep2").style.display = "none";
    document.getElementById("nombre-lado").style.display = "none";

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
// ========== FUNCIONES ADICIONALES INTEGRADAS ==========

let allVideos = []; // usado para control de reproducción
let observer = null; // usado por scroll a primer video

function createPreviewVideoElement(src, duration) {
  const preview = document.createElement("video");
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = "auto";
  preview.src = src;
  preview.className = "video-preview";

  preview.addEventListener("loadedmetadata", () => {
    const previewStart = duration > 15 ? duration - 15 : 0;
    preview.currentTime = previewStart;
  });

  preview.addEventListener("mouseenter", () => {
    preview.play();
  });
  preview.addEventListener("mouseleave", () => {
    preview.pause();
  });

  return preview;
}

function scrollToVideoById(id) {
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function formatAmPm(hour) {
  const h = parseInt(hour);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12} ${suffix}`;
}

function generateHourFilters(videos) {
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
    btn.dataset.hora = h;
    filtroDiv.appendChild(btn);
  });

  const quitarBtn = document.createElement("button");
  quitarBtn.textContent = "Quitar filtro";
  quitarBtn.className = "btn-filtro quitar";
  quitarBtn.addEventListener("click", () => populateVideos());
  filtroDiv.appendChild(quitarBtn);

  filtroDiv.style.display = "block";
}

function crearBtnCopiar(nombre, rawUrl) {
  const shareBtn = document.createElement("button");
  shareBtn.className = "btn-share";
  shareBtn.innerHTML = "🔗";
  shareBtn.title = "Copiar enlace";

  shareBtn.addEventListener("click", () => {
    const params = getQueryParams();
    const url = `${location.origin}${location.pathname}?loc=${params.loc}&can=${params.can}&lado=${params.lado}&video=${nombre}`;
    navigator.clipboard.writeText(url);
    alert("Enlace copiado. Recuerda que el video se borra pasadas 8 horas. Si deseas guardarlo, descárgalo.");
  });

  return shareBtn;
}

function createScrollToTopBtn() {
  const btn = document.createElement("button");
  btn.textContent = "↑";
  btn.className = "scroll-top";
  btn.style.display = "none";
  btn.addEventListener("click", () => {
    const firstCard = document.querySelector(".video-card");
    if (firstCard) firstCard.scrollIntoView({ behavior: "smooth" });
  });
  document.body.appendChild(btn);

  let lastScrollY = 0;
  window.addEventListener("scroll", () => {
    const scrollY = window.scrollY;
    if (scrollY > 100 && scrollY < lastScrollY && document.querySelectorAll(".video-card").length > 3) {
      btn.style.display = "block";
    } else {
      btn.style.display = "none";
    }
    lastScrollY = scrollY;
  });
}
async function populateVideos() {
  const params = getQueryParams();
  const locId = params.loc;
  const canId = params.can;
  const ladoId = params.lado;
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
    document.getElementById("link-club").textContent = locObj.nombre;
    document.getElementById("link-club").href = `locacion.html?loc=${locId}`;
    document.getElementById("link-cancha").textContent = canObj.nombre;
    document.getElementById("link-cancha").href = `cancha.html?loc=${locId}&can=${canId}`;
    document.getElementById("nombre-lado").textContent = ladoObj.nombre;

    const filtroHora = params.filtro;
    const filtrados = filtroHora
      ? data.videos.filter(v => v.nombre.includes(`_${filtroHora}`))
      : data.videos;

    generateHourFilters(data.videos);

    allVideos = [];
    filtrados.forEach(entry => {
      const rawUrl = entry.url;
      const downloadUrl = rawUrl.replace("dl=0", "dl=1");
      const match = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
      const displayTime = match ? `${parseInt(match[1]) % 12 || 12}:${match[2]} ${match[1] >= 12 ? 'PM' : 'AM'}` : entry.nombre.replace(".mp4", "");

      const card = document.createElement("div");
      card.className = "video-card";
      card.id = entry.nombre;

      const title = document.createElement("div");
      title.className = "video-title";
      title.textContent = displayTime;
      card.appendChild(title);

      const preview = createPreviewVideoElement(rawUrl, entry.duracion || 60);
      card.appendChild(preview);

      const video = document.createElement("video");
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = rawUrl;
      allVideos.push(video);
      card.appendChild(video);

      const btn = document.createElement("a");
      btn.className = "btn-download";
      btn.textContent = "Descargar";
      btn.href = downloadUrl;
      btn.download = entry.nombre;
      card.appendChild(btn);

      const share = crearBtnCopiar(entry.nombre, rawUrl);
      card.appendChild(share);

      container.appendChild(card);
    });

    allVideos.forEach(v => {
      v.addEventListener("play", () => {
        allVideos.forEach(o => {
          if (o !== v) o.pause();
        });
      });
    });

    if (loading) loading.style.display = "none";
    if (targetVideoId) scrollToVideoById(targetVideoId);
  } catch (err) {
    console.error("Error en populateVideos():", err);
    document.getElementById("videos-container").innerHTML =
      "<p style='color:#fff;'>No hay videos disponibles.</p>";
    if (document.getElementById("loading")) document.getElementById("loading").style.display = "none";
  }
}

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

