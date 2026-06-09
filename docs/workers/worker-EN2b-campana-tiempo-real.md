# Worker #8 — ETAPA EN2b: Campana en tiempo real (cliente onSnapshot)

## Título de etapa
EN2b — Cambiar `assets/notifications.js` de **agregación en el cliente** (3 queries en cada carga +
poll de 60s + "sin leer" en localStorage) a **un `onSnapshot`** sobre la colección que el servidor ya
escribe (`notifications/{uid}/items`, LIVE desde EN2a). El `read/readAt` del servidor reemplaza el
localStorage. Resultado: la campana se actualiza en tiempo real y el "leído" persiste entre dispositivos.

## Contexto (lo que YA está LIVE)
- **EN2a desplegado:** 3 Cloud Functions escriben/borran `notifications/{ownerUid}/items/{notifId}` en cada
  evento (solicitud de amistad, partido por confirmar, clip listo). Smoke test en prod OK.
- **Schema del item** (lo que vas a leer): `{ type, refId, icon, title, subtitle, href, createdAt, read, readAt }`.
  - `notifId` (= doc.id) es determinístico `type+"__"+refId`. Úsalo como id estable.
  - `refId` es el id de la fuente: para `friend_request` = friendshipId (para el botón "Aceptar").
- **Reglas LIVE:** el dueño LEE sus items y puede UPDATE **solo** `['read','readAt']` (marcar leído). create/delete
  son server-only. O sea: el cliente puede marcar leído, NO crear ni borrar.
- **EN1 (lo que vas a modificar):** `assets/notifications.js` ya tiene toda la UI (campana, panel, badge, montaje
  que sobrevive al re-render, botón Aceptar, supresión de los banners flotantes vía `PuntazoNotifications.active`).
  **Conserva TODO eso**; solo cambias la FUENTE de datos y el cálculo de "no leído".

## Archivos a LEER primero
- `assets/notifications.js` — el módulo a modificar. Mira: `refresh()` + `fetchFriendRequests/fetchMatchConfirms/
  fetchClipReady` (los REEMPLAZAS por el listener), `state.items`, `renderBadge/renderPanel/openPanel`, el
  `localStorage pz.notifs.seen.v1` (lo ELIMINAS), `startTimer/stopTimer` (ya no hace falta poll), `mountBell/unmountBell`.
- `assets/friends.js` — `acceptFriendRequest(friendshipId)` (el botón Aceptar lo sigue usando con `refId`).
- `assets/firebase-core.js` / cómo se obtiene `db()` (compat v9.23.0) para `onSnapshot`.

## Alcance (SOLO esto)
1. **Fuente = `onSnapshot`**: al montar la campana (usuario logueado), suscríbete a
   `db.collection("notifications").doc(uid).collection("items").orderBy("createdAt","desc").limit(30)`.
   En cada snapshot, mapea los docs a `state.items` (cada item = `Object.assign({id: doc.id}, doc.data())`),
   y vuelve a `renderBadge()` (+ `renderPanel()` si el panel está abierto). Tiempo real: sin poll de 60s.
2. **Badge = no leídos del SERVIDOR**: `unseenCount()` = nº de items con `read !== true`. Elimina el localStorage
   `pz.notifs.seen.v1` y toda su lógica (`loadSeen/saveSeen/seenSet/poda`).
3. **Abrir panel → marcar leído en el servidor**: al abrir, los items con `read !== true` se actualizan a
   `{ read: true, readAt: serverTimestamp }` (batch o `Promise.all` de updates; permitido por reglas). El badge baja
   a 0 cuando el snapshot refleje el cambio (o de inmediato, optimista). NO toques otros campos (las reglas lo niegan).
4. **Botón "Aceptar"** (friend_request): sigue llamando `acceptFriendRequest(it.refId)`. Tras aceptar, el trigger
   del servidor borra el notif → el `onSnapshot` lo quita solo (no hagas remove manual). Mantén el best-effort.
5. **Desuscribir** el listener en `unmountBell()` y al cerrar sesión (evita fugas / listeners duplicados). Re-montar
   crea uno nuevo; idempotente (si ya hay listener activo, no dupliques).
6. **Conserva intacto**: la campana/panel/estilos, el montaje que sobrevive a `updateNavUI`, la supresión de los
   banners flotantes (`PuntazoNotifications.active = true`), el estado vacío "No tienes notificaciones".

## FUERA de alcance (NO tocar)
- Backend (`functions/`), `firestore.rules` (ya LIVE), motor de ranking. NO `firebase deploy`.
- Los vigías `match-confirm-watcher.js` / `pending-pulse-watcher.js`: déjalos (su banner ya está suprimido por
  `.active`). Quedan algo redundantes pero inofensivos — su limpieza es deuda aparte, no de esta etapa.
- Registrar/confirmar/claiming, ligas, perfil, head-to-head. No agregar tipos nuevos de notif (eso es backend).

## Migración / cuidados
- **Sin backfill:** las notifs solo existen para eventos POSTERIORES al deploy de EN2a. El estado pendiente previo
  (hoy: cero — backend limpio) no genera notifs hasta que cambie. Es aceptable; NO intentes re-agregar las 3 fuentes
  viejas como respaldo (eso reintroduce la complejidad que EN2b elimina). Si el maestro quiere sembrar el estado
  actual, lo hace con un backfill server-side aparte.
- `onSnapshot` puede emitir con `metadata.hasPendingWrites` (escrituras locales optimistas) — no es problema, pero
  si marcas leído optimista, evita parpadeos recalculando el badge desde `state.items` ya actualizado.
- Maneja error del listener (permiso/red) con `onSnapshot(next, error)` → degrada a panel vacío sin romper el header.
- `createdAt` puede venir `null` un instante (serverTimestamp pendiente) → el `orderBy` lo coloca al final/!
  tolera `null` en el render (ya hay `tsToMs`).
- Cero mojibake. JS web ajeno sin commitear (`matches.js`, `ranking.js`, `ranking-read.js`) → NO incluir; `git stash -u`.

## Validaciones (tests reales)
- `node --check assets/notifications.js`.
- (Pídele al maestro sembrar) una solicitud de amistad y/o un partido por confirmar → la campana los muestra
  **sin recargar** (tiempo real); el badge cuenta no-leídos; abrir el panel los marca leídos y el badge baja a 0;
  recargar en OTRO dispositivo/pestaña mantiene "leído" (server-side). Aceptar una solicitud la quita sola.
- Sin sesión: no hay campana ni errores. Cerrar sesión desuscribe (sin listeners colgados). Sin regresiones del header.
- Verifica que ya NO se usa `pz.notifs.seen.v1` (localStorage) y que no quedó el poll de 60s.

## Definition of Done
- `assets/notifications.js` lee por `onSnapshot` de `notifications/{uid}/items`, badge = no-leídos del servidor,
  abrir marca `read/readAt`, listener se desuscribe al desmontar/cerrar sesión. localStorage de "sin leer" eliminado.
- UI/montaje/supresión de banners intactos. Tiempo real funcionando.
- Commit quirúrgico + push a master (commit acotado → `git stash -u` → `fetch` → `rebase origin/master` → `push`
  → `stash pop`). SIN desplegar Firebase. NO incluir el JS web ajeno.

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA EN2b
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
