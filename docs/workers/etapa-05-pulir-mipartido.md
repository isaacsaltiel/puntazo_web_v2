# Etapa 5 — Pulir `mi-partido.html` + filtrar `lado.html` por `matchId`

## Objetivo

Convertir `mi-partido.html` de estática a **viva** mientras el partido está activo, y hacer que `lado.html` filtre los clips por la ventana del partido cuando llega con `?matchId=X`. Tres entregables:

1. **`mi-partido.html`** (MODIFICAR): cronómetro grande corriendo + contador de clips capturados en vivo (polling).
2. **`mi-partido.html`** (MODIFICAR): mejor UX post-terminar — no redirect abrupto. Mostrar estado final con marcador + botón explícito para ir a ver los clips.
3. **`lado.html`** (MODIFICAR): si llega con `?matchId=X`, ocultar los clips que no pertenecen a ese partido, mostrar título y banner contextual ("Clips de tu partido · Ver clips de toda la cancha").

Sin tocar resumen.html (Etapa 6), sin tocar visión / heatmap (Etapa 8), sin tocar el pipeline Python.

## Contexto

Etapa 4 entregó `entrada.html` + `mi-partido.html` (mínima) + banner CTA en `lado.html`. El flujo end-to-end funciona pero hay 2 problemas de UX detectados en validación humana:

1. **`mi-partido.html` se siente estática durante un partido activo**: no hay cronómetro corriendo ni feedback de que clips se vayan capturando. Aburrido y poco confiable visualmente (¿estoy en partido o no?).
2. **Post-terminar: redirect abrupto**: hoy `mi-partido.html` redirige inmediatamente a `lado.html?...&matchId=X` tras `end()`. El usuario no ve confirmación del marcador guardado. Isaac lo reportó textualmente como "no me sale ya nada después, sólo se acaba".

Adicionalmente, `lado.html` recibe el `?matchId=X` en la URL post-terminar (Etapa 4 ya lo pasa) pero **no lo usa** — sigue mostrando los últimos 24h de clips de la cancha indiscriminados. Esa pieza es la que conecta `mi-partido.html (ended)` con la futura `resumen.html` (Etapa 6): primero el usuario ve sus clips filtrados; luego, en Etapa 6, podrá generar el resumen visual desde ahí.

## Arquitectura relevante

**Estado actual de `mi-partido.html` (tras Etapa 4):**

- Carga Firebase compat + `firebase-core.js` + `auth.js` + `matches.js` + `header.js`.
- Modos: "creación inline" (`?nueva=1&loc=&can=&lado=`), "ver/operar" (`?matchId=X`), "necesita auth", "no encontrado", "no es tuyo".
- En modo "ver/operar" + `status === "active"`: muestra info card (loc/can/lado, hora inicio, chips jugadores, badge status), botón "Terminar partido" (abre modal de marcador), placeholder "Pedir clip ahora" deshabilitado, botón "Cancelar partido".
- En modo "ver/operar" + `status === "ended"`/`"cancelled"`: muestra info + marcador formateado (si existe), botón "Volver a clips de esta cancha".
- Tras `end()` exitoso: hace `window.location.href = "/lado.html?...&matchId=..."` (redirect inmediato).
- Helpers internos relevantes: `renderMatch()`, `readSet()`, `buildMarcador()`, `formatMarcador()` (probablemente — confirma leyendo el archivo).

**Estado actual de `lado.html` (tras Etapa 4 + 4.5):**

- Carga Firebase compat + `firebase-firestore-compat` + `reactions.js` + `matches.js`.
- Tras el header y antes de `<main>` hay un `<div id="pz-match-banner"></div>` que la IIFE del banner CTA (al final del body) rellena.
- El listado de clips lo arma `assets/script.js` (módulo grande compartido — NO modificar). `script.js` lee `?loc=&can=&lado=`, baja `videos_recientes.json` y popula `<section id="videos-container">` con cards. Cada card tiene un `data-video-id` o atributo equivalente (verifica abriendo el archivo).
- Tras Etapa 4.5 ya no existe el script del Top-3 badge ni su CSS.

**Módulo `assets/matches.js` (Etapa 3, ya en `rediseno-jugador`):**

- `PuntazoMatches.get(matchId) → Promise<MatchDoc | null>`
- `PuntazoMatches.findClipsForMatch(matchDoc) → Promise<ClipMeta[]>` — clips dentro de la ventana del partido, filtra por loc/can/lado y `startedAt <= ts <= (endedAt ?? now)`. Devuelve array de `{ videoId, videoUrl, club, cancha, lado, fecha, timestamp, nombre }`.
- El `videoId` que devuelve `findClipsForMatch` ES el nombre del archivo, que es el mismo string que `script.js` usa para identificar cards. Eso simplifica el filtrado por DOM.

**Auth (existente):**

- `window.PuntazoAuth.currentUser`, eventos `puntazo:auth-ready` y `puntazo:auth-changed`.

**Restricciones cardinales (no negociables):**

- **NO modificar** `assets/script.js`, `assets/reactions.js`, `assets/card.js`, `assets/header.js`, `assets/auth.js`, `assets/firebase-core.js`, `assets/matches.js`.
- **NO modificar** ningún HTML fuera de `mi-partido.html` y `lado.html`.

## Archivos importantes (lee antes de empezar)

| Archivo | Por qué |
|---|---|
| [docs/workers/README.md](README.md) | Convención. **Tu branch base es `rediseno-jugador`** (no master). |
| [docs/workers/etapa-05-pulir-mipartido.md](etapa-05-pulir-mipartido.md) | Este brief. |
| [mi-partido.html](../../mi-partido.html) | Estado actual (Etapa 4). Identifica `renderMatch()`, modal de end, función que hace el redirect. |
| [lado.html](../../lado.html) | Estado actual (post Etapas 4 + 4.5). Identifica el `<section id="videos-container">` (o nombre real), el banner placeholder, las IIFE existentes. |
| [assets/matches.js](../../assets/matches.js) | API a consumir: `get`, `findClipsForMatch`, etc. |
| [docs/matches-schema.md](../matches-schema.md) | Modelo de datos. Refresca cómo está poblado `match.startedAt`, `endedAt`, `status`, `marcador`. |
| [assets/script.js](../../assets/script.js) (búsqueda dirigida) | Sólo para entender cómo popula `lado.html` el listado de clips: busca dónde inserta cards en `videos-container` y qué atributo usa para identificar cada clip. NO modificar. |
| [data/config_locations.json](../../data/config_locations.json) | Para resolver `loc/can/lado` IDs a nombres legibles. |

## Alcance

### Sub-tarea A · Cronómetro vivo en `mi-partido.html`

- Cuando `match.status === "active"`, mostrar un **cronómetro grande** arriba de la info card (o donde se vea natural): formato `HH:MM:SS` corriendo desde `match.startedAt` (parsear el Timestamp como hizo Etapa 4).
- Update cada **1 segundo** vía `setInterval`. Limpiar el interval cuando: status cambia (terminó/canceló), el user navega fuera, o ocurre cualquier teardown.
- Estilo: usa tokens existentes (paleta `--blue`, `--card`, `--text`). Grande pero no exagerado (~2.2rem en desktop, ~1.8rem en móvil). Color verde sutil para reforzar "activo".

### Sub-tarea B · Contador de clips en vivo en `mi-partido.html`

- Cuando `match.status === "active"`, mostrar un **contador** tipo "🎬 N clips capturados durante este partido" debajo del cronómetro o adyacente.
- Poll cada **20 segundos** vía `setInterval`: llamar `PuntazoMatches.findClipsForMatch(currentMatch)` y actualizar el número.
- Indicador visual de poll en curso (spinner pequeño o dot pulsante) para feedback.
- Tooltip o subtítulo: "Se actualiza cada 20 segundos. El video tarda hasta 60s en aparecer tras pulsar el botón."
- Si la primera carga falla (matches.js no disponible, error de red), mostrar "—" en el contador y reintentar al siguiente tick.
- Limpiar el interval cuando status cambia o teardown.

### Sub-tarea C · UX post-terminar en `mi-partido.html`

- Cuando se ejecuta `end()` con éxito:
  1. **NO redirigir** inmediatamente.
  2. Re-cargar el match (`PuntazoMatches.get(matchId)`) y re-renderizar como `status === "ended"`.
  3. Mostrar un mensaje de éxito breve (toast o banner verde inline): "✅ Partido terminado. Marcador guardado."
  4. La vista ended debe mostrar el marcador formateado prominentemente.
  5. Botón principal nuevo: **"📺 Ver clips de tu partido"** → `lado.html?loc=&can=&lado=&matchId=X` (esto activará la Sub-tarea D en lado.html).
  6. Botón secundario existente "Volver a clips de esta cancha" → `lado.html?loc=&can=&lado=` (sin matchId, ver todos los clips de la cancha).
- Cuando se ejecuta `cancel()` con éxito:
  - Redirect normal a `lado.html?loc=&can=&lado=` (sin matchId). No mostrar pantalla de "cancelado terminado" — el cancel es un descarte.

### Sub-tarea D · Filtro por `matchId` en `lado.html`

- En `lado.html`, agregar una **nueva IIFE defensiva** (similar al patrón del banner CTA de Etapa 4) que:
  1. Lee `?matchId=X` y `?loc&can&lado` del query string.
  2. Si NO hay `matchId`: no hace nada (comportamiento actual: clips de 24h sin filtrar).
  3. Si SÍ hay `matchId`:
     - Llama `PuntazoMatches.get(matchId)`.
     - Si el match no existe, no es del usuario actual (cuando hay usuario) y no está `ended`: limpiar el banner de filtro y no aplicar (fallback silencioso al comportamiento actual). Permitir lectura de partidos `ended` ajenos porque las rules ya lo permiten (resúmenes públicos).
     - Llama `PuntazoMatches.findClipsForMatch(matchDoc)` para obtener el conjunto de `videoId`s válidos para ese partido.
     - **Espera a que `script.js` haya populado el `videos-container`** (poll DOM cada 200ms hasta encontrar cards O timeout de 8s, o si `script.js` dispara algún evento al terminar, escucharlo — verifica al leer `script.js`).
     - Una vez populado, ocultar (`display: none`) las cards cuyo `videoId` NO esté en el conjunto. NO eliminarlas — sólo ocultarlas, por si el filtro se retira sin recargar.
     - Si **ninguna card sobrevive** al filtro: mostrar un mensaje "Aún no hay clips de tu partido — el video tarda hasta 60s tras pulsar el botón."
  4. Render de **banner de filtro** (separado del banner CTA de Etapa 4): un banner sutil arriba del listado tipo:
     - Si el partido está `ended` y es del user: "📺 Clips de tu partido — N de M de la cancha · **[Ver todos]**"
     - Si el partido está `active`: "📺 Clips de tu partido en curso — actualizando..."
     - El botón "Ver todos" reemplaza la URL con `lado.html?loc=&can=&lado=` (sin `matchId`) y recarga, o ejecuta el reverso del filtro.
- **Todo en `try/catch`** (mismo principio defensivo del banner CTA). Si `matches.js` falla, no filtra, no rompe.
- El filtro **NO debe interferir** con el banner CTA de Etapa 4 ni con las reacciones, share, claim, etc.
- Inyectar el banner de filtro en un nuevo `<div id="pz-match-filter-banner"></div>` colocado justo después de `<div id="pz-match-banner">` o equivalente. NO compartir el mismo div.

## Fuera de alcance

NO hacer:

- Crear `resumen.html` ni botón hacia él (Etapa 6).
- Implementar el botón "Pedir clip ahora" (Etapa 8C; sigue como placeholder deshabilitado).
- Tocar `assets/script.js`, `assets/reactions.js`, `assets/card.js`, `assets/auth.js`, `assets/firebase-core.js`, `assets/matches.js`, `assets/header.js`, `assets/estilo.css`.
- Tocar `entrada.html`, `admin.html`, `index.html`, `clip.html`, `mejores.html`, `perfil.html`, `jugador.html`, `dashboard.html`, `explorar.html`, `locacion.html`, `cancha.html`, `boton.html`, `inicio.html`.
- Modificar Firestore Rules.
- "Confirm on close" si el user intenta navegar fuera con partido activo — descartado (overengineering por ahora).
- Cualquier cambio al CTA banner de Etapa 4 (sigue funcionando igual).
- Tocar workflows, pipeline Python, config.json del club.
- Cambiar paleta o tokens CSS globales.

Si descubres algo fuera de scope que parezca crítico, anótalo en "Recomendación al maestro" — NO lo arregles.

## Riesgos

1. **Memory leak por intervals**: si no limpias `setInterval` cuando el user sale de `mi-partido.html` o el status cambia, el polling sigue corriendo en background. Usa `clearInterval` cuidadosamente. Considera atar el cleanup a `visibilitychange` (pausar polling si la pestaña está oculta).
2. **Race en post-terminar**: si haces `end()` y luego `get()` inmediato, Firestore puede devolver el doc viejo (sin endedAt poblado) por el writelag. Mitigación: tras `end()`, hacer `get()` con un pequeño retry (ej. 2 intentos con 400ms de gap) hasta ver `status === "ended"` en la respuesta. Si tras 2 intentos no, igual re-renderiza con lo que tienes — no es bloqueante.
3. **DOM race en filtro de lado.html**: `script.js` popula `videos-container` asincrónicamente. Si tu filtro corre antes que la población, no encuentra cards. Usa `MutationObserver` sobre `videos-container` (limpio) o poll cada 200ms con cap de 8s. Una vez detectes que ya hay cards y no se agregaron más en ~500ms consecutivos, asume populado y filtra.
4. **`videoId` vs `data-video-id`**: necesitas verificar EL ATRIBUTO EXACTO que `script.js` usa para identificar cada card. Léelo, no asumas. Si las cards no tienen un atributo identificador estable, busca otro selector (ej. la URL del video en `<source>`).
5. **Filtro deja la página vacía**: el caso "ningún clip aún" en partido activo es el común al inicio (no hay clips todavía). El mensaje empático debe ser visible y claro — no dejar la página en blanco.
6. **Banner de filtro vs banner CTA de Etapa 4**: pueden coexistir si están en divs distintos. NO recolocar el banner CTA. NO inyectar el filtro dentro del mismo `#pz-match-banner` — usa un div nuevo.
7. **Cronómetro grande tapa info card en móvil**: cuida que el layout siga siendo legible en 375px. Pruébalo en DevTools.

## Validaciones

`python -m http.server 8080` desde la raíz. Login con tu cuenta Google. Test contra Firestore real.

Reportar status (✅/❌/⏭️) + output por cada validación:

1. **Crear match nuevo** desde entrada.html → te lleva a `mi-partido.html?matchId=X`.
2. **Cronómetro vivo** → ves `HH:MM:SS` corriendo, se actualiza cada segundo. Espera 30s y confirma que avanzó 30s.
3. **Contador de clips** → ves "🎬 N clips capturados". Inicialmente N=0 (o el real si hay clips en la ventana). Indicador de poll visible.
4. **Polling correcto**: si hay clips en la cancha durante el partido, el contador sube tras ~20s. Si no, queda en 0 (ok).
5. **Cleanup de intervals**: en DevTools → Performance o usando `console.log` temporal, verifica que al salir de `mi-partido.html` (ej. clic en "Cancelar"), los intervals dejan de correr (no quedan corriendo en background).
6. **Terminar partido**: con un match active, click "Terminar" → modal → llena Set 1 (6-4) y Set 2 (3-6) → "Guardar y terminar".
7. **UX post-terminar**: NO te redirige inmediatamente. La página re-renderiza mostrando: marcador formateado prominente, mensaje de éxito ("Partido terminado..."), botones "Ver clips de tu partido" y "Volver a clips de esta cancha".
8. **Verifica Firestore**: doc tiene `status: "ended"`, `endedAt`, `marcador.sets` correcto.
9. **Click "Ver clips de tu partido"** → te lleva a `lado.html?loc=&can=&lado=&matchId=X`.
10. **lado.html con matchId**: ves banner de filtro "📺 Clips de tu partido — N de M de la cancha · Ver todos". Sólo cards del partido visibles. Las cards de otros clips ocultas (no eliminadas; verifica en DOM inspector).
11. **lado.html con matchId, ningún clip en ventana**: mensaje empático visible. No quedan otras cards visibles.
12. **lado.html "Ver todos"** → vuelves al estado sin filtro (todas las cards de 24h visibles). Recargar o quitar matchId de la URL.
13. **lado.html sin matchId**: comportamiento original (Etapa 4). Banner CTA de Etapa 4 sigue funcionando.
14. **Cancelar un partido**: crea otro match, click "Cancelar partido" → confirm → redirect normal a lado.html sin matchId. NO ves la pantalla de ended con marcador. (Cancel ≠ end.)
15. **Permission edge**: con cuenta A, crea match. Termínalo (ahora es público por rules). Con cuenta B (o incógnito), abre `lado.html?...&matchId=<el-de-A>`. Debe filtrar y mostrar los clips del partido de A — porque las rules permiten read de matches ended para cualquiera (resúmenes públicos).
16. **Mobile responsive** (iPhone SE 375×667): cronómetro legible, contador legible, info card no se desborda, modal terminar usable, lado.html con banner de filtro se ve bien.
17. **Sin errores nuevos** en consola JS en ninguna de las 2 páginas modificadas.

## Definition of Done

- [ ] `mi-partido.html` modificada: cronómetro vivo + contador polling + UX post-terminar mejorada.
- [ ] `lado.html` modificada: IIFE nueva de filtro por matchId + banner de filtro nuevo (no toca el banner CTA de Etapa 4 ni la lógica de display).
- [ ] Intervals limpiados correctamente (no leaks).
- [ ] Las 17 validaciones ejecutadas y reportadas.
- [ ] Branch `etapa-05-pulir-mipartido` creada **desde `rediseno-jugador`**, commits limpios, pusheada a GitHub.
- [ ] **NO** mergeada a `rediseno-jugador` ni a `master`.
- [ ] Cero modificaciones a archivos fuera del scope listado.

## Formato del reporte de regreso

Del template en [docs/workers/README.md](README.md). Llenar cada sección.
