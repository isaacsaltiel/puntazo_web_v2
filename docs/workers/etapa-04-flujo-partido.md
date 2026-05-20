# Etapa 4 — Flujo iniciar partido (entrada + CTA en lado + mi-partido mínima)

## Objetivo

Cerrar el flujo end-to-end **"escaneo de QR → iniciar partido → terminar partido"** consumiendo la capa de datos de Etapa 3 (`assets/matches.js`). Tres deliverables tightly-coupled:

1. **`entrada.html` (NUEVO)** — landing post-QR para los QRs físicos futuros (Etapa 12). 2 opciones según sesión: invitado o login + iniciar partido.
2. **`mi-partido.html` (NUEVO mínima)** — pantalla del partido activo. Info + botón Terminar (con modal de marcador) + botón Cancelar. Sin cronómetro grande ni polling en vivo (eso es Etapa 5).
3. **`lado.html` (MODIFICAR)** — agregar un banner CTA arriba de la lista de clips: para usuarios autenticados muestra "Iniciar partido" o "Continuar partido activo". Para no autenticados no muestra nada (preserva comportamiento actual).

Este conjunto permite por primera vez que un jugador autenticado **use el flujo de partidos end-to-end con un QR físico ya impreso**.

## Contexto

Puntazo es una plataforma de clips de pádel (puntazoclips.com). Hasta Etapa 3, la app trata los clips como entidades sueltas en `lado.html`. Etapa 3 introdujo la colección Firestore `matches/` y el módulo `assets/matches.js` para crear, terminar, cancelar y consultar partidos.

El rediseño completo del flujo del jugador es:

```
QR → entrada → login → iniciar partido →
  durante el partido cada click del botón físico genera un clip →
  terminar partido → resumen visual compartible (Strava-style)
  con todos los clips del partido + stats.
```

Esta etapa cubre la mitad inicial: **arrancar y terminar el partido**. El resumen tipo Strava llega en Etapa 6. El cronómetro/polling avanzado en Etapa 5. Las stats reales de visión en Etapa 8.

**Constraint clave sobre QRs físicos**: los QRs impresos hoy apuntan a `lado.html?loc=X&can=Y&lado=Z` directamente. Cambiar los QRs físicos requiere imprimir y distribuir nuevos — eso es Etapa 12. Mientras tanto, el flujo nuevo debe ser accesible desde `lado.html` también (por eso el CTA banner). `entrada.html` se construye en esta etapa para que Etapa 12 sólo tenga que regenerar los QRs.

## Arquitectura relevante

**Capa de datos (Etapa 3, ya en `rediseno-jugador`):**

- `assets/matches.js` (módulo IIFE + `window.PuntazoMatches`). API:
  - `create({ loc, can, lado, jugadores?, marcadorInicial? }) → Promise<matchId>` — requiere user autenticado
  - `end(matchId, { marcador? }) → Promise<void>` — usar shape canónica del marcador (ver §5 abajo)
  - `cancel(matchId) → Promise<void>`
  - `get(matchId) → Promise<MatchDoc | null>`
  - `listByUser(userId, { limit?, status? }) → Promise<MatchDoc[]>`
  - `getActiveForUser(userId) → Promise<MatchDoc | null>` — devuelve el último `active` del user
  - `findClipsForMatch(matchDoc) → Promise<ClipMeta[]>` — clips dentro de la ventana del partido

- **Shape canónica del marcador** (Firestore prohíbe nested arrays):
  ```javascript
  marcador = {
    sets: [
      { team1: 6, team2: 4 },
      { team1: 3, team2: 6 },
      { team1: 7, team2: 5 }
    ],
    ganador: "team1"  // opcional: "team1" | "team2"
  }
  ```
  `validateMarcador()` en `matches.js` lanza error si recibe `sets: [[6,4],...]`.

**Auth (existente):**

- `window.PuntazoAuth` (`assets/auth.js`): `signIn()`, `signOut()`, `requireAuth(callback)`, `currentUser`.
- Eventos en `window`: `puntazo:auth-changed` y `puntazo:auth-ready`.
- Si Firebase Auth no está listo, `currentUser` es `null`; **espera al evento `puntazo:auth-ready`** antes de consultarlo en lógica crítica.

**Helpers compartidos:**

- `window.PuntazoFirebase` (`assets/firebase-core.js`): `db()`, `auth()`, `ADMIN_EMAILS`, `isAdminEmail()`, `config`.
- `assets/header.js`: header consistente del sitio (logo Puntazo + login button). Reusable insertando `<div id="nav-root"></div>`.

**Páginas existentes que NO tocas (excepto lado.html):**

- `index.html` — landing comercial, no se toca.
- `clip.html`, `mejores.html`, `perfil.html`, `jugador.html`, `dashboard.html`, `admin.html` — fuera de scope.
- `explorar.html`, `locacion.html`, `cancha.html`, `boton.html`, `inicio.html` — fuera de scope.

**Estilo / tokens CSS:**

- `assets/estilo.css` define la paleta global. Identifica `--blue`, `--blue2`, `--card`, `--text`, `--muted` y otros tokens — reúsalos. NO inventes paleta nueva.
- Tipografía: Montserrat (ver cualquier HTML existente para el link Google Fonts).
- Si necesitas un token nuevo (color, spacing) anótalo en "Recomendaciones al maestro" — no lo agregues a `estilo.css` (eso es módulo compartido).

## Archivos importantes (lee antes de empezar)

| Archivo | Por qué |
|---|---|
| [docs/workers/README.md](README.md) | Convención del modelo, formato del reporte. Nota: tu **branch base es `rediseno-jugador`**, NO master. |
| [docs/workers/etapa-04-flujo-partido.md](etapa-04-flujo-partido.md) | Este brief. Fuente de verdad. |
| [docs/matches-schema.md](../matches-schema.md) | Modelo de datos completo. Léelo. |
| [assets/matches.js](../../assets/matches.js) | API que vas a consumir. Léelo. |
| [assets/auth.js](../../assets/auth.js) | Patrón de uso de Firebase Auth, modal de login, eventos. |
| [assets/firebase-core.js](../../assets/firebase-core.js) | Helpers compartidos. |
| [assets/header.js](../../assets/header.js) | Header reusable; cómo se inyecta. |
| [assets/script.js](../../assets/script.js) | Cómo `lado.html` lee query params y monta el DOM. NO modificar; sólo entender. |
| [lado.html](../../lado.html) | Estructura actual. Identifica dónde inyectar el banner sin romper nada. |
| [data/config_locations.json](../../data/config_locations.json) | Para mapear `loc/can/lado` IDs a nombres legibles ("Puntazo · Cancha X · Lado A"). |
| [docs/workers/etapa-03-test.html](etapa-03-test.html) | Ejemplo de cómo usar `matches.js` con auth y log. |

## Alcance

### 1. `entrada.html` (NUEVO)

- Mobile-first. Reusa tokens CSS de `assets/estilo.css` (paleta, tipografía, radios).
- Carga, en este orden, en `<head>`:
  - Firebase compat SDK (`firebase-app`, `firebase-firestore`, `firebase-auth`) — mismas versiones que el resto del sitio (busca en otros HTMLs).
  - `assets/firebase-core.js`
  - `assets/auth.js`
  - `assets/matches.js`
  - (opcionalmente `assets/header.js` si reusas el header — si lo haces, mete `<div id="nav-root"></div>`)
- Lee query params `?loc=X&can=Y&lado=Z`. **Si falta cualquiera, muestra un error claro** ("Faltan parámetros del QR — vuelve a escanear") y un link a `index.html`. No procedas.
- Muestra (encima de los botones) un encabezado con nombre del club + cancha + lado (mapeado vía `config_locations.json`).
- **Lógica según sesión** (escucha `puntazo:auth-ready` para evitar race):

  Si `PuntazoAuth.currentUser != null` (autenticado):
  - **Botón principal grande** (azul, paleta `--blue`): "🎾 Iniciar partido en esta cancha"
    - On click: llama `PuntazoMatches.create({ loc, can, lado })`. Tras éxito redirect a `mi-partido.html?matchId=<id>`.
    - Tener manejo de error visible (toast o mensaje inline).
  - **Botón secundario** (link discreto): "Solo quiero ver los clips" → redirect a `lado.html?loc=&can=&lado=`.
  - Footer pequeño: "Sesión: <email> · cerrar sesión" (llama `PuntazoAuth.signOut()` y recarga).

  Si `currentUser == null` (no autenticado):
  - **Botón principal**: "Continuar como invitado" → redirect a `lado.html?loc=&can=&lado=`.
  - **Botón secundario**: "Iniciar sesión / crear cuenta" (estilo Google sign-in) → llama `PuntazoAuth.signIn()`. Tras login exitoso, la página debe re-renderizar mostrando los botones de autenticado (puedes recargar o reactivar via el evento `puntazo:auth-changed`).

- Sin loaders complicados. Una pantalla simple, mobile-first.

### 2. `mi-partido.html` (NUEVO mínima)

- Mobile-first. Mismas dependencias en `<head>` que entrada.html. Header consistente (reusa `header.js`).
- **Requiere usuario autenticado**: si no hay sesión, muestra "Necesitas iniciar sesión para ver tu partido" + botón signIn. No avanzar.
- **Lectura de query params**:
  - Modo "ver/operar partido" (esperado): `?matchId=X`.
  - Modo "creación inline" (utility): `?nueva=1&loc=&can=&lado=` — la página llama `PuntazoMatches.create(...)`, obtiene el `matchId`, **reemplaza la URL con `?matchId=X` usando `history.replaceState`** (para que F5 funcione) y entra al modo "ver/operar".
  - Si falta `matchId` y tampoco hay flags de creación, mostrar error claro.
- **Modo "ver/operar partido"**:
  - `PuntazoMatches.get(matchId)`. Si devuelve `null`, mostrar "Partido no encontrado" + link a `index.html`.
  - Validar que `match.userId === PuntazoAuth.currentUser.uid`. Si no, mostrar "Este partido no es tuyo" (no leakear data).
  - Mostrar **info del partido** (card mobile-first):
    - Nombre del club + cancha + lado (resuelve IDs via `config_locations.json`).
    - "Iniciado a las HH:MM del DD/MM" (parsea `match.startedAt`).
    - Chips de jugadores (si `match.jugadores` no está vacío).
    - Badge de status: `active` (verde) / `ended` (gris) / `cancelled` (rojo claro).
  - **Si `status === "active"`**:
    - Botón grande (verde o azul): **"Terminar partido"** → abre modal:
      - 3 filas de input numérico, una por set: "Set 1: Eq.1 [_] Eq.2 [_]" / "Set 2: ..." / "Set 3: ...". Solo Set 1 obligatorio.
      - Toggle/selector opcional: "Ganador: Equipo 1 / Equipo 2 / no especificar".
      - Botón "Guardar y terminar" → arma `marcador` con shape canónica `{ sets: [{team1, team2}, ...], ganador? }` (omite sets con ambos campos vacíos) → llama `PuntazoMatches.end(matchId, { marcador })` → redirect a `lado.html?loc=&can=&lado=&matchId=<id>` (lado.html no usa `matchId` aún, pero pasarlo permite que Etapa 5 lo aproveche sin tocar URLs ahora).
      - Botón "Cancelar" del modal (cierra sin guardar).
    - Botón secundario discreto: **"Cancelar partido"** → `confirm("¿Cancelar este partido?")` → `PuntazoMatches.cancel(matchId)` → redirect a `lado.html?loc=&can=&lado=`.
    - **Placeholder deshabilitado**: "🎯 Pedir clip ahora (próximamente — usa el botón físico de la cancha por ahora)". Sólo decoración. NO implementar la lógica de pedir clip — eso es Etapa 8C.
  - **Si `status === "ended"` o `"cancelled"`**:
    - Mostrar el marcador formateado (si existe), por ejemplo `6-4 · 3-6 · 7-5`.
    - Botón "Volver a clips de esta cancha" → redirect a `lado.html?loc=&can=&lado=`.
    - NO mostrar Terminar/Cancelar.

### 3. `lado.html` (MODIFICAR — banner CTA)

- En el `<head>`, después de `auth.js`, agregar `<script src="/assets/matches.js"></script>`. (Único cambio en el `<head>`.)
- En el `<body>`, **inmediatamente después de `<div id="nav-root">` y antes del contenido principal** (verifica la estructura), insertar un `<div id="pz-match-banner"></div>` vacío (sólo un placeholder).
- En un nuevo `<script>` al final del `<body>` (después de todos los demás scripts), agregar lógica que:
  1. Lee `?loc=&can=&lado=` (los mismos query params que ya usa `script.js`).
  2. Escucha `puntazo:auth-ready` y `puntazo:auth-changed`.
  3. Si user **no autenticado**: NO renderiza nada en `#pz-match-banner` (deja el div vacío).
  4. Si user **autenticado**:
     - Llama `PuntazoMatches.getActiveForUser(currentUid)`.
     - Si devuelve un match Y `match.loc === loc && match.can === can && match.lado === lado`:
       - Renderiza banner **azul oscuro**: "🎾 Tienes un partido en curso aquí · **[Continuar →]**". El botón redirect a `mi-partido.html?matchId=<id>`.
     - Si no hay match activo relevante:
       - Renderiza banner **azul claro**: "🎾 Inicia un partido para guardar tus puntazos aquí · **[Iniciar partido]**". El botón llama `PuntazoMatches.create({ loc, can, lado })` y redirect a `mi-partido.html?matchId=<id>`.
  5. **Todo el código va en `try/catch`**: si `matches.js` no carga, o si la query falla, NO mostrar banner y NO romper el resto de la página. Los clips deben seguir mostrándose normal.
- **NO modificar nada más en `lado.html`**: ni el listado de clips, ni la lógica de gate, ni los estilos existentes. El banner usa tokens CSS existentes inline o en un `<style>` corto al final del HTML.

## Fuera de alcance

NO hacer:

- Modificar `assets/matches.js` (si descubres bug, anota en "Recomendaciones al maestro").
- Modificar `assets/firebase-core.js`, `assets/auth.js`, `assets/script.js`, `assets/card.js`, `assets/reactions.js`, `assets/header.js`, `assets/estilo.css`.
- Modificar cualquier página que no sea `lado.html` (no tocar `index.html`, `clip.html`, `mejores.html`, `perfil.html`, `jugador.html`, `dashboard.html`, `admin.html`, `explorar.html`, `locacion.html`, `cancha.html`, `boton.html`, `inicio.html`).
- Cronómetro grande / contador de clips en vivo / polling de Firestore (eso es Etapa 5).
- Filtrar la lista de clips en `lado.html` por `matchId` (eso es Etapa 5).
- Implementar el botón digital "Pedir clip ahora" (eso es Etapa 8C; aquí solo el placeholder deshabilitado).
- Crear `resumen.html` (eso es Etapa 6).
- Modificar Firestore Rules (ya están deployadas para `matches/`).
- Tocar workflows en `.github/workflows/` o pipeline Python local (`Puntazo-release - copia/`, fuera de este repo).
- Generar QRs físicos nuevos (eso es Etapa 12).
- Cambiar la paleta o los tokens CSS globales.

Si descubres algo fuera de alcance que parezca crítico: anótalo en "Recomendación al maestro" en el reporte. NO lo arregles.

## Riesgos

1. **Romper `lado.html` en producción**: es el destino de los QRs físicos. Tu banner debe ser totalmente aditivo y defensivo. Si `matches.js` falla por cualquier razón, el banner no aparece y el resto de la página debe funcionar igual. **Todo el código nuevo en `lado.html` va en `try/catch`** + verifica que los selectores existen antes de manipularlos. Prueba en incógnito y con/sin sesión.
2. **Race condition de auth**: `entrada.html` y `lado.html` deben esperar `puntazo:auth-ready` antes de decidir qué renderizar. Si renderizas antes, el usuario autenticado verá la UI de invitado durante un segundo.
3. **Bucle de redirect en `mi-partido.html?nueva=1`**: tras crear el match, usa `history.replaceState` (NO `location.replace`) para cambiar la URL a `?matchId=X` sin recargar. Si recargas, podrías re-crear infinitamente.
4. **Marcador con sets vacíos**: si el usuario llena solo Set 1, no envíes `sets[1]` y `sets[2]` con valores `NaN` o `undefined` — omite los sets vacíos. Validación: cada set incluido en el array debe tener `team1` y `team2` como números enteros >= 0.
5. **Validación de ownership en `mi-partido.html`**: las Firestore Rules permiten lectura pública de matches con `status === "ended"`. Eso significa que si un user A entra a `mi-partido.html?matchId=Y` de un partido ajeno terminado, el `get()` devuelve el doc. Tu UI debe distinguir y NO permitir operaciones (terminar/cancelar) sobre partidos ajenos — mostrar "Este partido no es tuyo".
6. **Conflict con `script.js`**: `lado.html` carga `script.js` que ya tiene su propio `DOMContentLoaded`. Tu script extra debe ejecutarse DESPUÉS, sin pisarse. Pon el `<script>` nuevo después de los existentes en el HTML y usa otro `DOMContentLoaded` o IIFE asíncrona.

## Validaciones

Servidor local: `python -m http.server 8080` desde la raíz del repo. Login con tu cuenta Google (`isaacsaltiel@gmail.com` o cualquiera que ya tenga acceso al proyecto Firebase). Test contra Firestore real.

Ejecutar y reportar status (✅/❌/⏭️) + output observado para cada una:

1. **entrada.html sin params** → `http://localhost:8080/entrada.html` → muestra error claro, no avanza.
2. **entrada.html con params, sin sesión** → `http://localhost:8080/entrada.html?loc=Puntazo&can=CanchaX&lado=LadoA` (en incógnito) → ves "Continuar como invitado" y "Iniciar sesión".
3. **entrada.html → invitado** → click "Continuar como invitado" → te lleva a `lado.html?loc=Puntazo&can=CanchaX&lado=LadoA`.
4. **entrada.html → login** → click "Iniciar sesión" → popup Google → tras login la pantalla se actualiza y ves "Iniciar partido en esta cancha" + footer con tu email.
5. **entrada.html → iniciar partido** → click "Iniciar partido en esta cancha" → en Firebase Console ves nuevo doc en `matches/` con `status: "active"` → te lleva a `mi-partido.html?matchId=<id>`.
6. **mi-partido.html?matchId=X (active)** → ves nombre cancha, hora inicio, chips de jugadores (vacío si no se pasaron), badge "active", botón "Terminar partido" + botón "Cancelar partido" + placeholder deshabilitado.
7. **mi-partido.html → Terminar** → click "Terminar partido" → modal con 3 sets. Llena Set 1 con `6-4`, Set 2 con `3-6`, deja Set 3 vacío. Click "Guardar y terminar" → en Firebase Console el doc tiene `status: "ended"`, `endedAt` poblado, `marcador: { sets: [{team1:6,team2:4},{team1:3,team2:6}] }`. Redirect a `lado.html?...&matchId=<id>`.
8. **mi-partido.html?matchId=X (ended)** → ves marcador formateado, NO ves botones Terminar/Cancelar, ves "Volver a clips de esta cancha".
9. **mi-partido.html → Cancelar** → crea otro match en entrada.html → en mi-partido click "Cancelar partido" → confirm → en Firebase Console doc tiene `status: "cancelled"`. Redirect a `lado.html`.
10. **mi-partido.html con matchId ajeno**: pídele a otra cuenta (o crea match con cuenta A, intenta cargar `mi-partido.html?matchId=X` con cuenta B): debe mostrar "Este partido no es tuyo". NO debe permitir operar.
11. **lado.html sin sesión** → `http://localhost:8080/lado.html?loc=Puntazo&can=CanchaX&lado=LadoA` (incógnito) → NO ves banner. Los clips se muestran normal (regresión cero).
12. **lado.html con sesión, sin match activo en esa cancha** → ves banner azul claro "Inicia un partido para guardar tus puntazos aquí". Click → crea match + redirect a `mi-partido.html`.
13. **lado.html con sesión, con match activo en esa cancha** → vuelve a entrada.html, inicia partido nuevo (sin terminarlo). Abre `lado.html?loc=Puntazo&can=CanchaX&lado=LadoA` → ves banner azul oscuro "Tienes un partido en curso aquí · Continuar →". Click → te lleva a `mi-partido.html?matchId=<id>`.
14. **lado.html con sesión, match activo en OTRA cancha** → tu partido activo es en `Puntazo/CanchaX/LadoA`, abre `lado.html?loc=Scorpion&can=Cancha1&lado=LadoA` → ves banner azul claro de "Iniciar partido" (NO el de "Continuar"), porque tu match activo no es de esa cancha.
15. **Mobile responsive** → en DevTools toggle device toolbar a iPhone SE (375×667): entrada.html, mi-partido.html y lado.html (con banner) se ven bien, botones tappables (≥44px de altura), no scroll horizontal.
16. **No regresión en clips** → en `lado.html?loc=Puntazo&can=CanchaX&lado=LadoA`, los clips se cargan y se ven igual que antes (reactions, claim, share, etc. todos funcionando).
17. **Consola del navegador** → en cada página, abre DevTools → Consola: no debe haber errores JS nuevos. Warnings preexistentes están OK (anótalos pero no son blockers).

## Definition of Done

- [ ] `entrada.html` creado y funcional (validaciones 1-5).
- [ ] `mi-partido.html` creado y funcional, modos active/ended/cancelled + modo "?nueva=1" (validaciones 6-10).
- [ ] `lado.html` modificado: agregado script de matches.js, div placeholder, IIFE del banner con try/catch. Cero líneas modificadas en lógica existente de clips (validaciones 11-14, 16).
- [ ] Mobile-first verificado en DevTools mobile viewport (validación 15).
- [ ] Cero errores nuevos en consola JS (validación 17).
- [ ] Las 17 validaciones ejecutadas y reportadas en el formato del README.
- [ ] Branch `etapa-04-flujo-partido` creada **desde `rediseno-jugador`** (NO desde master), commits limpios, pusheada a GitHub.
- [ ] **NO** mergeada a `rediseno-jugador` ni a `master`.
- [ ] Cero modificaciones a archivos fuera del scope listado.

## Formato del reporte de regreso

Copia del template en [docs/workers/README.md](README.md) — sección "Formato del reporte de regreso". Llena cada sección. Si una no aplica, escribe "N/A". Reporte tipo bloque de texto listo para copiar/pegar.
