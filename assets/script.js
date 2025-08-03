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

function scrollToVideoById(id) {
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ----------------------- carga de navegación -----------------------
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

// ----------------------- funcionalidades de video -----------------------

let allVideos = []; // control reproducción mutua

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

function crearBtnCopiar(nombre) {
  const shareBtn = document.createElement("button");
  shareBtn.className = "btn-share";
  shareBtn.innerHTML = "🔗";
  shareBtn.title = "Copiar enlace";

  shareBtn.addEventListener("click", () => {
    const params = getQueryParams();
    const url = `${location.origin}${location.pathname}?loc=${params.loc}&can=${params.can}&lado=${params.lado}&video=${nombre}`;
    navigator.clipboard.writeText(url).then(() => {
      alert("Enlace copiado. Recuerda que el video se borra pasadas 8 horas. Si deseas guardarlo, descárgalo.");
    });
  });

  return shareBtn;
}

function createPreviewOverlay(videoSrc, duration, parentCard) {
  // Crea el preview como un <video> superpuesto al real
  const preview = document.createElement("video");
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = "auto";
  preview.src = videoSrc;
  preview.className = "video-preview";
  preview.setAttribute("aria-label", "Vista previa");

  // calcular inicio (15s antes del final) y limitar loop a 5s
  let startTime = duration > 15 ? duration - 15 : 0;
  const previewLength = 5; // segundos
  const endTime = startTime + previewLength;

  const onLoaded = () => {
    preview.currentTime = startTime;
  };
  preview.addEventListener("loadedmetadata", onLoaded);

  // Loop manual de 5 segundos
  preview.addEventListener("timeupdate", () => {
    if (preview.currentTime >= endTime) {
      preview.currentTime = startTime;
    }
  });

  // IntersectionObserver para activar en móvil / cuando está visible
  let isVisible = false;
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.target !== preview) return;
      isVisible = entry.isIntersecting;
      if (isVisible) {
        preview.play().catch(() => {}); // autoplay puede fallar si no ha sido interactuado
      } else {
        preview.pause();
      }
    });
  }, { threshold: 0.5 });
  io.observe(preview);

  // Click en preview: oculta preview y muestra video real desde inicio
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

    // breadcrumb / encabezado
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

    // filtro horario UI
    createHourFilterUI(data.videos);

    // aplicar filtro si viene
    let videosToRender = data.videos;
    if (filtroHora) {
      videosToRender = data.videos.filter(v => {
        // buscar coincidencia de hora en nombre
        const match = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
        return match && match[1] === filtroHora;
      });
    }

    allVideos = [];
    videosToRender.forEach(entry => {
      const rawUrl = entry.url;
      const downloadUrl = rawUrl.replace("dl=0", "dl=1");
      const match = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
      const hour = match ? parseInt(match[1], 10) : null;
      const minute = match ? match[2] : "";
      const ampm = hour !== null ? (hour >= 12 ? "PM" : "AM") : "";
      const displayTime = hour !== null
        ? `${hour % 12 || 12}:${minute} ${ampm}`
        : entry.nombre.replace(".mp4", "");

      // tarjeta
      const card = document.createElement("div");
      card.className = "video-card";
      card.id = entry.nombre;

      // título
      const title = document.createElement("div");
      title.className = "video-title";
      title.textContent = displayTime;
      card.appendChild(title);

      // contenedor para preview + real video (stacked)
      const wrapper = document.createElement("div");
      wrapper.style.position = "relative";
      wrapper.style.width = "100%";

      // video real
      const realVideo = document.createElement("video");
      realVideo.classList.add("real");
      realVideo.controls = true;
      realVideo.playsInline = true;
      realVideo.preload = "metadata";
      realVideo.src = rawUrl;
      realVideo.style.display = "none"; // oculto inicialmente
      realVideo.style.width = "100%";
      realVideo.style.borderRadius = "6px";

      // preview overlay
      const preview = createPreviewOverlay(rawUrl, entry.duracion || 60, wrapper);

      wrapper.appendChild(realVideo);
      wrapper.appendChild(preview);
      card.appendChild(wrapper);

      // botones
      const btnDownload = document.createElement("a");
      btnDownload.className = "btn-download";
      btnDownload.textContent = "Descargar";
      btnDownload.href = downloadUrl;
      btnDownload.download = entry.nombre;
      btnDownload.style.display = "inline-block";
      btnDownload.style.marginRight = "8px";
      card.appendChild(btnDownload);

      const share = crearBtnCopiar(entry.nombre);
      card.appendChild(share);

      container.appendChild(card);
      allVideos.push(realVideo);
    });

    // un solo video a la vez
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

// ----------------------- scroll to top condicional -----------------------
function createScrollToTopBtn() {
  const btn = document.createElement("button");
  btn.textContent = "↑";
  btn.className = "scroll-top";
  btn.style.display = "none";
  btn.setAttribute("aria-label", "Ir al primero");
  btn.addEventListener("click", () => {
    const firstCard = document.querySelector(".video-card");
    if (firstCard) firstCard.scrollIntoView({ behavior: "smooth" });
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
