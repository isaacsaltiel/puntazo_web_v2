# Worker #7 — ETAPA EN2a: Notificaciones server-side (backend + reglas, emulador, SIN desplegar)

## Título de etapa
EN2a — Cloud Functions que ESCRIBEN notificaciones en una colección por usuario al ocurrir cada
evento (solicitud de amistad, partido por confirmar, clip listo) + reglas Firestore de esa colección,
probadas 100% en emulador. **NO se despliega** (el deploy reconciliado lo hace el arquitecto maestro
tras revisar — lección del incidente 7-jun). Es la base para que la campana (EN1) pase a tiempo real
(EN2b) y, después, a push.

## Objetivo
Hoy la campana (EN1, `assets/notifications.js`) AGREGA en el cliente 3 fuentes en cada carga. EN2 la
vuelve server-authoritative: el servidor escribe `notifications/{uid}/items/{notifId}` en cada evento,
con `read/unread` persistente. EN2a construye SOLO el backend + reglas (emulador verde). EN2b (otra
etapa) cambiará el cliente a `onSnapshot`.

## Contexto que YA existe (leer obligatorio)
- `functions/index.js` — triggers v2 vivos: `onMatchConfirmed` (onDocumentWritten `matches/{id}`),
  `expireUnconfirmedMatches` (onSchedule), `recomputeAllRatings` (callable). `admin.initializeApp()` +
  `db = admin.firestore()` ya están. AQUÍ agregas los nuevos triggers, sin romper los existentes.
- `assets/notifications.js` (EN1) — el **SHAPE estable** que ya consume la UI:
  `{ type, id, icon, title, subtitle, href, ts }`. EN2 debe producir notifs compatibles (ver schema abajo).
- `assets/friends.js` — `friendships/{fid}` = `{ friendshipId, uidA, uidB, status:"pending"|"accepted"|"blocked",
  requesterUid, createdAt, acceptedAt }`. El RECEPTOR de una solicitud = el participante que NO es `requesterUid`.
- `assets/pending-pulse-watcher.js` — `pending_pulses` where `uid_creator == uid`; "listo" = `consumed_at && !error_reason`.
- `firestore.rules` — el ruleset RECONCILIADO vivo. AÑADES el bloque `notifications` sin romper nada.
- `functions/itest/rules-emu.js` y `functions/itest/friends-rules.js` — patrón de tests de reglas en emulador.

## Schema a definir (documéntalo en comentarios + reporte)
`notifications/{ownerUid}/items/{notifId}` =
```
{ type: "friend_request" | "match_confirm" | "clip_ready",
  refId: "<id de la fuente: friendshipId | matchId | pulseId>",
  icon, title, subtitle, href,            // mismos textos/campos que produce EN1
  createdAt: serverTimestamp,
  read: false, readAt: null }
```
**Idempotencia:** `notifId = type + "__" + refId` (un solo notif por evento). Crear-si-ausente; nunca duplicar.
**Limpieza:** cuando la condición de origen deja de aplicar, BORRA el notif (ver cada trigger).

## Triggers a construir (en `functions/index.js`, additive)
1. **`onFriendshipNotify`** (onDocumentWritten `friendships/{fid}`):
   - Si queda `status=="pending"`: escribe `friend_request` al RECEPTOR (participante != `requesterUid`).
     `title:"Te mandó solicitud de amistad"`, `subtitle:<nombre del requester>` (lee `users/{requesterUid}`),
     `href:"/amigos.html"`.
   - Si pasa a `accepted`: BORRA el `friend_request` del receptor. (Opcional, si te da tiempo: notifica al
     `requesterUid` "X aceptó tu solicitud" — type `friend_accepted`; si lo haces, agrégalo al schema/UI-shape como
     no-bloqueante. Si dudas, omítelo y déjalo para después.)
   - Si el doc se BORRA (reject) o queda `blocked`: BORRA el `friend_request` del receptor.
2. **`onMatchNotify`** (onDocumentWritten `matches/{id}`):
   - Si `status=="pending_confirmation"`: para CADA `uid` en `playerUids` que (a) `!= userId` (no el registrante)
     y (b) NO esté en `scoreAcceptedBy` → asegura un `match_confirm` en `notifications/{uid}/items`.
     `title:"Tienes un partido por confirmar"`, `subtitle:"<nombre del registrante> registró un partido contigo"`,
     `href:"/confirmar.html?id="+id`. Para los `uid` que YA aceptaron o que son el registrante → BORRA su `match_confirm` de ese match (si existiera).
   - Si `status != pending_confirmation` (confirmed/disputed/void/expired) → BORRA el `match_confirm` de ESE match
     en TODOS los `playerUids`. (Fan-out: este trigger escribe/borra en varias subcolecciones.)
   - OJO idempotencia/loops: estos writes son a `notifications/`, NO a `matches/` → no se auto-disparan. Igual,
     calcula el set objetivo y haz crear/borrar solo lo que cambie.
3. **`onPulseNotify`** (onDocumentWritten `pending_pulses/{id}`):
   - Si `consumed_at && !error_reason`: escribe `clip_ready` a `uid_creator`.
     `title:"Tu puntazo ya está listo"`, `subtitle:"El clip que pediste ya se procesó"`,
     `href:"/perfil.html?pulse="+id+"#mis-puntazos"`.
   - Si tiene `error_reason` o se borra → BORRA el `clip_ready` (si existiera).

> Mantén los TÍTULOS/SUBTÍTULOS/ICONOS/HREF idénticos a los que EN1 ya produce (mismo shape visual),
> para que EN2b solo cambie la FUENTE (de agregación cliente → `onSnapshot`) sin tocar el render.

## Reglas a agregar (en `firestore.rules`, set reconciliado)
`match /notifications/{ownerUid}/items/{notifId}`:
- `allow read: if isMe(ownerUid);`  (solo el dueño lee sus notifs)
- `allow update: if isMe(ownerUid)` y que el diff toque SOLO `['read','readAt']` (marcar leído). NADA más.
- `allow create, delete: if false;`  (solo el servidor/Admin SDK escribe/borra — Admin omite reglas).
No rompas ningún bloque existente. Reusa el helper `isMe(uid)` ya presente.

## Tests a agregar (emulador, dejar 100% verde)
- Crea `functions/itest/notifications-rules.js` (patrón de `friends-rules.js`): dueño LEE sus items
  (`assertSucceeds`); otro usuario NO (`assertFails`); dueño marca `read:true` (`assertSucceeds`); dueño intenta
  cambiar `title` (`assertFails`); cliente intenta `create`/`delete` (`assertFails`).
- (Si el harness lo permite) un test de integración de los triggers con el emulador de Functions: crear una
  friendship pending → aparece el notif en el receptor; aceptarla → desaparece. Si el setup de Functions-emulator
  es costoso, basta razonar la lógica + unit-test puro de la función que calcula el set objetivo (extráela pura).
- No rompas `rules-emu.js` (22/22) ni `friends-rules.js` (5/5).

## Alcance (SOLO esto)
Editar `functions/index.js` (3 triggers + helpers), `firestore.rules` (bloque notifications), tests nuevos.
Documentar schema. Emulador verde. Commit + push. **SIN `firebase deploy`.**

## FUERA de alcance (NO tocar / NO hacer)
- **NO `firebase deploy`** (ni functions ni reglas). El maestro revisa y despliega el set reconciliado.
- NO el cliente (`assets/notifications.js` / la UI) — eso es EN2b. Solo LEE EN1 para alinear el shape.
- NO push/FCM/email (fase posterior). NO tocar el motor de ranking, scoring, claiming, ligas.
- NO cambiar `onMatchConfirmed`/`expire`/`recompute` salvo que sea estrictamente necesario para no chocar
  (si compartes helpers, no rompas su comportamiento; los tests existentes deben seguir verdes).

## Riesgos / cuidados
- **Fan-out del match:** escribe/borra en `notifications/{cada playerUid}/items` — usa batch/bulkWriter y
  calcula deltas (no reescribas lo que no cambia). Idempotente (notifId determinístico).
- **No-loops:** los triggers escriben en `notifications/`, no en su propia colección fuente → no se re-disparan.
- **Borrados:** maneja el evento de DELETE (after == null) sin romper.
- **Nombres:** lee `users/{uid}.displayName` para subtítulos; fallback "Alguien" si falta. Cero mojibake.
- **Reglas:** el incidente fue desplegar reglas WIP. Aquí NO despliegas; el archivo reconciliado lo valida el
  maestro en emulador antes de subir. Commitear el archivo NO lo despliega.
- Hay JS web ajeno sin commitear (`matches.js`, `ranking.js`, `ranking-read.js`) → NO incluir; aislar con `git stash -u`.

## Definition of Done
- 3 triggers en `functions/index.js` (additive), idempotentes, con limpieza al cambiar el estado de origen.
- Bloque `notifications` en `firestore.rules` (owner read, owner marca leído, server-only create/delete).
- Tests de reglas nuevos verdes + los existentes intactos. Schema + semántica documentados.
- Commit quirúrgico + push a master (commit acotado → `git stash -u` → `fetch` → `rebase origin/master` → `push`
  → `stash pop`). **SIN desplegar Firebase.**

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA EN2a
### Resumen ejecutivo
### Archivos modificados
### Decisiones técnicas tomadas (con justificación)
### Bugs encontrados
### Riesgos detectados
### Qué quedó pendiente
### Qué validaciones se hicieron (tests reales — incluye conteo del emulador)
### Resultado (qué quedó funcionando)
### Recomendación al arquitecto maestro (siguiente etapa)
### NOTA DE DEPLOY: confirmar que NO se desplegó nada y qué debe desplegar el maestro
```
