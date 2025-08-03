// === BLOQUE 1 === //

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
// ==================== BLOQUE 2 ====================

function createPreviewVideoElement(src, duration) {
  const preview = document.createElement("video");
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = "auto";
  preview.src = src;
  preview.className = "video-preview";

  const start = duration > 15 ? duration - 15 : 0;

  preview.addEventListener("loadedmetadata", () => {
    preview.currentTime = start;
  });

  let playing = false;
  let visible = false;

  const playPreview = () => {
    if (visible && !playing) {
      playing = true;
      preview.currentTime = start;
      preview.play();
    }
  };

  const loopPreview = () => {
    if (preview.currentTime >= start + 5) {
      preview.currentTime = start;
    }
  };

  const stopPreview = () => {
    preview.pause();
    playing = false;
  };

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      visible = entry.isIntersecting;
      if (visible) {
        playPreview();
      } else {
        stopPreview();
      }
    });
  }, { threshold: 0.5 });

  observer.observe(preview);
  preview.addEventListener("timeupdate", loopPreview);

  preview.addEventListener("click", () => {
    const parent = preview.parentElement;
    preview.style.display = "none";
    const realVideo = parent.querySelector("video.real");
    if (realVideo) {
      realVideo.style.display = "block";
      realVideo.play();
    }
  });

  return preview;
}
// ========== BLOQUE 3 ==========

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
    btn.addEventListener("click", () => {
      const params = getQueryParams();
      window.location.href = `lado.html?loc=${params.loc}&can=${params.can}&lado=${params.lado}&filtro=${h}`;
    });
    filtroDiv.appendChild(btn);
  });

  const quitarBtn = document.createElement("button");
  quitarBtn.textContent = "Quitar filtro";
  quitarBtn.className = "btn-filtro quitar";
  quitarBtn.addEventListener("click", () => {
    const params = getQueryParams();
    window.location.href = `lado.html?loc=${params.loc}&can=${params.can}&lado=${params.lado}`;
  });
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

// === BOOTSTRAP ===
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
