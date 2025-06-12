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
