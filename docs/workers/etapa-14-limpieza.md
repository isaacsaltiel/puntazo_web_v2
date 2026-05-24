# Etapa 14 — Limpieza de mejores.html + reacciones + comentarios

> Worker web. Branch `etapa-14-limpieza` desde **master** (no desde
> rediseno-jugador — ya está mergeado). Tocas HTML, CSS, JS y reglas
> Firestore. Datos en Firestore NO se borran.

## Objetivo

Remover del codebase las features que dejan de ser parte del flujo central
del jugador: la página `mejores.html` (rankings/top mensual de clips), el
panel de **reacciones por clip** (emojis tipo 🔥😂😡), y el panel de
**comentarios por clip**. Estas features fueron desactivadas conceptualmente
cuando el rediseño del jugador (Etapas 3-13) pasó al centro del producto.
Hoy solo agregan ruido al codebase.

**Alcance**: UI + código asociado + reglas Firestore. Los DATOS de
Firestore (colecciones `reactions/`, `reactions/{id}/comments/`,
`reactions/{id}/participants/`) **NO se borran**. Si en el futuro se
quieren rescatar, ahí están. (Decisión Isaac 2026-05-23.)

## Contexto

- Repo: `puntazo_web_v2`. Stack: HTML estático + Firebase Web SDK v8
  compat + GitHub Pages.
- Producción está en `master` (acabamos de mergear el rediseño completo,
  commit `0a48f7a5` + hot-patches).
- Reglas Firestore activas: estilo "analytics" con catch-all denegado al
  final. Cualquier cosa que quites de las rules tampoco va a permitir
  que clientes web escriban a esas colecciones — pero los DATOS existentes
  siguen ahí.

## PROTOCOLO

1. Branch nueva `etapa-14-limpieza` desde `master`. `git status` clean al empezar.
2. Trabajo incremental por archivo. Commits pequeños y descriptivos.
3. NO mergees a master tú mismo. Push del branch y reportas.
4. NO borres ningún archivo de `data/` (índices JSON, metrics, etc.).
5. NO toques `assets/auth.js`, `assets/firebase-core.js`, `assets/matches.js`,
   `assets/clip-states.js`. Esos son core, no relacionados.
6. NO toques los HTMLs nuevos del rediseño: `entrada.html`, `mi-partido.html`,
   `resumen.html`. Si alguno los referencia (no debería), avisa.
7. NO modifiques el copy/storytelling de `index.html` más allá de quitar
   los LINKS rotos a `mejores.html`. Re-redactar la home para reflejar
   el nuevo positioning es OTRO trabajo (Etapa 14.5 futura).

## Mapa de archivos (verificar y procesar)

### A BORRAR (delete completo)

- `mejores.html`
- `assets/reactions.css`
- `assets/reactions.js`

### A EDITAR — quitar referencias específicas

| Archivo | Qué quitar |
|---------|-----------|
| `clip.html` | `<link rel="stylesheet" href="/assets/reactions.css">` (línea ~23), `<script src="/assets/reactions.js">` (línea ~28), y el bloque/sección de UI que renderiza reactions+comments si existe. Quitar también el bloque que linkea a `mejores.html` ("Los mejores puntazos del mes no expiran…", ~líneas 106-107). |
| `lado.html` | `<link rel="stylesheet" href="/assets/reactions.css">` (~28), `<script src="/assets/reactions.js">` (~33), comentarios CSS internos que aluden a "Participantes" / "Slots de reacciones / comentarios / claim" (~líneas 195, 252), el link `mejores.html` (~393), y CUALQUIER UI HTML que renderice los emojis o el panel de comentarios. |
| `jugador.html` | `<link rel="stylesheet" href="/assets/reactions.css">` (~14), `<script src="/assets/reactions.js">` (~22), bloques de UI relacionados. |
| `perfil.html` | `<link rel="stylesheet" href="/assets/reactions.css">` (~14), `<script src="/assets/reactions.js">` (~18), comentario en código JS ("reactions.js ya escribe ahí desde la versión actualizada" ~314), y cualquier UI relacionada. |
| `assets/header.js` | Líneas ~125 y ~148: items del menú que linkean a `mejores.html` ("Puntazos del mes" / "🏆 Puntazos del mes"). Quitar ambos. |
| `index.html` | Quitar TODOS los `<a href="mejores.html">` (hay ~6 según grep). Quitar también `<div id="mejores">` y la sección entera que rodea esos CTAs si quedan vacíos visualmente. **NO reescribir copy de marketing** — solo quitar los links/CTAs rotos. Si una sección entera queda sin contenido funcional, quitarla. |
| `admin.html` | Verificar: NO tocar las stats numéricas que muestran `comments_count` (líneas ~1034, 1036, 1040) — son lecturas analíticas, no UI de reacciones. Pero SÍ quitar cualquier panel admin de moderar reactions/comments si existe. Si no encuentras tal panel, dejas admin.html sin cambios y lo reportas. |

### REGLAS FIRESTORE — quitar bloques (no las pego yo, las propones tú)

En `docs/firestore-rules-*.txt` y en las reglas activas (que viven en
Firebase Console — el worker NO toca consola, solo propone):

- Bloque entero `match /reactions/{videoId}` con TODO lo anidado:
  `comments/{commentId}` y `participants/{participantId}`.
- Bloque `match /{path=**}/participants/{participantId}` (collectionGroup
  para participants).

**Importante**: en el reporte deja el bloque de rules NUEVO completo
(listo para que Isaac pegue en Firebase Console), igual que se hizo en
Etapa 13 (clip_states/). El bloque catch-all final se queda.

### Sospechas a verificar (avisa si encuentras)

- `clip.html` puede tener un mecanismo de "claim" del participante. Es la
  misma feature. Quitar.
- `header.js` puede tener listeners JS específicos para abrir/cerrar el
  menú "Puntazos del mes" — quitar si existen.
- Algún CSS en `assets/estilo.css` o `assets/card.css` podría tener
  referencias a clases tipo `.reaction-`, `.comment-`, `.claim-`,
  `.participant-`. Si existen y no se usan en ningún otro lugar, quitar.
  Si quedan duda (uso ambiguo), reportar y NO borrar.

## Tests de validación

1. **Branch limpia**: `git checkout -b etapa-14-limpieza` desde master, `git status` clean.
2. **Archivos borrados**: `ls mejores.html assets/reactions.*` devuelve "no such file".
3. **No quedan refs**: `grep -r "reactions\.\|reactions-\|mejores\.html\|comments-panel" --include="*.html" --include="*.js" --include="*.css"` no devuelve nada (excepto comentarios de código incidentales como `comments_count` en admin.html que son analíticos, no UI).
4. **Páginas core abren sin error**: abrir `index.html`, `lado.html`, `clip.html`, `jugador.html`, `perfil.html`, `entrada.html`, `mi-partido.html`, `resumen.html` localmente (sirviendo con `python -m http.server 8000`). DevTools Console: sin errores 404 (cargas de reactions.css/js fallidas), sin errores JS.
5. **No regresión auth/Firestore**: login con Google sigue funcionando en cualquier página. `matches/` y `clip_states/` siguen leyéndose (puedes verificar abriendo mi-partido.html con un partido activo si tienes acceso a uno).
6. **Index sin links rotos**: `grep "mejores.html" index.html` no devuelve nada.
7. **Header sin links rotos**: cargar cualquier página, abrir el menú hamburguesa, NO ver "Puntazos del mes".

## Reglas Firestore propuestas (las pones en el reporte)

Pega aquí el bloque NUEVO completo de las reglas (idéntico al de Etapa 13
pero con los bloques `reactions/` y `participants/` collectionGroup
removidos). El maestro las pasa a Isaac para que pegue en consola.

Importante: el catch-all `match /{document=**} { allow read, write: if false; }`
**se queda al final**. Si algo en la app aún escribe a `reactions/`,
fallará — pero ya no debería porque borraste el código que escribía.

## Formato del reporte

```
## REPORTE ETAPA 14 — Limpieza de mejores + reacciones + comentarios

### Resumen ejecutivo
…

### Archivos borrados
…

### Archivos editados (con líneas removidas)
…

### Bloques de UI removidos (HTML específico)
…

### CSS huérfano detectado y removido
…

### Reglas Firestore propuestas (bloque completo nuevo)
```
…
```

### Validaciones (7 con PASS/FAIL)
…

### Cosas que NO toqué (con justificación)
…

### Recomendación al arquitecto maestro
…
```

## Cómo empezar

1. `git checkout master && git pull && git checkout -b etapa-14-limpieza`.
2. Lee `mejores.html` solo lo suficiente para confirmar que es eliminable.
3. Lee `assets/reactions.js` solo para entender el alcance de lo que se
   borra (qué eventos engancha, qué colecciones lee/escribe).
4. Procede archivo por archivo siguiendo el mapa.
5. Sirve localmente con `python -m http.server 8000` y abre las páginas
   en el browser para validar.
6. Reporta y push.
