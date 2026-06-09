# Worker #9 — ETAPA E3c: Invitados persistentes ("Gabo de ayer = Gabo de hoy")

## Título de etapa
E3c — Que los jugadores dummy del dueño sean **reutilizables**: al registrar un partido con un invitado
sin cuenta (p.ej. "Gabo"), se guarda como invitado persistente bajo `users/{uid}/guests`; la próxima vez
"Gabo" aparece como sugerencia y se reusa el MISMO `guestId`. El slot dummy del match guarda
`guestId + ownerUid`, para que las sugerencias retroactivas + merge (E4) y el claim puedan ligar
"todos los partidos de Gabo". CLIENTE PURO — las reglas de `guests` ya están LIVE (E3a); sin deploy.

## Por qué (decisión de producto, Isaac)
"Yo ya ayer metí un dummy de Gabo y hoy también jugué con él; que pueda meterlo como el mismo Gabo y que,
cuando él entre a su cuenta, se confirme/sugiera." E3c construye la base: **persistir + reusar** invitados.
Las sugerencias retroactivas y el merge/borrar duplicados son E4 (siguiente). Aquí: persistir, reusar y
ligar `guestId` en los slots.

## Contexto (lo que YA existe)
- **Reglas LIVE (E3a):** `users/{uid}/guests/{guestId}` → `allow read, write: if isMe(uid)` (solo el dueño).
  Forma esperada: `{ name, searchName, createdAt, lastUsedAt, claimedByUid|null }`.
- **Forma del dummy en un match (E3a):** `{ nombre, equipo, guestId, ownerUid, uid:null }`. Un jugador con
  cuenta es `{nombre, equipo, uid}`. **PERO** hoy `matches.js sanitizeJugadores` (línea ~84) SOLO conserva
  `nombre/equipo/uid/claimedByUid` → **DESCARTA `guestId/ownerUid`**. Hay que extenderlo (ver Alcance #2).
- **`assets/identity.js`** — reusa `normalizeName`/`buildSearchName` (o equivalente) para el `searchName` del
  guest, MISMO criterio que usa para users (consistencia de búsqueda por prefijo).
- **`assets/match-actions.js` `register(opts)`** — construye `jugadores` vía `PM()._sanitizeJugadores`. Punto
  central por donde pasa TODA registración (registrar-min, mi-partido) → buen lugar para asegurar/attachear guests.
- **`assets/player-autocomplete.js`** — pool de sugerencias desde `recentPlayers`/matches; `attach(input, opts)`
  con `opts.global`. Aquí agregas los guests guardados al pool.
- **`registrar-min.html`, `mi-partido.html`** — donde se attachea el autocomplete y se arman los jugadores.

## Alcance (SOLO esto)
1. **API de invitados** — nuevo `assets/guests.js` (`window.PuntazoGuests`), cliente puro sobre `users/{uid}/guests`:
   - `listMyGuests()` → array `{ guestId, name, searchName, lastUsedAt, claimedByUid }` (orden por `lastUsedAt` desc).
   - `ensureGuest(name)` → busca por `searchName` normalizado; si existe, actualiza `lastUsedAt` y devuelve su
     `{guestId, name}`; si no, crea `{name, searchName, createdAt, lastUsedAt, claimedByUid:null}` y lo devuelve.
     **Dedup por searchName** (mismo criterio que identity). Best-effort: si falla, devuelve null (no rompe el registro).
   - `renameGuest(guestId, name)` y `deleteGuest(guestId)` (CRUD básico para gestión; ver #4).
   - Reusa `normalizeName/buildSearchName` de identity.js para `searchName` (NO dupliques la normalización).
2. **Preservar `guestId/ownerUid` en el match** — extiende `matches.js sanitizeJugadores`: si el raw trae
   `guestId` (string) y/o `ownerUid` (string) **y NO trae uid**, consérvalos en el `out`. (Un jugador con `uid`
   real no lleva guestId.) Sin romper el comportamiento actual (uid/claimedByUid siguen igual).
3. **Hook en el registro** — en `match-actions.register`, para cada jugador dummy (sin `uid`) con `nombre` no vacío:
   `await PuntazoGuests.ensureGuest(nombre)` → si devuelve guest, attachea `guestId` + `ownerUid = miUid` al slot
   ANTES de escribir el match. Best-effort y en paralelo (`Promise.all`); si la API de guests no está o falla, el
   registro procede igual con el dummy plano (no rompas el flujo ni la transacción). NO cambies la lógica de
   confirmación/claim.
4. **Sugerencias de invitados en el autocomplete** — en `player-autocomplete.js`, incluye los guests del dueño
   (`listMyGuests`) en el pool de sugerencias (junto a recentPlayers), dedup por searchName, marcados visualmente
   como invitado (p.ej. "· invitado"). Al elegir un guest, el campo queda con su nombre (el `ensureGuest` del
   registro lo reconciliará al MISMO guestId por searchName). No rompas el modo `global` (búsqueda de users) ni el
   "crear nuevo" que ya existe.
5. **Gestión mínima de invitados** — una vista simple para LISTAR mis invitados con opción de **renombrar** y
   **borrar** (reusa `listMyGuests/renameGuest/deleteGuest`). Puede ser una sección nueva en `amigos.html`
   (pestaña/bloque "Mis invitados") siguiendo su estilo. (El MERGE de duplicados y las sugerencias retroactivas
   "también eres tú en estos partidos" son **E4**, NO aquí.)

## FUERA de alcance (NO tocar / dejar para E4+)
- **Sugerencias retroactivas** (mismo guest en otros pendientes) y **merge** de duplicados → E4.
- Backend/functions/reglas (las de `guests` ya están LIVE) — NO `firebase deploy`.
- Motor de ranking, scoring, el flujo de claim/decline/confirm (no cambies su lógica; solo agregas guestId al dato).
- Ligas, head-to-head, nav, notificaciones.

## Riesgos / cuidados
- **`sanitizeJugadores` es el cuello:** si no preservas guestId/ownerUid ahí, los slots nunca llevarán el guest.
  Verifica el ida-y-vuelta: registrar con guest → leer el match → el slot dummy trae `guestId/ownerUid`.
- **Best-effort:** registrar NUNCA debe fallar por la persistencia de guests (API caída, sin permiso, etc.).
- **Dedup consistente:** usa EXACTAMENTE la misma normalización que identity (`searchName`) para que "Gabo",
  "gabo", "GABO " sean el mismo guest. Evita crear duplicados por mayúsculas/espacios/acentos.
- **No metas guests con cuenta:** si el jugador tiene `uid` (cuenta real), NO le crees guest ni guestId.
- **claimedByUid:** déjalo en null aquí (lo usará E4/claim). No lo toques en E3c salvo crearlo en null.
- **Privacidad:** los guests son del dueño (reglas isMe). No los expongas en vistas públicas.
- CRLF/mojibake: cero `�`. JS web ajeno sin commitear (`matches.js` ←¡ojo, este SÍ lo tocas!, `ranking.js`,
  `ranking-read.js`) → si `ranking.js`/`ranking-read.js` están sin commitear y NO son tuyos, aíslalos con
  `git stash -u`; pero tu cambio a `matches.js` (sanitizeJugadores) SÍ va en tu commit. Revisa el diff antes de commitear.

## Validaciones (tests reales)
- `node --check` de `guests.js`, `matches.js`, `match-actions.js`, `player-autocomplete.js`.
- (Pídele datos/escenario al maestro si hace falta) Registrar un partido con un dummy "Gabo" logueado → en
  `users/{uid}/guests` aparece un guest "Gabo" (searchName normalizado); el slot del match trae `guestId/ownerUid`.
  Registrar OTRO partido con "gabo" → reusa el MISMO guestId (no duplica), `lastUsedAt` se actualiza.
- El autocomplete sugiere "Gabo" tras el primer uso; elegirlo reusa el guestId.
- Renombrar/borrar un invitado desde la gestión funciona. Sin regresión en registrar/confirmar de cuentas reales.
- Sin login: nada de guests, sin errores.

## Definition of Done
- `assets/guests.js` (list/ensure/rename/delete) + `sanitizeJugadores` preserva guestId/ownerUid + register attachea
  guests best-effort + autocomplete sugiere guests + gestión mínima (listar/renombrar/borrar).
- Reusar invitado por nombre NO duplica (dedup por searchName). Registro nunca se rompe por la persistencia.
- Commit quirúrgico + push a master (commit acotado → `git stash -u` → `fetch` → `rebase origin/master` → `push`
  → `stash pop`). SIN desplegar Firebase. Cuida no colar el JS web ajeno ajeno a tu cambio.

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA E3c
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
