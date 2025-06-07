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
  const locId = params.loc, canId = params.can;
  const res = await fetch("data/config_locations.json");
  const config = await res.json();
  const loc = config.locaciones.find(l => l.id === locId);
  if (!loc) return;
  const can = loc.cancha.find(c => c.id === canId);
  if (!can) {
    document.getElementById("lados-lista").innerHTML = "<li>Cancha no encontrada</li>";
    return;
  }

  document.getElementById("nombre-cancha").textContent = can.nombre;
  const ul = document.getElementById("lados-lista");
  can.lados.forEach(lado => {
    const li = document.createElement("li");
    li.classList.add("fade-in");
    li.style.marginBottom = "10px";
    const a = document.createElement("a");
    a.href = `lado.html?loc=${locId}&can=${canId}&lado=${lado}`;
    a.textContent = lado;
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

// Mostrar listado de videos en lado.html
async function populateVideos() {
  // Asumimos que este Pi está configurado para ClubEjemplo/Cancha1/LadoA,
  // así que cargamos directamente ese JSON en Dropbox:
  const jsonUrl = "https://dl.dropboxusercontent.com/s/sib89idhs4r7vwk9lynek/videos_recientes.json?rlkey=a4egau5glzjlr8c6u5nmmldpi&st=a2v39gcp&dl=1";

  try {
    const res = await fetch(jsonUrl);
    if (!res.ok) throw new Error("JSON no encontrado en Dropbox");
    const data = await res.json();
    const container = document.getElementById("videos-container");
    container.innerHTML = ""; // Limpia antes de insertar

    // Extraer parámetros para mostrar título correcto en página
    const params = getQueryParams();
    const locId = (params.loc || "ClubEjemplo").toUpperCase();
    const canId = (params.can || "Cancha1").toUpperCase();
    const ladoId = (params.lado || "LadoA").toUpperCase();
    document.getElementById("nombre-club").textContent = locId;
    document.getElementById("nombre-cancha-lado").textContent = `${canId} – ${ladoId}`;

    // Ordenar los videos de más recientes a más antiguos
    data.videos.sort((a, b) => {
      const t1 = a.nombre.match(/\d+/g).join("");
      const t2 = b.nombre.match(/\d+/g).join("");
      return parseInt(t2) - parseInt(t1);
    });

    data.videos.forEach(entry => {
      // entry.url: 
      // "https://www.dropbox.com/scl/fi/.../video_final_20250605_122335.mp4?rlkey=...&dl=0"
      // Convertimos a raw:
      let rawUrl = entry.url.replace(/^https:\/\/www\.dropbox\.com/, "https://dl.dropboxusercontent.com");
      rawUrl = rawUrl.replace(/([\?&])dl=0$/, "$1dl=1");

      // Extraer hora: "video_final_20250605_122335.mp4" → "12:23:35"
      let displayTime = "";
      const m = entry.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
      if (m) {
        displayTime = `${m[1]}:${m[2]}:${m[3]}`;
      } else {
        displayTime = entry.nombre;
      }

      // Construir tarjeta para cada video
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

      const btn = document.createElement("button");
      btn.className = "btn-download";
      btn.textContent = "Descargar";
      btn.addEventListener("click", () => {
        window.location.href = rawUrl;
      });
      card.appendChild(btn);

      container.appendChild(card);
    });
  } catch (err) {
    console.error("Error en populateVideos():", err);
    const container = document.getElementById("videos-container");
    container.innerHTML = "<p style='color:#fff; text-align:center;'>No hay videos disponibles en este momento.</p>";
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
