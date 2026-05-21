# Etapa 6 — `resumen.html`: tarjeta del partido estilo Strava (compartible)

## Objetivo

Crear `resumen.html`: la pantalla final del flujo del jugador. Genera una **tarjeta visual atractiva del partido** (estilo Strava) que el usuario puede **descargar como PNG y compartir** en redes sociales. Incluye branding de Puntazo, marcador, número de "puntazos", duración, y la lista de clips del partido debajo.

Es la pieza más visible del producto — la que el jugador comparte y la que atrae nuevos usuarios y patrocinadores. **Lo más importante: que se vea premium y sea fácil de compartir.** Las estadísticas avanzadas de visión (golpes por tipo, heatmap, velocidad) NO son parte de esta etapa — llegan en Etapa 8. Esta etapa construye la tarjeta con los datos que SÍ tenemos hoy.

Además: modificar `mi-partido.html` para que, en estado `ended`, el botón principal lleve a `resumen.html`.

## Contexto

El flujo del jugador, tras Etapas 3-5-8C, está casi completo:

```
QR/entrada → login → iniciar partido → [pedir clips: botón físico o digital] →
  terminar partido → mi-partido.html (estado ended) → ??? 
```

El "???" es esta etapa. Según el diagrama de producto de Isaac: *"Acabar partido → Despliega stats y ofrece descargar gráfico como imagen/PNG. Abajo aparecen los videos del partido."*

`resumen.html` ES esa pantalla. El usuario llega tras terminar, ve su tarjeta, la descarga/comparte, y debajo ve sus clips.

**Referencia visual (mockups del owner):** la tarjeta es vertical (formato historia de Instagram, ~9:16). De arriba a abajo: logo Puntazo + "@puntazoclips" + "Presentado x [patrocinador]"; bloque de marcador (2 equipos × 3 sets, con ícono de trofeo en el ganador); "PUNTAZOS" + número grande; "Duración" + tiempo grande. En los mockups también hay una zona de stats (Forehand/Backhand/Dropshot/Smash, heatmap, "golpe más fuerte km/h") — **esa zona es Etapa 8, NO esta**. En Etapa 6 esa zona se omite o se muestra como un placeholder "Análisis en proceso" claramente etiquetado (ver Alcance).

## Arquitectura relevante

**Datos disponibles (del match doc, vía `assets/matches.js`):**

- `PuntazoMatches.get(matchId)` → `MatchDoc`: `{ userId, loc, can, lado, startedAt, endedAt, status, marcador, jugadores, clipCount }`.
- `marcador` (si existe): `{ sets: [{team1, team2}, ...], ganador?: "team1"|"team2" }`. Puede ser `null` (el usuario terminó sin registrar marcador).
- `jugadores`: array de `{ nombre, uid? }`, 0-4 elementos. Puede estar vacío.
- `duración` = `endedAt - startedAt` (ambos Firestore Timestamp; parsea como en mi-partido.html).
- `PuntazoMatches.findClipsForMatch(matchDoc)` → array de `ClipMeta` `{ videoId, videoUrl, club, cancha, lado, fecha, timestamp, nombre }`. Esta es la lista de clips del partido.
- `clipCount` (denormalizado) — número de "puntazos". Para mostrar el número exacto, mejor recontar con `findClipsForMatch().length` (más confiable que el denormalizado).

**Firestore Rules**: los matches con `status === "ended"` son **públicamente legibles** (cualquiera con el matchId, sin login). Eso hace `resumen.html` compartible: el destinatario del link NO necesita cuenta. `resumen.html` por tanto **NO requiere autenticación para ver**.

**Lo que NO tenemos hoy (NO inventar):**

- Conteo de golpes (forehand/backhand/dropshot/smash) — visión, Etapa 8.
- Heatmap de posiciones — visión, Etapa 8.
- Velocidad del golpe más fuerte — visión, Etapa 8 (y aun así será estimación).
- Patrocinador dinámico por club — no hay data source. Slot estático por ahora.

**Tecnologías web a usar:**

- **html2canvas** (CDN, ej. `https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js`): captura un `<div>` del DOM → `<canvas>` → PNG. Es la forma estándar de generar la imagen descargable.
- **Web Share API**: `navigator.share({ files: [pngFile], title, text })` para compartir nativo en móvil (abre el sheet de iOS/Android con Instagram, WhatsApp, etc.). Chequear soporte con `navigator.canShare({ files: [...] })`. En desktop o navegadores sin soporte: fallback a descarga directa.
- **Captura de foto de fondo**: `<input type="file" accept="image/*" capture="environment">` — en móvil abre cámara o galería; en desktop abre selector de archivos. La foto se lee como **data URL** (FileReader) y se aplica como `background-image` del div de la tarjeta. Usar data URL (no object URL) evita que html2canvas marque el canvas como "tainted" por CORS.

**Assets del repo:**

- Logo de Puntazo: busca en `logos/` o `assets/` (hay un logo que usa `assets/header.js` — localízalo). Úsalo en la tarjeta.
- Paleta y tipografía: `assets/estilo.css` (tokens `--blue`, `--blue2`, `--card`, etc.) + Montserrat de Google Fonts.

## Archivos importantes (lee antes de empezar)

| Archivo | Por qué |
|---|---|
| [docs/workers/README.md](README.md) | Convención. **Branch base: `rediseno-jugador`**. |
| [docs/workers/etapa-06-resumen.md](etapa-06-resumen.md) | Este brief. |
| [mi-partido.html](../../mi-partido.html) | Estado ended actual (Etapas 4/5). Vas a cambiar el botón principal del estado ended. Identifica `$finishedActions`, `#mpLnkClips`, `#mpLnkBack` o nombres reales. Reusa sus helpers de parseo de Timestamp y formato. |
| [assets/matches.js](../../assets/matches.js) | API: `get`, `findClipsForMatch`. |
| [docs/matches-schema.md](../matches-schema.md) | Shape de `marcador`, `jugadores`, etc. |
| [assets/header.js](../../assets/header.js) | De dónde sale el logo Puntazo + patrón de header. |
| [assets/estilo.css](../../assets/estilo.css) | Tokens de paleta y tipografía. |
| [lado.html](../../lado.html) o [clip.html](../../clip.html) | Referencia de cómo se listan/embeben clips (puedes reusar el patrón visual de las cards, simplificado — NO necesitas cargar `card.js` completo si haces thumbnails simples). |
| [data/config_locations.json](../../data/config_locations.json) | Resolver `loc/can/lado` IDs a nombres legibles. |

## Alcance

### 1. `resumen.html` (NUEVO)

Estructura de la página (mobile-first):

**A. La tarjeta compartible** — un `<div id="pz-resumen-card">` con dimensiones fijas pensadas para compartir (recomendado 1080×1920 lógico, escalado a viewport con CSS `transform: scale()` o `width` responsivo; html2canvas captura el tamaño natural). Contenido de la tarjeta, de arriba a abajo:

- **Fondo**: la foto subida por el usuario como `background-image` (cover). Si no hay foto, un gradiente oscuro por defecto (usa la paleta — azules oscuros). Encima del fondo, una **capa semi-transparente oscura** (`rgba(...)`) para que el texto sea legible sobre cualquier foto.
- **Branding**: logo de Puntazo (centrado, arriba) + texto "@puntazoclips". Debajo, un slot "Presentado por [PATROCINADOR]" — para Etapa 6 usa un placeholder estático (texto "Puntazo" o vacío); deja un comentario `<!-- TODO sponsor dinámico: Etapa futura -->`. NO inventes un sponsor real.
- **Marcador**: si `match.marcador` existe y tiene `sets`:
  - Dos filas (equipo 1, equipo 2). Cada fila: nombres de los jugadores de ese equipo + las cifras de cada set.
  - Mapeo jugadores→equipo: `jugadores[0]` y `jugadores[1]` = equipo 1; `jugadores[2]` y `jugadores[3]` = equipo 2. Si hay menos de 4, mostrar lo que haya (ej. 1v1 = jugador 0 vs jugador 1; cada uno su equipo). Si `jugadores` vacío: usar "Equipo 1" / "Equipo 2".
  - Si `marcador.ganador` está, mostrar un ícono de trofeo 🏆 junto al equipo ganador.
  - Si `match.marcador` es `null`: omitir el bloque de marcador o mostrar "Partido sin marcador registrado" discreto.
- **PUNTAZOS**: etiqueta "PUNTAZOS" + número grande = cantidad de clips (`findClipsForMatch(match).length`).
- **Duración**: etiqueta "Duración" + tiempo grande formateado (ej. "1h 48m"). Calcular de `endedAt - startedAt`.
- **Zona de stats de visión**: NO incluir números falsos. Opciones (elige una, simple):
  - (a) Omitir la zona por completo en Etapa 6.
  - (b) Un placeholder discreto: "📊 Análisis detallado disponible pronto" — si lo incluyes, que se vea intencional, no roto.
  - Recomendado: (a) omitir, o (b) muy sobrio. NO pongas "Forehand: 0" ni números inventados.
- **Footer de la tarjeta**: "puntazoclips.com" pequeño.

**B. Controles (fuera de la tarjeta, NO se capturan en el PNG):**

- Botón "📷 Cambiar foto de fondo" → abre `<input type="file" accept="image/*" capture="environment">`. Al elegir foto, se aplica como fondo de la tarjeta y se re-renderiza.
- Botón "⬇️ Descargar resumen" → `html2canvas(card)` → `canvas.toBlob()` → descarga un PNG (`resumen-puntazo-<fecha>.png`).
- Botón "📤 Compartir" → genera el PNG, y:
  - Si `navigator.canShare && navigator.canShare({ files: [file] })`: `navigator.share({ files: [file], title: "Mi partido en Puntazo", text: "..." })`.
  - Si no: fallback a descarga (mismo que el botón anterior) + un mensaje "Tu navegador no soporta compartir directo — descarga la imagen y súbela a tu red social."
- Indicador de "Generando imagen…" mientras html2canvas trabaja (puede tardar 1-3s).

**C. Lista de clips del partido (fuera de la tarjeta):**

- Debajo de los controles, listar los clips de `findClipsForMatch(match)`.
- Cada clip: thumbnail o `<video>` con `preload="metadata"`, link a `clip.html?videoId=<id>` para verlo completo.
- Puedes hacer un grid simple de cards — NO necesitas cargar `assets/card.js` ni `reactions.js` (esos traen reacciones/comentarios que no aplican aquí). Mantén los clips simples: miniatura + fecha/hora + link.
- Si no hay clips: mensaje "Este partido no generó clips."

**D. Estados de la página:**

- `?matchId=X` ausente → error claro "Falta el ID del partido".
- Match no encontrado → "Partido no encontrado".
- Match con `status !== "ended"` → mensaje "Este partido aún no termina. Vuelve cuando esté finalizado." (resumen es para partidos terminados; rules además bloquean lectura de active ajenos).
- Match `ended` → render completo.

**Dependencias en `<head>`**: Firebase compat (app + firestore + auth) + `firebase-core.js` + `auth.js` + `matches.js` + html2canvas (CDN). `auth.js` se carga para que `matches.js` no truene, pero la página NO exige login.

### 2. `mi-partido.html` (MODIFICAR — cambiar destino post-terminar)

- En el estado `ended`, el botón principal actualmente dice "📺 Ver clips de tu partido" y va a `lado.html?...&matchId=X`.
- Cambiarlo: el botón principal ahora dice **"🎴 Ver resumen del partido"** y va a `resumen.html?matchId=X`.
- El botón secundario "Volver a clips de esta cancha" → `lado.html?loc=&can=&lado=` se conserva igual.
- Es el único cambio en mi-partido.html. NO tocar nada más.

## Fuera de alcance

NO hacer:

- Estadísticas de visión reales (golpes, heatmap, velocidad km/h) — Etapa 8. NO inventar números.
- Patrocinador dinámico por club — slot estático con TODO comentado.
- Editar el marcador desde resumen.html (es read-only; el marcador se registra en mi-partido.html).
- Cargar `assets/card.js` o `reactions.js` en resumen.html (los clips van simples, sin reacciones).
- Modificar `assets/matches.js`, `script.js`, `auth.js`, `firebase-core.js`, `header.js`, `estilo.css`, `card.js`, `reactions.js`.
- Modificar cualquier HTML que no sea `resumen.html` (nuevo) y `mi-partido.html` (un solo botón).
- Modificar Firestore Rules.
- Subir la imagen generada a ningún servidor (todo es client-side: generar → descargar/compartir).
- Integración directa con la API de Instagram (no existe API pública para publicar; el flujo correcto es Web Share API o descarga manual).
- Pipeline Python local, workflows.

Si descubres algo fuera de scope crítico, anótalo en "Recomendación al maestro".

## Riesgos

1. **html2canvas y CORS taint**: si la tarjeta incluye imágenes de otro origen (ej. thumbnails de Dropbox), el canvas queda "tainted" y `toBlob()` falla. Mitigaciones: (a) la foto de fondo va como **data URL** (no object URL, no remote URL); (b) el logo de Puntazo es same-origin (del repo), OK; (c) NO metas dentro de la tarjeta capturada ninguna imagen remota. Los clips (que sí pueden ser remotos) van FUERA de la tarjeta, no se capturan.
2. **Fuentes no renderizadas por html2canvas**: si Montserrat no terminó de cargar cuando capturas, el PNG sale con fuente fallback. Mitigación: usar `document.fonts.ready` antes de permitir la captura, o esperar un tick.
3. **Web Share API inconsistente**: `navigator.share` con `files` funciona en iOS Safari 15+ y Android Chrome, pero NO en desktop ni navegadores viejos. SIEMPRE chequear `navigator.canShare({ files })` antes. Fallback a descarga obligatorio.
4. **Tamaño del PNG**: una tarjeta 1080×1920 capturada con `scale: 2` puede pesar varios MB. Usar `scale: 1` o `2` con criterio; `canvas.toBlob(cb, 'image/jpeg', 0.92)` (JPEG) si el peso importa — pero PNG es más nítido para texto. Decidir y documentar. Recomendado: PNG a `scale: 2` capturando un card de 540×960 lógico → 1080×1920 real.
5. **Layout de la tarjeta roto en captura vs pantalla**: html2canvas no soporta el 100% de CSS. Evita `backdrop-filter`, `filter`, gradientes exóticos, `mix-blend-mode` DENTRO de la tarjeta. Mantén la tarjeta con CSS simple y sólido. Prueba el PNG real, no solo cómo se ve en pantalla.
6. **Match sin marcador / sin jugadores / sin clips**: los 3 casos son reales (usuario terminó sin registrar marcador, sin invitar jugadores, partido sin clips). Cada uno debe degradar con elegancia, nunca romper la tarjeta.
7. **resumen.html sin login**: `matches.js` usa `PuntazoFirebase.db()` que no requiere auth para leer un match ended (rules lo permiten). Pero `auth.js` debe cargarse igual para que `matches.js` no falle por dependencia faltante. Verifica que la página funciona en incógnito sin login.
8. **Foto de fondo muy grande**: si el usuario sube una foto de 12MP, el data URL es enorme y html2canvas se ralentiza. Opcional: redimensionar la foto a máx ~1080px de ancho antes de aplicarla (con un canvas intermedio). Si lo haces, mantenlo simple.

## Validaciones

`python -m http.server 8080`. Necesitas al menos un match `ended` real en Firestore (créalo con el flujo entrada→mi-partido→terminar, idealmente con marcador y 2-4 jugadores).

Reportar status (✅/❌/⏭️) + output por cada una:

1. **Entrada desde mi-partido**: termina un partido → en el estado ended, el botón principal dice "Ver resumen del partido" → click → llega a `resumen.html?matchId=X`.
2. **Render de la tarjeta**: resumen.html muestra la tarjeta con logo Puntazo, marcador (2 equipos × sets), PUNTAZOS (número), Duración. Todo legible.
3. **Marcador correcto**: el marcador en la tarjeta coincide con `match.marcador` de Firestore. El trofeo aparece junto al ganador si `marcador.ganador` está.
4. **Caso sin marcador**: crea un match, termínalo SIN llenar marcador → resumen.html no rompe, omite o degrada el bloque de marcador con elegancia.
5. **Foto de fondo**: click "Cambiar foto de fondo" → elige una imagen → la tarjeta actualiza su fondo con esa foto + overlay oscuro, texto sigue legible.
6. **Descargar PNG**: click "Descargar resumen" → se descarga un PNG. Ábrelo: la tarjeta se ve completa, con la foto de fondo, texto nítido, sin elementos cortados.
7. **Compartir (móvil)**: en un celular real o DevTools mobile, click "Compartir" → en móvil con soporte abre el share sheet nativo; en desktop hace fallback a descarga + mensaje explicativo.
8. **Lista de clips**: debajo de la tarjeta, se listan los clips del partido (si hay). Cada uno linkea a `clip.html?videoId=X`. Si no hay clips: mensaje empático.
9. **Estados de error**: `resumen.html` sin `?matchId` → error claro. `?matchId=inexistente` → "Partido no encontrado". matchId de un partido `active` → mensaje "aún no termina".
10. **Sin login (compartibilidad)**: en incógnito, sin iniciar sesión, abre `resumen.html?matchId=<un match ended>` → la tarjeta se renderiza completa (rules permiten leer matches ended). Esto es lo que hace el resumen compartible.
11. **Mobile responsive**: en iPhone SE (375×667), la tarjeta se ve completa y proporcionada, los botones son tappables, la lista de clips no se desborda.
12. **PNG fiel**: comparar el PNG descargado contra lo que se ve en pantalla — deben coincidir (fuentes, colores, layout). Sin texto cortado ni fuente fallback.
13. **Sin errores nuevos en consola JS**.

## Definition of Done

- [ ] `resumen.html` creado: tarjeta + controles (foto, descargar, compartir) + lista de clips + estados de error.
- [ ] `mi-partido.html` modificado: botón principal del estado ended → `resumen.html?matchId=X`.
- [ ] html2canvas integrado (CDN), genera PNG fiel.
- [ ] Web Share API con `canShare` check + fallback a descarga.
- [ ] Foto de fondo vía input file, aplicada como data URL.
- [ ] Funciona sin login (incógnito) para matches `ended`.
- [ ] Las 13 validaciones ejecutadas y reportadas.
- [ ] Branch `etapa-06-resumen` creada **desde `rediseno-jugador`**, commits limpios, pusheada.
- [ ] **NO** mergeada.
- [ ] Cero modificaciones a archivos fuera de scope (solo `resumen.html` nuevo + 1 botón en `mi-partido.html`).

## Formato del reporte de regreso

Del template en [docs/workers/README.md](README.md). Incluir: nota sobre el peso del PNG generado, qué navegadores probaste para Web Share, y cualquier limitación de html2canvas que hayas encontrado.
