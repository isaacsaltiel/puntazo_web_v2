# Worker #6 — ETAPA EN1: Centro de notificaciones (campana 🔔) v1

## Título de etapa
EN1 — Campana de notificaciones en el header (todas las páginas internas) que **consolida en un
solo lugar** las señales hoy dispersas: solicitudes de amistad, partidos por confirmar, y clips
listos. Con contador de "sin leer". **Cliente puro** — sin tocar backend, functions ni reglas.

## Por qué (contexto real)
Isaac topó el hueco probando: al agregar a alguien de amigo, **la solicitud no le "salta" al otro**
en ningún lado — solo la ve si entra a `amigos.html`. En cambio "partido por confirmar" y "clip listo"
sí tienen banner flotante (vigías). La campana unifica todo eso (y deja lugar para que luego entren
invitaciones a ligas, "alguien reclamó tu lugar", etc.). Es la pieza que hace sentir VIVA la plataforma.

## Visión en 2 fases (construye SOLO la v1)
- **v1 (ESTA etapa, cliente):** la campana junta lo que YA sabemos consultar desde el navegador
  (las mismas queries de los vigías + `listPendingRequests`). Se refresca al cargar, cada 60s y al abrir.
  Sin backend. *Limitación honesta a documentar:* solo se actualiza cuando el usuario abre el sitio.
- **v2 (FUTURA, NO ahora):** colección `notifications/{uid}/items` escrita por Cloud Functions en cada
  evento (habilita leído/no-leído persistente y push/email). Diseña la v1 con un **shape de notificación
  estable** para que v2 entre encima sin rehacer la UI.

## Shape de notificación (úsalo como contrato; v2 producirá lo mismo)
```js
{ type: "friend_request" | "match_confirm" | "clip_ready",
  id: "<id estable y único por notif>",   // p.ej. "friend:"+friendshipId, "match:"+matchId, "clip:"+pulseId
  icon: "🤝" | "🎾" | "🎬",
  title: "…",                              // 1 línea, fuerte
  subtitle: "…",                           // contexto corto
  href: "/amigos.html" | "/confirmar.html?id=…" | "/perfil.html?pulse=…#mis-puntazos",
  ts: <number ms para ordenar, best-effort> }
```

## Archivos a LEER primero
- `assets/header.js` — render del header (variant `internal`), `.pz-nav-right--internal` (contiene phone CTA +
  clips CTA + `.pz-auth-slot`), `window.updateNavUI(user)`, evento `puntazo:header-rendered`, y el patrón del
  banner "partido en curso" (`bootstrapAuth` carga cosas vía `ensureScript`; cargar AQUÍ tu `notifications.js`).
- `assets/match-confirm-watcher.js` — query y filtro EXACTO de "partidos por confirmar" (reúsalo).
- `assets/pending-pulse-watcher.js` — detección de "clip listo" y el link `perfil.html?pulse=<id>#mis-puntazos` (reúsalo).
- `assets/friends.js` — `listPendingRequests()` (devuelve [{friendshipId, fromUid, profile}]) y `acceptFriendRequest(fid)`.
- `assets/estilo.css` y los estilos inline del header (tokens, glassmorphism, `.pz-auth-dropdown` como patrón del panel).

## Alcance (SOLO esto)
1. **`assets/notifications.js` NUEVO** (módulo, `window.PuntazoNotifications`):
   - Construye la **campana** (botón 🔔 + badge numérico) y la inserta en `.pz-nav-right--internal`
     **antes de** `.pz-auth-slot`. Solo visible si hay sesión. Sobrevive a `updateNavUI` (es hermano del slot,
     no hijo). Móntala al `puntazo:header-rendered` y en `puntazo:auth-ready/changed`.
   - **Panel desplegable** (mismo patrón visual que `.pz-auth-dropdown`: glass, right-aligned, responsive)
     con la lista de notificaciones (icono + título + subtítulo, clickable → `href`). Estado vacío:
     "No tienes notificaciones". Cierra al click-fuera/scroll (reusa el patrón del header).
   - **Agregador** `refresh()` que junta las 3 fuentes en paralelo y produce arreglos del shape de arriba:
     - `friend_request`: `PuntazoFriends.listPendingRequests()` → por cada uno, título "Te mandó solicitud de
       amistad", subtítulo el nombre (de `profile`), `href:"/amigos.html"`. (Opcional: botón "Aceptar" inline
       que llama `acceptFriendRequest` y refresca — si lo haces, best-effort, no rompas la lista si falla.)
     - `match_confirm`: replica el filtro de `match-confirm-watcher` (matches `array-contains` mi uid, status
       `pending_confirmation`, `userId != yo`, `scoreAcceptedBy[yo] != true`, no vencido) → `href:"/confirmar.html?id="+id`.
     - `clip_ready`: replica la detección de `pending-pulse-watcher` → `href:"/perfil.html?pulse="+id+"#mis-puntazos"`.
   - **Badge "sin leer":** cuenta items cuyo `id` no esté en `localStorage` `pz.notifs.seen.v1` (set de ids vistos).
     Al ABRIR el panel, marca como vistos los ids mostrados (el badge baja a 0). Total mostrado en el panel = todos;
     el badge = solo no-vistos.
   - Refresca al montar, cada **60s**, y al abrir el panel.
2. **Cargar `notifications.js` desde `header.js`** (1 línea en `bootstrapAuth`, vía el `ensureScript` existente,
   tras cargar auth) para que aparezca en TODAS las páginas internas sin tocarlas una por una. (Si `ensureScript`
   no encaja, un `<script src>` al final de header — pero preferible que el header lo orqueste.)
3. **Jubilar los banners flotantes absorbidos:** en `match-confirm-watcher.js` y `pending-pulse-watcher.js`,
   al inicio de su `render`/`check`, si `window.PuntazoNotifications && window.PuntazoNotifications.active`,
   **no** pintar el banner flotante (la campana ya los muestra). `notifications.js` setea `.active = true` al montar.
   (2 líneas por archivo; reversible.) **NO** toques el banner verde "partido en curso" de `header.js` — ese
   es un estado distinto (juego en curso) y se queda.

## FUERA de alcance (NO tocar)
- Backend (`functions/`), `firestore.rules`, motor de ranking, scoring. NO `firebase deploy`. NO colección
  `notifications/` (eso es v2). NO push/FCM/email.
- El banner verde "partido en curso" (header.js `checkActiveMatchBanner`) — déjalo intacto.
- Registrar/confirmar/claiming flows, ligas, head-to-head, nav links.
- No cambiar la lógica de datos de friends/matches/pulses; solo LEER para agregarlas.

## Riesgos / cuidados
- La campana debe sobrevivir al re-render del auth-slot (`updateNavUI` reescribe SOLO `[data-auth-slot]`).
  Móntala como hermano dentro de `.pz-nav-right--internal`, idempotente (no duplicar si ya existe).
- En páginas sin `.pz-nav-right--internal` (variants `landing`/`embedded`), NO montar (o montar solo en `internal`).
- `listPendingRequests`/match/pulse pueden fallar o venir vacías → degradar con gracia (campana sin badge, panel "sin notificaciones"); ningún throw debe romper el header.
- No spamear lecturas: 60s de intervalo, y cancelar el timer si el user cierra sesión.
- `getProfile` por cada solicitud puede tardar → no bloquear el badge (pinta lo que tengas, hidrata después).
- z-index: el panel por encima del contenido pero coherente con el header; el badge legible.
- CRLF/mojibake: cero `�`. Hay JS web ajeno sin commitear (`matches.js`, `ranking.js`, `ranking-read.js`) → NO incluir; aislar con `git stash -u`.

## Validaciones (tests reales)
- `node --check` de `notifications.js`, `match-confirm-watcher.js`, `pending-pulse-watcher.js`, `header.js`.
- Repaso manual logueado: la campana aparece junto al avatar en páginas internas; con una solicitud de amistad
  pendiente, el badge muestra 1 y el panel la lista con link a amigos; con un partido por confirmar, aparece y
  linkea a confirmar; abrir el panel baja el badge a 0; recargar mantiene "visto"; sin notifs → estado vacío.
- Verifica que los banners flotantes de confirmar/clip **ya no** se pintan (los muestra la campana), y que el
  banner verde "partido en curso" SÍ sigue.
- Sin sesión: no hay campana, sin errores de consola. Sin regresiones en el header (burger, dropdown de perfil).
- (Si necesitas datos: pídele al maestro sembrar una solicitud/partido de prueba.)

## Definition of Done
- `assets/notifications.js` con la campana + panel + agregador + badge "sin leer" (localStorage), cargada por header.js en todas las internas.
- Banners flotantes de confirmar/clip absorbidos (no se duplican); banner verde intacto.
- Shape de notificación estable (listo para v2). Cliente puro, sin backend.
- Commit quirúrgico + push a master (commit acotado → `git stash -u` → `fetch` → `rebase origin/master` → `push` → `stash pop`). SIN desplegar Firebase. NO incluir el JS web ajeno.

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA EN1
### Resumen ejecutivo
### Archivos modificados
### Decisiones técnicas tomadas (con justificación)
### Bugs encontrados
### Riesgos detectados
### Qué quedó pendiente
### Qué validaciones se hicieron (tests reales)
### Resultado (qué quedó funcionando)
### Recomendación al arquitecto maestro (siguiente etapa)
```
