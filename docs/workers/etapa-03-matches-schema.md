# Etapa 3 — Esquema y módulo de partidos (`matches`)

## Objetivo

Diseñar e implementar la **capa de datos** para "partidos" (sesiones de juego) en Puntazo:

- Schema de Firestore para `matches/{matchId}`.
- Reglas de seguridad Firestore drafts.
- Módulo JS reusable `assets/matches.js` con API para crear, terminar, listar y consultar partidos, más asociación clip↔partido por ventana temporal.
- Documentación de arquitectura en `docs/matches-schema.md`.
- Test manual contra Firestore real.

**No** se construye ninguna UI en esta etapa. Las pantallas (entrada.html, mi-partido.html, resumen.html) son etapas posteriores que consumirán este módulo.

## Contexto

Puntazo es una plataforma de clips de pádel (puntazoclips.com). Hoy el jugador escanea un QR en cancha y cae en `lado.html?loc=X&can=Y&lado=Z`, que muestra los clips de las últimas 24 horas de esa cámara. **No existe ningún concepto de "partido"** — los clips son entidades sueltas con metadata embebida en el nombre del archivo: `Club_Cancha_Lado_DDMMYYYY_HHMMSS.mp4`.

El rediseño (branch `rediseno-jugador`) introduce este flujo:

```
QR → entrada → login → iniciar partido →
  durante el partido cada click del botón físico genera un clip →
  terminar partido → resumen visual compartible (Strava-style)
  con todos los clips del partido + stats.
```

Para que ese flujo exista necesitamos primero la capa de datos. Esa es esta etapa.

## Arquitectura relevante

**Backend ya existente:**

- Firebase Firestore (proyecto `puntazo-clips`). Colecciones en uso:
  - `reactions/{videoId}` — engagement de cada clip (counts de fuego/risa/etc, views, saves, comments_count, claims_count, total)
  - `reactions/{videoId}/comments` — comentarios
  - `reactions/{videoId}/participants` — claims de "soy yo"
  - `usuarios/{uid}/guardados` — clips guardados por usuario
  - `usuarios/{uid}/apariciones` — apariciones del usuario en clips

**Autenticación:**

- Firebase Auth con Google Sign-In.
- Acceso vía `window.PuntazoAuth` (ver [assets/auth.js](../../assets/auth.js)): `init()`, `signIn()`, `signOut()`, `requireAuth(callback)`, `currentUser`.
- Eventos: `puntazo:auth-changed`, `puntazo:auth-ready`.

**Helpers compartidos:**

- `window.PuntazoFirebase` (ver [assets/firebase-core.js](../../assets/firebase-core.js)): `db()`, `auth()`, `ensureApp()`, `ADMIN_EMAILS`, `isAdminEmail()`.

**Storage de clips:**

- Videos viven en Dropbox (URLs públicas directas).
- Metadata indexada en JSONs versionados en el repo:
  - `videos_index.json` (histórico completo)
  - `videos_recientes.json` (últimas 24h, este es el que carga `lado.html`)
  - `videos_vitrina.json` (destacados)
- Los regeneran workflows automáticos en `.github/workflows/` cada vez que llega un video del sistema local.

**Identificación de clip:**

- Cada clip se identifica por su nombre de archivo: `Club_Cancha_Lado_DDMMYYYY_HHMMSS.mp4`.
- Hay un parser de timestamp en [assets/script.js](../../assets/script.js) (función `parseFromName`). **Léelo antes de duplicar lógica.**

**Firestore Rules actuales:**

- Hay dos drafts en `docs/`: `firestore-rules-analytics.txt` y `firestore-rules-social.txt`. **Identifica cuál está realmente desplegada** (pregúntalo a Isaac si dudas; o revisa Firebase Console → Firestore → Rules). NO sobrescribas la regla deployada — añade nuevas reglas para `matches/` en un archivo nuevo.

## Archivos importantes (lee antes de empezar)

| Archivo | Por qué |
|---|---|
| [docs/workers/README.md](README.md) | Convención del modelo master/worker, branching, formato de reporte |
| [assets/firebase-core.js](../../assets/firebase-core.js) | Patrón del módulo (IIFE + `window.PuntazoXxx`) |
| [assets/auth.js](../../assets/auth.js) | Patrón para listeners de auth, `requireAuth`, eventos |
| [assets/reactions.js](../../assets/reactions.js) | Patrón para refs Firestore, escapado, listeners |
| `assets/script.js` (busca `parseFromName`) | Parser de timestamp del nombre del clip — **reusa, no dupliques** |
| [data/config_locations.json](../../data/config_locations.json) | Estructura clubes/canchas/lados |
| `docs/firestore-rules-analytics.txt` y `docs/firestore-rules-social.txt` | Rules existentes — extiende, no rompas |

## Alcance

Lo que **SÍ** debes hacer:

### 1. Schema `matches/{matchId}` en Firestore

Diseña los campos mínimos. Propuesta inicial (válida si no encuentras razón para cambiarla, pero analízala):

| Campo | Tipo | Descripción |
|---|---|---|
| `userId` | string | UID del dueño (Firebase Auth) |
| `loc` | string | ID del club (ej. "Puntazo") |
| `can` | string | ID de la cancha (ej. "Cancha1") |
| `lado` | string | ID del lado/cámara (ej. "LadoA") |
| `startedAt` | Timestamp | Cuándo arrancó el partido (server time) |
| `endedAt` | Timestamp \| null | Cuándo terminó; null mientras esté activo |
| `status` | string | "active" \| "ended" \| "cancelled" |
| `marcador` | object \| null | `{ sets: [[6,4],[3,6],[7,5]], ganador?: "team1"\|"team2" }` |
| `jugadores` | array | `[{ nombre, uid? }, ...]`, longitud 1-4. Opcional. |
| `clipCount` | number | Denormalizado para listar rápido (puede ser 0; se actualiza con un re-count al `end`) |
| `createdAt` | Timestamp | `serverTimestamp()` |
| `updatedAt` | Timestamp | `serverTimestamp()` actualizado en cada write |

Genera el `matchId` con `db.collection('matches').doc().id` (auto-ID de Firestore), **no** con fechas.

### 2. Firestore Security Rules

Crea `docs/firestore-rules-matches.txt` (nuevo archivo, no desplegado todavía) con reglas para `matches/`:

- **Read**: el dueño siempre. Otros usuarios solo si `status == "ended"` (los resúmenes son públicos para poder compartir).
- **Create**: solo usuario autenticado. `request.resource.data.userId == request.auth.uid`. `status` debe ser `"active"`. `startedAt`, `createdAt` se settean en el cliente con `serverTimestamp()` y la regla lo valida con `request.time`.
- **Update**: solo el dueño. Inmutables: `userId`, `loc`, `can`, `lado`, `startedAt`, `createdAt`. `endedAt` solo se puede settear una vez (no editar después).
- **Delete**: denegado. Para borrar usar `status = "cancelled"` vía update.

Documenta tu propuesta en comentarios dentro del archivo .txt.

### 3. Módulo `assets/matches.js`

Patrón IIFE + `window.PuntazoMatches`. API:

```javascript
PuntazoMatches.create({ loc, can, lado, jugadores?, marcadorInicial? })
  // → Promise<string>  matchId
  // Requiere user autenticado. Crea doc con status: "active",
  // startedAt: serverTimestamp(). Devuelve el matchId.

PuntazoMatches.end(matchId, { marcador? })
  // → Promise<void>
  // Setea status: "ended", endedAt: serverTimestamp(), marcador.
  // Recalcula clipCount via findClipsForMatch (best effort, no falla si el JSON no tiene los clips).
  // Solo el dueño.

PuntazoMatches.cancel(matchId)
  // → Promise<void>
  // Setea status: "cancelled". No setea endedAt.

PuntazoMatches.get(matchId)
  // → Promise<MatchDoc | null>

PuntazoMatches.listByUser(userId, { limit = 20, status? = null })
  // → Promise<MatchDoc[]>
  // Orden: startedAt desc. Filtro opcional por status.

PuntazoMatches.getActiveForUser(userId)
  // → Promise<MatchDoc | null>
  // Helper: devuelve el partido más reciente con status == "active", o null.

PuntazoMatches.findClipsForMatch(matchDoc)
  // → Promise<ClipMeta[]>
  // Baja videos_recientes.json (o el JSON apropiado), filtra:
  //   clip.loc == matchDoc.loc && clip.can == matchDoc.can && clip.lado == matchDoc.lado
  //   && clipTimestamp >= matchDoc.startedAt && clipTimestamp <= (matchDoc.endedAt || now)
  // Parsea timestamps usando la lógica de parseFromName de assets/script.js (importa o re-implementa cuidando que sea idéntica).
  // Devuelve array de objetos con shape { videoId, url, timestamp, ... } compatible con card.js.
```

Patrón de carga (sin breaking changes):

```javascript
(function () {
  "use strict";
  if (window.PuntazoMatches) return;
  // ...
  window.PuntazoMatches = { create, end, cancel, get, listByUser, getActiveForUser, findClipsForMatch };
})();
```

### 4. Documentación en `docs/matches-schema.md`

Documento separado del brief. Debe incluir:

- Diagrama ASCII de la colección `matches/` y sus relaciones con `reactions/`, `usuarios/`, y los JSONs de clips.
- Tabla completa de campos con tipos, restricciones y ejemplos.
- **Decisión clave documentada**: por qué la asociación clip↔partido es por ventana temporal (no por escritura explícita del clip al partido). Justifica con la limitación de que el pipeline Python local **no debe modificarse en esta etapa** y los clips se identifican por timestamp en el nombre.
- Casos edge documentados:
  - Partido sin `endedAt` (quedó activo); cómo cierra (`cancel` después de N horas en una etapa futura, no ahora).
  - Clip con timestamp fuera de la ventana (no asociado).
  - Dos partidos del mismo usuario solapados en distintos lados (cada uno toma sus clips).
  - Dos partidos solapados en el mismo lado (ambigüedad — documenta cómo se resuelve; recomendación: el último activo gana, o no permitir solape).

### 5. Test manual

Crea `docs/workers/etapa-03-test.html` (transitorio, se puede borrar después): página HTML mínima con botones que llamen a cada método del módulo y muestren el resultado. Carga Firebase Auth + módulo + auth.js. Login con cuenta Google.

Ejecuta los tests del bloque "Validaciones" y captura outputs (texto plano o screenshots) para el reporte.

## Fuera de alcance

**NO** hagas en esta etapa:

- Cualquier UI que el usuario final vea: `entrada.html`, `mi-partido.html`, `resumen.html` (son etapas 4, 5, 6).
- Modificar `lado.html`, `index.html`, `perfil.html`, `clip.html`, `jugador.html`, `mejores.html`, `dashboard.html`, `boton.html`, `explorar.html`, `locacion.html`, `cancha.html`, `admin.html`, ni ninguna otra página existente.
- Modificar `assets/script.js`, `assets/reactions.js`, `assets/card.js`, `assets/header.js`, `assets/auth.js`, `assets/firebase-core.js` (puedes leerlos; no editarlos).
- Tocar `data/passwords.json` (es Etapa 7).
- Tocar el pipeline Python local (`Puntazo-release - copia/` no está en este repo, no es tuyo) ni los workflows en `.github/workflows/`.
- Cloud Functions (todavía no hay infraestructura; lo evaluaremos en Etapa 11).
- Implementar Web Share API, html2canvas, foto de fondo (son Etapa 6).
- Mergear tu branch a `master` o a `rediseno-jugador`.

Si ves algo fuera de scope que parezca urgente: **anótalo** en el reporte como "Riesgo detectado" o "Recomendación al maestro". No lo arregles.

## Riesgos

1. **Sobrescribir Firestore Rules desplegadas**: hay dos drafts en `docs/`. NO subas reglas sin confirmar cuál está activa. Crea archivo NUEVO `docs/firestore-rules-matches.txt`.
2. **Colisión con `videoId`**: usa auto-ID de Firestore para `matchId`, no inventes basado en fechas.
3. **Costos Firestore**: define índices compuestos necesarios desde el principio:
   - `(userId, startedAt desc)` — para `listByUser`.
   - `(userId, status, startedAt desc)` — para `listByUser` con filtro de status y `getActiveForUser`.
   - Lista los índices en el reporte para que Isaac los cree en Firebase Console.
4. **Asociación clip↔match débil**: hoy la única forma de unir clip a match es por timestamp. Documenta el algoritmo claramente y advierte sus límites.
5. **Romper páginas existentes**: el módulo nuevo NO debe cargarse automáticamente en ninguna página ya en producción. Ninguna `<script src="matches.js">` en HTMLs existentes — solo en tu `etapa-03-test.html`.

## Validaciones

Ejecutar todas. Reportar status y output observado para cada una.

1. **Servidor local arriba**: `python -m http.server 8080` desde la raíz del repo. Acceder a `http://localhost:8080/docs/workers/etapa-03-test.html`.
2. **Login Google**: la página tiene botón de sign-in y autentica correctamente.
3. **`create` exitoso**: con valores fake (`loc: "Puntazo", can: "CanchaX", lado: "LadoA"`) devuelve `matchId`. Verifica en Firebase Console (`matches/` collection) que el doc existe con los campos esperados y `status: "active"`.
4. **`listByUser` correcto**: llama con tu UID, devuelve un array que incluye el match creado.
5. **`getActiveForUser` correcto**: devuelve el match creado.
6. **`end` correcto**: `PuntazoMatches.end(matchId, { marcador: { sets: [[6,4],[3,6],[7,5]] } })` → en Firebase Console el doc tiene `endedAt`, `marcador`, `status: "ended"`. `getActiveForUser` ahora devuelve `null`.
7. **`findClipsForMatch` correcto**: para un match con `loc/can/lado` que tenga clips en `videos_recientes.json` y `startedAt`/`endedAt` que abarquen los timestamps de algunos clips, devuelve esos clips y SOLO esos. Si no hay clips reales en la ventana, prueba con un match con fechas amplias (1h antes y después de un clip conocido).
8. **`cancel` correcto**: setea status a `"cancelled"` sin tocar `endedAt`.
9. **Rules drafts**: documenta que las reglas están en `docs/firestore-rules-matches.txt` listas para revisar — **no desplegadas**.
10. **No regresión**: abre `http://localhost:8080/admin.html`, `lado.html?loc=Puntazo&can=CanchaX&lado=LadoA`, `index.html`. Cada una debe cargar sin errores nuevos en consola. (Verifica que tu trabajo no rompió nada.)

## Definition of Done

- [ ] `assets/matches.js` creado, sigue patrón IIFE + `window.PuntazoMatches`.
- [ ] `docs/matches-schema.md` creado con tabla de campos, decisiones, casos edge.
- [ ] `docs/firestore-rules-matches.txt` creado con reglas drafts comentadas (no desplegadas).
- [ ] `docs/workers/etapa-03-test.html` creado y funcional contra Firestore real.
- [ ] Lista de índices Firestore requeridos incluida en el reporte.
- [ ] Las 10 validaciones ejecutadas y documentadas en el reporte.
- [ ] Branch `etapa-03-matches-schema` creada desde `master`, commits limpios, pusheada a GitHub.
- [ ] **NO** mergeada a master ni a `rediseno-jugador`.
- [ ] Cero modificaciones a archivos fuera del scope listado.

## Formato del reporte de regreso

Copia/pega del template en [docs/workers/README.md](README.md) — sección "Formato del reporte de regreso". Llena cada sección. Si una no aplica, escribe "N/A" — no la omitas.
