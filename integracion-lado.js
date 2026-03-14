// =============================================================
// INTEGRACIÓN DE REACCIONES EN lado.html
// =============================================================
// 
// PASO 1 — Agrega esto en lado.html antes del </body>:
// =============================================================
/*
  <!-- Firebase + Reacciones (pegar justo antes de </body>) -->
  <link rel="stylesheet" href="/assets/reactions.css" />
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
  <script src="/assets/reactions.js"></script>
*/

// =============================================================
// PASO 2 — En tu script.js, busca donde generas cada video card.
// Debería verse algo así (ya existe en tu código):
// =============================================================
/*
  function renderVideoCard(video) {
    const li = document.createElement("li");
    li.innerHTML = `
      <video src="${video.url}" ...></video>
      <div class="video-info">...</div>
      <div class="video-actions">...</div>  ← botones de compartir/descargar
    `;
    return li;
  }
*/

// =============================================================
// PASO 3 — Agrega estas ~10 líneas DESPUÉS de crear cada card:
// =============================================================

function renderVideoCard(video) {
  const li = document.createElement("li");
  // ... tu código existente de la card ...

  // ── NUEVO: montar reacciones ──
  // Crear un div contenedor para las reacciones al final de la card
  const reactionsTarget = document.createElement("div");
  li.appendChild(reactionsTarget);

  // Llamar al módulo (deferred para no bloquear el render)
  if (window.PuntazoReactions) {
    PuntazoReactions.attach(reactionsTarget, {
      videoId:  video.filename,          // nombre del archivo, ej: "20250310_143022.mp4"
      videoUrl: video.url,               // URL de Dropbox
      club:     window._CURRENT_CLUB,    // ← ver nota abajo
      cancha:   window._CURRENT_CANCHA,
      lado:     window._CURRENT_LADO,
      fecha:    video.fecha || "",       // "2025-03-10" si lo tienes
    });
  }
  // ── FIN bloque reacciones ──

  return li;
}

// =============================================================
// NOTA sobre club/cancha/lado:
// Estos los toma tu script.js de los query params de la URL.
// La forma más simple de pasarlos es setear variables globales
// al inicio del script, después de parsear los params:
//
//   const params = getQueryParams();
//   window._CURRENT_CLUB   = params.club   || "";
//   window._CURRENT_CANCHA = params.cancha || "";
//   window._CURRENT_LADO   = params.lado   || "";
//
// =============================================================

// =============================================================
// PASO 4 — Firestore Security Rules
// En Firebase Console → Firestore → Rules, reemplaza con esto:
// =============================================================
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /reactions/{videoId} {
      allow read: if true;
      allow write: if true;   // abierto para MVP — puedes restringir después

      match /comments/{commentId} {
        allow read: if true;
        allow create: if request.resource.data.text is string
                      && request.resource.data.text.size() <= 200;
        allow update, delete: if false;
      }
    }
  }
}
*/

// =============================================================
// PASO 5 — Agregar link a "Mejores Momentos" en tu nav
// En inicio.html y/o index.html, agrega al menú de nav:
// =============================================================
/*
  <a href="/mejores.html" class="nav-link">🏆 Mejores Momentos</a>
*/
