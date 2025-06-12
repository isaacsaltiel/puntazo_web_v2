// assets/script.js

// Función para parsear parámetros de query string
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

// Población dinámica de la lista de locaciones en index.html
async function populateLocaciones() {
  const res = await fetch("data/config_locations.json");
  const config = await res.json();
  const ul = document.getElementById("locaciones-lista");
  config.locaciones.forEach(loc => {
    const li = document.createElement("li");
    li.classList.add("fade-in");
    li.style.marginBottom = "10px";
    const a = document.createElement("a");
    a.href = `locacion.html?loc=${loc.id}`;
    a.textContent = loc.nombre;
    a.style.color = "#ffffff";
    a.style.fontSize = "1.2rem";
    a.style.textDecoration = "none";
    a.addEventListener("mouseover", () => {
      a.style.color = "#55c1e7"; // celeste
    });
    a.addEventListener("mouseout", () => {
      a.style.color = "#ffffff";
    });
    li.appendChild(a);
    ul.appendChild(li);
  });
}

// Población dinámica de la lista de canchas en locacion.html
async function populateCanchas() {
  const params = getQueryParams();
  const locId = params.loc;
  const res = await fetch("data/config_locations.json");
  const config = await res.json();
  const loc = config.locaciones.find(l => l.id === locId);

  if (!loc) {
    document.getElementById("canchas-lista").innerHTML = "<li>Locación no encontrada</li>";
    return;
  }

  document.getElementById("nombre-locacion").textContent = loc.nombre;
  const ul = document.getElementById("canchas-lista");
  loc.cancha.forEach(can => {
    const li = document.createElement("li");
    li.classList.add("fade-in");
    li.style.marginBottom = "10px";
    const a = document.createElement("a");
    a.href = `cancha.html?loc=${locId}&can=${can.id}`;
    a.textContent = can.nombre;
    a.style.color = "#ffffff";
    a.style.fontSize = "1.2rem";
    a.style.textDecoration = "none";
    a.addEventListener("mouseover", () => {
      a.style.color = "#55c1e7"; // celeste
    });
    a.addEventListener("mouseout", () => {
      a.style.color = "#ffffff";
    });
    li.appendChild(a);
    ul.appendChild(li);
  });
}

// Población dinámica de la lista de lados en cancha.html
async function populateLados() {
  const params = getQueryParams();
  const locId = params.loc;
  const canId = params.can;
  const res = await fetch("data/config_locations.json");
  const config = await res.json();

  const loc = config.locaciones.find(l => l.id === locId);
  if (!loc) return;

  const cancha = loc.cancha.find(c => c.id === canId);
  if (!cancha) return;

  document.getElementById("nombre-cancha").textContent = cancha.nombre;
  const ul = document.getElementById("lados-lista");

  cancha.lados.forEach(lado => {
    const li = document.createElement("li");
    li.classList.add("fade-in");
    li.style.marginBottom = "10px";
    const a = document.createElement("a");

    a.href = `lado.html?loc=${locId}&can=${canId}&lado=${lado.id}`;
    a.textContent = lado.nombre || lado.id;
    a.style.color = "#ffffff";
    a.style.fontSize = "1.2rem";
    a.style.textDecoration = "none";

    a.addEventListener("mouseover", () => {
      a.style.color = "#55c1e7";
    });
    a.addEventListener("mouseout", () => {
      a.style.color = "#ffffff";
    });

    li.appendChild(a);
    ul.appendChild(li);
  });
}


// Mostrar listado de videos en lado.html
// Mostrar listado de videos en lado.html
async function populateVideos() {
  const params = getQueryParams();
  const locId = params.loc;
  const canId = params.can;
  const ladoId = params.lado;

  const res = await fetch("data/config_locations.json");
  const config = await res.json();

  const ladoObj = config.locaciones
    .find(l => l.id === locId)?.cancha
    .find(c => c.id === canId)?.lados
    .find(l => l.id === ladoId);

  if (!ladoObj) {
    document.getElementById("videos-container").innerHTML = "<p style='color:#fff;'>Lado no encontrado.</p>";
    return;
  }

  const url = `https://www.dropbox.com/scl/fo/${ladoObj.folder_id}/videos_recientes.json?rlkey=${ladoObj.rlkey}&st=${ladoObj.st}&dl=1`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("No se pudo acceder al JSON de videos.");
    const data = await res.json();
    const container = document.getElementById("videos-container");
    container.innerHTML = "";

    document.getElementById("nombre-club").textContent = locId.toUpperCase();
    document.getElementById("nombre-cancha-lado").textContent = `${canId.toUpperCase()} – ${ladoId.toUpperCase()}`;

    data.videos.forEach(entry => {
      const match = entry.url.match(/\/scl\/fi\/([^/]+)\/([^?]+)/);
      const rawUrl = match
        ? `https://dl.dropboxusercontent.com/s/${match[1]}/${match[2]}`
        : entry.url;

      const m = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
      const displayTime = m ? `${m[1]}:${m[2]}:${m[3]}` : entry.nombre;

      const card = document.createElement("div");
      card.className = "video-card";

      const title = document.createElement("div");
      title.className = "video-title";
      title.textContent = displayTime;
      card.appendChild(title);

      const video = document.createElement("video");
      video.controls = true;
      video.src = rawUrl;
      card.appendChild(video);

      const btn = document.createElement("a");
      btn.className = "btn-download";
      btn.textContent = "Descargar";
      btn.href = rawUrl;
      btn.download = entry.nombre;
      card.appendChild(btn);

      container.appendChild(card);
    });
  } catch (err) {
    console.error("Error en populateVideos():", err);
    document.getElementById("videos-container").innerHTML =
      "<p style='color:#fff;'>No hay videos disponibles.</p>";
  }
}


// Detectar en qué página estamos y llamar a la función correspondiente
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
  }
});
