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
  const url = `data/config_locations.json?cb=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  const config = await res.json();
  const ul = document.getElementById("locaciones-lista");
  ul.innerHTML = "";
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
    a.addEventListener("mouseover", () => a.style.color = "#55c1e7");
    a.addEventListener("mouseout",  () => a.style.color = "#ffffff");
    li.appendChild(a);
    ul.appendChild(li);
  });
}

// Población dinámica de la lista de canchas en locacion.html
async function populateCanchas() {
  const params = getQueryParams();
  const locId = params.loc;
  const url = `data/config_locations.json?cb=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  const config = await res.json();
  const loc = config.locaciones.find(l => l.id === locId);
  const ul = document.getElementById("canchas-lista");
  ul.innerHTML = "";
  if (!loc) {
    ul.innerHTML = "<li>Locación no encontrada</li>";
    return;
  }
  document.getElementById("nombre-locacion").textContent = loc.nombre;
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
    a.addEventListener("mouseover", () => a.style.color = "#55c1e7");
    a.addEventListener("mouseout",  () => a.style.color = "#ffffff");
    li.appendChild(a);
    ul.appendChild(li);
  });
}

// Población dinámica de la lista de lados en cancha.html
async function populateLados() {
  const params = getQueryParams();
  const locId = params.loc;
  const canId = params.can;
  const url = `data/config_locations.json?cb=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  const config = await res.json();
  const cancha = config.locaciones
    .find(l => l.id === locId)?.cancha
    .find(c => c.id === canId);
  const loc = config.locaciones.find(l => l.id === locId);
  const ul = document.getElementById("lados-lista");
  ul.innerHTML = "";
  if (!cancha) {
    ul.innerHTML = "<li>Lado no encontrado</li>";
    return;
  }
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
    a.style.color = "#ffffff";
    a.style.fontSize = "1.2rem";
    a.style.textDecoration = "none";
    a.addEventListener("mouseover", () => a.style.color = "#55c1e7");
    a.addEventListener("mouseout",  () => a.style.color = "#ffffff");
    li.appendChild(a);
    ul.appendChild(li);
  });
}

// Mostrar listado de videos en lado.html
async function populateVideos() {
  const params = getQueryParams();
  const locId = params.loc;
  const canId = params.can;
  const ladoId = params.lado;
  const urlCfg = `data/config_locations.json?cb=${Date.now()}`;
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
  try {
    const res = await fetch(jsonUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo acceder al JSON de videos.");

    const data = await res.json();
    const container = document.getElementById("videos-container");

    // Mostrar el mensaje de carga
    document.getElementById("loading").style.display = "block";

    container.innerHTML = "";
    document.getElementById("link-club").textContent = locObj.nombre;
    document.getElementById("link-club").href = `locacion.html?loc=${locId}`;
    document.getElementById("link-cancha").textContent = canObj.nombre;
    document.getElementById("link-cancha").href = `cancha.html?loc=${locId}&can=${canId}`;
    document.getElementById("nombre-lado").textContent = ladoObj.nombre;

    data.videos.forEach(entry => {
      const rawUrl = entry.url;
      const downloadUrl = rawUrl.replace("dl=0", "dl=1");

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
      video.playsInline = true;
      video.preload = "metadata";
      video.src = rawUrl;
      card.appendChild(video);

      const btn = document.createElement("a");
      btn.className = "btn-download";
      btn.textContent = "Descargar";
      btn.href = downloadUrl;
      btn.download = entry.nombre;
      card.appendChild(btn);

      container.appendChild(card);
    });

    // Ocultar el mensaje de carga
    document.getElementById("loading").style.display = "none";

  } catch (err) {
    console.error("Error en populateVideos():", err);
    document.getElementById("videos-container").innerHTML =
      "<p style='color:#fff;'>No hay videos disponibles.</p>";
    document.getElementById("loading").style.display = "none";
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

  // ✅ Corregido: ahora sí garantizamos que el botón exista antes de modificarlo
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
