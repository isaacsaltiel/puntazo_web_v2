# Worker #11 — ETAPA E6: LIGAS · estructura + miembros (sin tabla todavía)

## Título de etapa
E6 — Construir el **esqueleto de las ligas**: crear una liga (modo individual/parejas + 1ª temporada),
verla, invitar/unirse por link, y dar de alta miembros por buscador. **SIN la tabla de posiciones**
(eso es E7). CLIENTE + un bloque chico de reglas (seasons) que **prueba en emulador** y **despliega el
maestro**. Reutiliza `groups.js` y la estructura probada de `grupo.html`/`grupos.html` — NO reinventes.

> Lee el diseño maestro completo antes de empezar: `docs/plans/diseno-ligas-2026-06-08.md`.
> Las decisiones LOCKED de Isaac están en §12 de ese doc. Esta etapa es la FASE E6 de §11.

## El insight (por qué E6 es ~70% reuso)
**Una liga = un GRUPO (`type:"liga"`) + un bloque `league` + temporadas.** Ya existe TODO el andamiaje de
grupos: doc + subcolección `members`, invite-code, join por link, roles admin. E6 sólo **añade la capa liga**
encima: config (modo/parejas), 1ª temporada, y páginas con sabor de liga. La TABLA es E7.

---

## Lo que YA existe (verifícalo leyendo, no asumas)

### `assets/groups.js` — `window.PuntazoGroups` (LEER COMPLETO)
Schema REAL de `groups/{groupId}` que escribe `createGroup`:
```
{ groupId, name, description, type:"friends|residencial|club|liga", photoURL,
  createdAt, creatorUid, admins:[uid], memberCount, matchCount, isPublic,
  inviteCode, rules:{ rankingScope:"members_only", matchVisibility:"members_only" } }
```
`groups/{groupId}/members/{uid}` = `{ uid, joinedAt, invitedBy, role:"admin|member", displayName, photoURL, isActive }`.
API actual: `createGroup({name,description,type,isPublic})` → groupId · `getGroup` · `listMyGroups` (collectionGroup
members where uid==me) · `listGroupMembers` · `joinGroup(groupId,{invitedBy})` (SELF, incrementa memberCount) ·
`leaveGroup` · `kickMember` · `addAdmin` · `removeAdmin` · `updateGroup(groupId,changes)` (whitelist
name/description/type/photoURL/isPublic) · `generateInviteLink(groupId,inviteCode)` →
`/grupo.html?groupId=…&invite=…`.
**OJO — diferencias con el diseño doc (el doc estaba idealizado):**
- **NO existe `memberUids` array** en el doc del grupo. NO lo necesitas en E6 (el heurístico ≥3 de E7 es
  server-side y leerá la subcolección `members` con Admin SDK). **No lo agregues** salvo que aporte; evita
  sincronizarlo. (Si E7 lo pide, se añade ahí.)
- `createGroup` **NO acepta** un bloque `league` ni temporadas → **lo extiendes** (abajo).
- Roles: el grupo lleva `admins:[uid]` (array) Y cada member doc lleva `role`. Respeta ambos como hoy.

### `grupo.html` (LEER COMPLETO) — tu PLANTILLA para `liga.html`
Home de grupo ya funcional: estados loading/error/notmember/content, join por `?invite=`, lista de miembros
con avatar/rol, bloque invite (copiar + WhatsApp), salir, race-fix auth (`puntazo:auth-ready`/`auth-changed`
+ `isBootstrapped`). Tiene un placeholder "Ranking interno · Próximamente". **Reusa su CSS (`.gr-*`) y su
estructura**: `liga.html` es este patrón + sabor liga (modo, temporada, placeholder de tabla).

### `grupos.html` — tu PLANTILLA para `ligas.html`
"Mis grupos" (listMyGroups) + crear grupo. `ligas.html` = mismo patrón filtrando `type=="liga"` + crear liga.

### `clasificacion.html` — estilo de TABLA (para E7, referencia)
NO construyes tabla en E6, pero mira su estilo: E7 reusará ese look para los standings.

### Reglas Firestore (`firestore.rules`, bloque `match /groups/{groupId}`, ~línea 301)
- `groups/{id}`: read=`signedIn()`; create exige `creatorUid==auth.uid` + `admins is list` + `auth.uid in admins`
  + `createdAt==request.time` (NO restringe campos extra ⇒ el bloque `league` y la `season` inicial pasan);
  update exige `auth.uid in resource.data.admins`; delete=creador.
- `members/{uid}`: read=signedIn; create/update/delete = **self OR group-admin** (⇒ un admin SÍ puede dar de
  alta a otro uid: `members/{thatUid}` create permitido para admin). collectionGroup members read=signedIn.

---

## Alcance E6

### A. `groups.js` — extender para ligas (sin romper grupos existentes)
1. **`createGroup` acepta `opts.league` y `opts.season`** (retrocompatible: si no vienen, comportamiento idéntico).
   Cuando `type=="liga"`:
   - Escribe en el doc un bloque `league` = `{ mode:"individual"|"pairs", sport:"padel", pointsWin:3,
     pointsLoss:0, countThreshold:3, activeSeasonId:<id>, pairs:[ {pairId,uids:[a,b],name} ] }`
     (`pairs` SOLO si mode=="pairs"; el creador las define en la UI).
   - Crea en el MISMO batch `groups/{id}/seasons/{seasonId}` = `{ seasonId, name, startMs, endMs,
     createdAt:serverTimestamp(), closed:false }` y pone `league.activeSeasonId=seasonId`.
   - `seasonId` = `groupRef.collection("seasons").doc().id` (genéralo ANTES del batch para referenciarlo en `league`).
2. **`addMember(groupId, uid, profile)`** (NUEVO) — para "alta por buscador": un admin crea
   `members/{uid}` (rule lo permite). Escribe `{uid, joinedAt, invitedBy:me, role:"member",
   displayName, photoURL, isActive:true}` + incrementa `memberCount`. Best-effort sobre el increment.
   Idempotente: si ya existe el member, no dupliques (lee primero, como `joinGroup`).
3. **Temporadas (helpers mínimos):** `listSeasons(groupId)` · `getActiveSeason(groupId)` ·
   `createSeason(groupId,{name,startMs,endMs})` (admin; genera id, set doc, y `updateGroup`-style set de
   `league.activeSeasonId`). **`closeSeason` y campeón = E7, NO aquí.**
4. **`updateLeagueConfig(groupId, changes)`** (NUEVO, admin) — set acotado de `league.activeSeasonId` y
   campos de config NO estructurales. **`mode` NO se puede cambiar** (cambiarlo invalida historia — recházalo).
5. **`listMyLeagues()`** = `listMyGroups()` filtrado `type=="liga"` (conveniencia para `ligas.html`).
6. **`generateInviteLink`**: para ligas el link debe llevar a `liga.html` (no grupo.html). Hazlo
   parametrizable o añade `generateLeagueInviteLink(groupId,inviteCode)` → `/liga.html?id=…&invite=…`.
   (Usa `id` como nombre del param en liga.html, o reusa `groupId`; sé consistente con lo que lea liga.html.)

> Mantén las firmas viejas intactas. NO toques la lógica de grupos genéricos. Todo lo nuevo es aditivo.

### B. `ligas.html` (NUEVO) — "Mis ligas" + crear
- Lista `listMyLeagues()` (tarjetas: nombre, modo, # miembros, temporada activa). Vacío → CTA "Crear tu primera liga".
- Botón **"Crear liga"** → modal/sección con: nombre, **modo (individual | parejas)**, deporte (pádel fijo v1),
  **1ª temporada** (nombre + fecha inicio/fin → `startMs/endMs`). Si **parejas**: UI para definir las parejas
  (elegir 2 miembros/nombres por pareja + nombre "Ana & Beto"). v1 mínimo aceptable: crear la liga con
  `pairs:[]` y permitir definirlas luego en `liga.html` (decide y documenta cuál haces; lo importante es que
  `mode` quede fijo al crear).
- "Unirme con link" (pegar link/inviteCode) → resolver groupId → `liga.html?...`.
- Reusa el patrón visual de `grupos.html`. Añade un link de entrada a `ligas.html` desde `grupos.html`
  (y si hay un lugar natural en el nav/dashboard, enlázalo; mínimo desde grupos.html).

### C. `liga.html?id={groupId}` (NUEVO) — home de la liga
Clona la estructura probada de `grupo.html` y adáptala:
- Estados loading/error/notmember/content + join por `?invite=` (mismo race-fix auth).
- Header: nombre, **badge de modo** (Individual / Parejas), **temporada activa** (nombre + rango), # miembros,
  botón compartir (copiar + WhatsApp con el league invite-link).
- **Miembros**: lista con avatar/rol (reusa `.gr-member*`). Si soy admin: **"Agregar miembro"** con buscador
  (`window.PuntazoIdentity.searchUsers` — verifica el nombre real del método en `identity.js`) → al elegir,
  `PuntazoGroups.addMember(groupId, uid, {displayName,photoURL})`. Auto-amistad best-effort con el nuevo
  miembro (decisión LOCKED #5; reusa el helper de amistad que ya usa el claim — localiza cómo lo hace
  `confirmar.html`/`friends.js`; si no es trivial, déjalo como TODO comentado, NO inventes).
- **Placeholder de tabla**: sección "Posiciones" con "🚧 La tabla aparece cuando jueguen partidos de la liga"
  (E7). NO calcules standings.
- Selector de temporadas (lista `listSeasons`) — v1 puede ser solo-lectura mostrando la activa; crear nueva
  temporada (admin) es opcional en E6 (si lo haces, usa `createSeason`).
- Salir de la liga (leaveGroup) + (admin) editar nombre.

### D. Reglas — `seasons` (ÚNICO cambio de reglas en E6)
Añade dentro de `match /groups/{groupId}`:
```
match /seasons/{seasonId} {
  allow read: if signedIn();
  allow create, update, delete: if signedIn()
       && request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.admins;
}
```
- El bloque `league` en el doc del grupo NO necesita regla nueva: lo escribe el creador en `create`
  (permitido) y lo edita un admin en `update` (permitido por `auth.uid in admins`).
- **Pruébalo en EMULADOR** (suite nueva `functions/itest/leagues-rules.js` con `@firebase/rules-unit-testing`,
  patrón de las suites existentes notifications-rules/friends-rules): admin crea/edita season ✓, no-admin
  no puede ✗, member lee ✓. **NO despliegues reglas** — el maestro las revisa y despliega.

---

## FUERA de alcance (NO tocar)
- **Standings / tabla / cómputo de posiciones** → E7. Solo placeholder.
- **Tagging de partidos (`groupId`/heurístico ≥3) y backend/functions** → E7 (server-side). NO toques functions.
- **Notif `league_invite`/`season_champion`** → E7 (pueden adelantarse, pero NO en E6).
- **`closeSeason`/campeón 🏆** → E7.
- **NO** agregues `memberUids` array (innecesario en E6; el heurístico E7 es server-side).
- **NO** cambies grupos genéricos (grupos.html/grupo.html) salvo añadir el link de entrada a ligas.html.
- **NO** cambies ranking/scoring/claim/confirm.

## Riesgos / cuidados
- **Retrocompat de `createGroup`:** el camino sin `league` debe quedar BIT-A-BIT igual (grupos siguen vivos).
  Añade los campos liga sólo si `type=="liga"` y vienen en opts.
- **`mode` inmutable:** bloquéalo en `updateLeagueConfig` (cambiarlo corrompe la historia de standings de E7).
- **searchUsers:** confirma el nombre/firma real en `assets/identity.js` antes de usarlo (no inventes API).
- **Auto-amistad:** reusa el mecanismo existente (NO crees un patrón nuevo de friendship). Si no lo ubicas
  con seguridad, déjalo como TODO comentado — mejor faltante que roto.
- **Invite-link consistente:** el param que escribe `generateLeagueInviteLink` DEBE ser el que lee `liga.html`
  (`id` vs `groupId`). Una sola convención.
- **Reglas:** sólo el bloque `seasons`. Pruébalo aislado en emulador (mata el 8080 antes; corre la suite SOLA).
  NO despliegues. NO toques otros bloques de reglas.
- **CRLF/mojibake:** cero `�`. Acentos correctos (Montserrat ya cargado).
- **JS web ajeno sin commitear** (`ranking.js` M / `ranking-read.js` untracked si aparecen): NO los incluyas;
  aísla tu commit (`git add` de TUS archivos puntuales; si hace falta stash, `git stash -u` sólo lo ajeno).
- **matches.js** ya está sano en HEAD; si aparece modificado en tu árbol y no es tuyo, NO lo toques.

## Validaciones (tests REALES, no narrativa)
- `node --check` de `groups.js` y de los `<script>` inline de `ligas.html`/`liga.html` (extrae a archivo temp si hace falta).
- **Lógica pura en Node** de cualquier helper extraíble (p.ej. construcción del bloque `league`/`season`,
  validación de `mode` inmutable, dedupe de addMember).
- **Emulador** (`functions/itest/leagues-rules.js`): seasons admin-only (crea/edita ✓ admin, ✗ no-admin, read ✓ member).
  Corre la suite SOLA (mata 8080 antes); reporta el conteo (X/X passing).
- (Pídele al maestro datos sembrados si quieres) Smoke local: crear liga individual → aparece en ligas.html →
  abrir liga.html → invitar (link) y unir un 2º usuario → alta por buscador → placeholder de tabla visible.
  Crear liga parejas → modo queda fijo. Sin login: sin crashes.

## Definition of Done
- `groups.js` extendido (createGroup con league+season, addMember, seasons helpers, listMyLeagues,
  updateLeagueConfig con mode inmutable, league invite-link) SIN romper grupos genéricos.
- `ligas.html` (mis ligas + crear liga con modo/temporada/parejas) y `liga.html` (home: header con
  modo+temporada, miembros + invite/join + alta por buscador + auto-amistad best-effort, placeholder de tabla)
  funcionando, reusando el patrón de grupos.
- Bloque de reglas `seasons` escrito y **probado en emulador** (NO desplegado).
- Commit quirúrgico + push a master (sólo tus archivos; sin colar JS ajeno).

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA E6
### Resumen ejecutivo
### Archivos modificados
### Decisiones técnicas tomadas (con justificación)
### Bugs encontrados
### Riesgos detectados
### Qué quedó pendiente
### Qué validaciones se hicieron (tests reales)
### Reglas: qué cambió y qué falta desplegar (para el maestro)
### Resultado (qué quedó funcionando)
### Recomendación al arquitecto maestro (siguiente etapa: E7 standings)
```
