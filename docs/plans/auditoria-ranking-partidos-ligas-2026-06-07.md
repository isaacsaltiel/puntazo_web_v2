# Auditoria: Registro de partidos, Ranking y Ligas (2026-06-07)

> Auditoria maestra encargada por Isaac. Consolida 6 reportes de analizadores que leyeron codigo y docs reales del repo `puntazo_web_v2`. Las afirmaciones estructurales criticas (ausencia de `ratings/`, ausencia de `functions/`, `torneo5.html:1417` privado, `ranking-client.js` sin persistencia) fueron verificadas directamente en el codigo durante la redaccion. Lo no verificado se marca como tal.

---

## 0. Resumen ejecutivo

- **Lo solido:** El **registro de partidos** (`matches.js`, 1430 lineas + `mi-partido.html`, 8394 lineas) es el subsistema mas maduro: schema flexible 0-4 slots con `equipo` autoritativo, scoring real de padel/tenis/pickleball, live scoring con history stack, claims por subcoleccion, backward-compat de `string[]` legacy, y resumen tipo Strava funcional. El **flujo NUC -> pending_pulses -> clip -> Dropbox** esta vivo y funciona en BreakPoint y WellStreet.
- **Lo fragil:** El **ranking Glicko-2 NO se persiste en ningun lado**. `ranking-client.js` recalcula todo client-side en RAM cada vez que se abre `mi-nivel.html`, leyendo solo los 100 matches mas recientes (`ranking-client.js:64`), usando ratings de oponentes aproximados localmente (default 1500 para no-vistos). Verificado: cero escrituras a `ratings/{uid}`, no existe carpeta `functions/`. El ranking es **efimero, inconsistente entre dispositivos, y 100% manipulable** desde DevTools.
- **La Capa 2 (sesiones/modos) esta fragmentada en 4 islas:** King, Americano y Sortear son 100% localStorage sin nube; Torneo 5 sube a `users/{uid}/torneos5/active` (subcoleccion **privada**, no observable, no queryable por collectionGroup). Ningun modo escribe a `matches/`. No existe la coleccion `sessions/` especificada en `capa2-sessions-schema.md`.
- **Ligas/grupos son un esqueleto:** crear/unirse/invitar y amistades funcionan end-to-end, pero NO hay ranking interno por grupo (placeholder "Proximamente" en `grupo.html:151`), NO hay vinculo `match.groupId`, y el `inviteCode` es cosmetico (las reglas Firestore no lo validan: cualquiera con el `groupId` se une).
- **Riesgo #1 — Sin backend de computo (cero Cloud Functions):** ranking, idempotencia, notificaciones, y validacion de resultados estan delegados al cliente. El cliente puede falsificar marcadores y el ranking nunca converge globalmente. Es el bloqueante raiz de ranking, ligas serias y notificaciones (F116 explicitamente bloqueado por esto).
- **Riesgo #2 — Privacidad no se aplica server-side:** `users/{uid}` tiene `allow read: if true`. Los settings de privacidad (`profile/clips/matches` -> public/friends/private) se guardan pero solo se respetan client-side (`firestore-rules-v100-fase3.md:192-194`). Hoy son decorativos; cualquiera puede leer datos "privados" directamente desde Firestore.
- **Riesgo #3 — Secretos en repos + fragilidad de reglas:** password NVR trackeado y SA JSON no-ignorado en los 3 NUCs; el outage de 2026-06-03/04 (ruleset `da0d0727` apreto `source` a allowlist incompleto y rompio TODOS los clubes) demuestra que un cambio de reglas sin grep previo tumba produccion.
- **Veredicto:** La base de **captura de datos** (partidos + clips) es solida y aguanta crecer. Pero la **vision de plataforma social** (ranking confiable, ligas con leaderboard, notificaciones, privacidad) **NO se sostiene sobre la arquitectura actual**, porque le falta la pieza central: una capa de computo servidor (Cloud Functions) que persista ratings, garantice idempotencia y aplique privacidad. Sin eso, todo lo "social" es UI sobre datos efimeros o manipulables. El camino critico es: **sanear secretos -> Cloud Function `onMatchEnded` + `ratings/{uid}` -> crear `sessions/` y vincular modos -> ligas con ranking interno**.

| Subsistema | Madurez | Bloqueante principal |
|---|---|---|
| Registro y marcador de partidos | Robusto | Idempotencia en `updateMatch()`; `equipo` stale tras claim; clipCount best-effort |
| Motor de ranking (Glicko-2) | Parcial (algoritmo OK, sin persistencia) | No existe Cloud Function ni `ratings/{uid}`; ranking efimero y manipulable |
| Sesiones y modos (Capa 2) | Parcial (4 islas desacopladas) | No existe `sessions/`; ningun modo alimenta `matches/` ni ranking |
| Ligas, grupos y social | Parcial (esqueleto funcional) | Sin ranking por grupo; sin `match.groupId`; inviteCode no validado; privacidad cosmetica |
| Backend / datos / flujo E2E | Funcional | Cero Cloud Functions; secretos en repos; fragilidad de reglas |

---

## 1. Estado actual por subsistema

### 1.1 Registro y marcador de partidos — Robusto

**Como funciona hoy:**
- Motor de datos en `assets/matches.js` (1430 lineas, patron IIFE). `sanitizeJugadores()` (`matches.js:84-105`) acepta 0-4 items string (legacy) u objetos `{nombre, equipo, uid?}`. El campo `equipo` es **autoritativo** y se deriva por posicion (`LEGACY_INDEX_TO_TEAM`) solo si falta (`matches.js:77-109`, verificado). `normalizeMatchFromDoc` convierte `string[]` legacy a objetos en memoria al leer.
- Scoring engine (`matches.js:223-306`): `validateSet()` implementa reglas reales de padel (6-0..6-4, 7-5, 7-6); **tiebreak desactivado (F79)** — un 6-6 queda incompleto y el siguiente game cierra 7-6 sin tiebreak. `validatePickleGame()` para pickleball; `deduceMatchWinner()` cuenta sets vs target (partido_3=2, partido_5=3).
- Live scoring (`matches.js:350-700`): `initLiveMarcador()`, `nextPointWinner()`, `undoLastPoint/undoLastGame` con history stack (max 200 ops). `_closeSet()` reinicia `current` y alterna saque a team1 default.
- API CRUD (`matches.js:1001-1057`): `create/end/cancel/get/listByUser/updateMatch`. `end()` recalcula `clipCount` via `findClipsForMatch()` (best-effort, `matches.js:1087-1098`).
- Claims (`matches.js:1219-1325`): subcoleccion `matches/{matchId}/claims/{uid}`. `subscribeToClaims()` ordena por `claimedAt`. `mergeMatchWithClaims()` (`matches.js:1296`) enriquece `jugadores[]` con uid de claims.
- UI: `mi-partido.html` (cancha visual 2x2 editable, modal terminar con validacion viva, cronometro, pulsos en vivo, modo invitado con claims). `resumen.html` (tarjeta Strava 540x960, coloreado por set, foto custom, compartir).

**Archivos clave:** `assets/matches.js` (1430), `mi-partido.html` (8394), `resumen.html` (2722), `mis-partidos.html` (325), `assets/scoreboard-card.js` (400), `assets/match-expiration.js` (250), `docs/matches-schema.md` (266).

**Hallazgos (por severidad):**
- **[ALTA · bug] `equipo` stale tras claim de invitado.** `mergeMatchWithClaims()` (`matches.js:1296-1325`) copia uid/claimedByUid/displayName pero NO recalcula/escribe `equipo` en el doc raiz. Si el doc tiene un `equipo` inconsistente, `splitTeams()` en `resumen.html:1494` (que agrupa por `j.equipo`) muestra equipos erroneos. *Nota: el codigo declara `equipo` autoritativo (`matches.js:79-83`), asi que el bug solo aplica si el doc raiz quedo con `equipo` incorrecto y el claim no lo corrige.*
- **[ALTA · gap] Sin idempotencia en `updateMatch()`** (`matches.js:1038-1057`): `await ref.update(upd)` sin transaction ni optimistic lock. Dos clicks rapidos en "Guardar" o dos PUTs por reintento de red se aplican fuera de orden, el segundo sobrescribe.
- **[MEDIA · inconsistencia] Estado de saque sin validacion.** `_closeSet()` (`matches.js:601-606`) resetea saque a team1; `_applyPoint()` no valida que el punto sea del equipo de saque. Sin UI para corregir saque en el modal terminar.
- **[MEDIA · bug] Pickleball target hardcoded a 11.** `validatePickleGame()` (`matches.js:279-297`) no acepta parametro target; existe `PICKLE_TARGET_DEFAULT=11` pero no soporta 15/21.
- **[MEDIA · deuda] `clipCount` best-effort sin garantia** (`matches.js:1087-1098`): si el JSON de clips falla, `console.warn` mudo y `clipCount` queda stale. Resumen muestra numero enganoso.
- **[MEDIA · bug] Race de dual-claim** sin resolucion fuerte: `mergeMatchWithClaims()` itera claims sin re-ordenar por `claimedAt` (el orden lo da el onSnapshot, no el merge).
- **[BAJA] Notas truncadas a 280 chars silenciosamente** (`matches.js:124-132`); sin UI de notas. `scoreAcceptedBy` (acceptance bilateral, `matches.js:1331-1369`) **implementado pero nunca usado** por la UI (feature muerta). Sin dedupe de jugadores por uid. Sin cascada de borrado de claims al cancelar. Riesgo de reloj del PC desfasado que tira clips fuera de la ventana `[startedAt, endedAt]` (`matches.js:906-952`).

### 1.2 Motor de ranking (Glicko-2) — Parcial: algoritmo OK, cero persistencia

**Como funciona hoy:**
- `assets/ranking.js` (443 lineas): Glicko-2 puro y bien disenado — `g()`, `E()`, `newVolatility()` (Newton-Raphson), `applyMatchToRatings()` (`ranking.js:245-415`) con MOV, anti-farm, decay RD, `bucketForRating()` (1.0-7.0 con emoji). **Nunca escribe Firestore** (verificado).
- `assets/ranking-client.js` (350 lineas): orquestador client-side. `fetchUserMatches()` (`ranking-client.js:62-117`) query `collectionGroup('claims')` + owned matches, **limit 100** (`ranking-client.js:64`, verificado). `processMatchesCumulative()` aplica ranking acumulativo en un mapa en RAM. `computeMyRating()` retorna todo en RAM, **nada persiste** (verificado: comentario explicito en `ranking-client.js:8` "NO se cachea en ratings/{uid}").
- `mi-nivel.html` (738 lineas): renderiza hero/buckets/sparkline/history desde el calculo de la sesion actual.

**Archivos clave:** `assets/ranking.js` (443), `assets/ranking-client.js` (350), `mi-nivel.html` (738), `docs/plans/ranking-social-v100-design.md` (1243, especifica la CF en §4.11 — NO implementada), `docs/plans/firestore-rules-v100-fase3.md` (`ratings/{uid}` con `allow write: if false`).

**Hallazgos (por severidad):**
- **[ALTA · bug] Ranking efimero client-side.** Cada apertura de `mi-nivel.html` recalcula desde cero. Consecuencias: (1) inconsistencia entre dispositivos, (2) manipulabilidad total via DevTools, (3) latencia alta con 100+ partidos.
- **[ALTA · gap] Cloud Function `onMatchEnded` NO existe** (verificado: no hay carpeta `functions/`). Sin ella: no hay idempotencia (`ratingProcessed`), no hay audit trail (`ratingAudit`), no hay persistencia global.
- **[ALTA · gap] Ratings de oponentes son aproximaciones locales** (default 1500 para no-vistos, `ranking-client.js:225-226`). Grafo desconexo: cuando llegue la CF con ratings globales, todo el historico sera invalido.
- **[ALTA · riesgo] Sin idempotencia, reprocesar un match duplica el cambio de rating** (`ratingProcessed` nunca se escribe).
- **[MEDIA · inconsistencia] Cap de 100 matches** descarta partidos antiguos silenciosamente.
- **[MEDIA · bug] Anti-farm no funciona entre sesiones:** `recentOpponents[]` vive en RAM, no se persiste (`ranking.js:360-387`). Cada recarga lo vacia; se puede granjear al mismo rival 10 veces.
- **[MEDIA · deuda] Decay RD y conservativeRating se recalculan efimeros**, no componen entre sesiones.
- **[MEDIA · riesgo] Manipulacion via DevTools** (no hay validacion servidor). *Nota: el cliente no puede escribir `ratings/` ni `matches/` ajenos por reglas; el ataque inflaria solo la UI propia, no el dato global — porque el dato global no existe.*
- **[BAJA] Group rankings y sparkline 7d historico** dependen de la CF inexistente; hoy son render de la sesion.

### 1.3 Sesiones y modos de juego (Capa 2) — Parcial: 4 islas desacopladas

**Como funciona hoy:**
- **King** (`king.html`, 627): estado en localStorage `pz.king.v1`. Winners stay, losers a cola. Leaderboard in-memory (`king.html:572-599`), sin nube, sin `matches/`.
- **Americano** (`americano.html`, 545): SCHEDULE hardcoded N=4, 3 rondas. localStorage. Leaderboard por puntos.
- **Sortear** (`sortear.html`, 315): generador stateless de parejas.
- **Torneo 5** (`torneo5.html`, 2807): unico con cloud sync, pero a `users/{uid}/torneos5/active` (`torneo5.html:1417`, verificado — subcoleccion **privada**). Sync por `_updatedAtMs` client-time (`torneo5.html:1394`), conflict resolution last-write-wins.

**Archivos clave:** los 4 HTML, `docs/plans/capa2-sessions-schema.md` (193, propuesta NO implementada), `docs/plans/torneo5-decisiones-integracion-f114.md` (84, decision de NO migrar).

**Hallazgos (por severidad):**
- **[ALTA · gap] No existe `sessions/` top-level.** King/Americano/Sortear 100% locales; Torneo 5 en subcoleccion privada no observable por otros ni por batch.
- **[ALTA · inconsistencia] Torneo 5 en path equivocado** (`users/{uid}/torneos5/active`): incompatible con multi-device share y con collectionGroup para Glicko-2 (decision F114 documentada).
- **[ALTA · gap] Ningun modo alimenta `matches/`.** Leaderboards efimeros, se pierden al refresh.
- **[MEDIA · gap] Pick-a-finger interactivo no existe** (solo `sortear.html` estatico). Americano no escala a N>4 (hardcoded). Sin auth/vinculacion uid en King/Americano/Sortear.
- **[MEDIA · riesgo] Conflict resolution client-time** (`torneo5.html:1444`): si 2 devices escriben, gana el reloj mas adelantado.
- **[BAJA] `bgPhoto` dataURL en localStorage** (riesgo de tope ~5-10MB con catch mudo). Sin aviso "sesion local, no guardada en la nube" en King/Americano.

### 1.4 Ligas, grupos y social — Parcial: esqueleto funcional

**Como funciona hoy:**
- Grupos (`assets/groups.js`, 251): `createGroup()` (`groups.js:48-91`) batch crea `groups/{id}` + member. `joinGroup()` idempotente. `inviteCode` 12-char generado pero **las reglas no lo validan** (`firestore-rules-v100-fase3.md:257-298`).
- Amistades (`assets/friends.js`, 237): `sendFriendRequest()` crea `friendships/{sorted(uidA,uidB)}` con auto-accept si reciproco. `listMyFriends`, `getFriendshipStatus`. **Funciona end-to-end.**
- Identidad (`assets/identity.js`, 327): `ensureProfile()` auto-bootstrap `users/{uid}`, handles unicos via transaccion.
- Privacidad: `perfil-editar.html` guarda `users/{uid}.privacy` pero **sin enforcement server-side**.

**Archivos clave:** `groups.js`, `grupos.html`, `grupo.html`, `friends.js`, `amigos.html`, `identity.js`, `perfil.html`, `perfil-editar.html`, `firestore-rules-v100-fase3.md`, `ranking-social-v100-design.md`, dictados `2026-05-29-*`.

**Hallazgos (por severidad):**
- **[ALTA · gap] No hay ranking interno por grupo** (`grupo.html:151-156` placeholder "Proximamente").
- **[ALTA · gap] No hay ligas persistentes/recurrentes** (cada grupo es one-off; `matchCount` hardcoded 0).
- **[ALTA · gap] No existe `match.groupId`:** un grupo no sabe sus partidos -> ranking local imposible.
- **[ALTA · bug] Item 12 dictado:** "Mis grupos / Mis amigos piden login aunque hay sesion". Race de auth-ready con fallback de 800ms (`grupos.html:212-216`, `amigos.html:290-294`).
- **[ALTA · riesgo] Privacidad no aplicada server-side** (`firestore-rules-v100-fase3.md:192-194`, `allow read: if true`). Bypass directo.
- **[MEDIA · gap] inviteCode cosmetico** (reglas no lo validan -> cualquiera con `groupId` se une). Flujo "Ese soy yo" en partidos compartidos sin end-to-end (Issue 2 dictado). Claim retroactivo solo disenado, sin codigo. Miembros sin onSnapshot (requiere F5). Notificaciones inexistentes.
- **[MEDIA · riesgo] Race en array `admins`** (arrayUnion sin transaction, `groups.js:192-216`).
- **[BAJA] Sin bulk add de miembros; normalizacion de handles sin accent-insensitive.**
- **Lo que SI funciona end-to-end:** amistades + busqueda por handle + perfiles con handle unico.

### 1.5 Backend, modelo de datos, reglas y flujo E2E — Funcional

**Como funciona hoy:**
- Arquitectura serverless sin servidor dedicado: Firestore + Auth Google + runners Python en 3 NUCs + GitHub Actions (FFmpeg/reindex). **Cero Cloud Functions** (verificado).
- Flujo: login -> auto-bootstrap `users/{uid}` -> `boton.html` `requestPulse()` (`pulses.js:134-151`) decide canal (Firestore si club en `FIRESTORE_CLUBS`, sino Apps Script legacy) -> `pending_pulses.add()` -> NUC listener consume -> FFmpeg local + rclone Dropbox -> `clip_states/{clipId}` transiciones -> GitHub Actions reindex a `videos_recientes.json` (fuera de Firestore) -> cleanup `pending_pulses` hourly (TTL 24h).
- Colecciones: `usuarios/` (legacy) + `users/` (nueva), `matches/` + `claims/`, `pending_pulses/`, `clip_states/`, `clip_edits/`, `groups/`+`members/`, `friendships/`, `handles/`, `nuc_heartbeat/`, `torneos5/`, `guardados/`.

**Archivos clave:** `firebase-core.js` (77), `auth.js` (414), `identity.js` (327), `pulses.js` (326), `firestore-rules-v100-fase3.md` (440), `cleanup_pulses_ci.py` (101), `clip_edit_ci.py` (213), workflows YAML, `nuc-state-2026-06-03.md` (320).

**Hallazgos (por severidad):**
- **[ALTA · bug] Outage 2026-06-03/04:** ruleset `da0d0727` apreto `source` a allowlist incompleto, rompio web_mi_partido/torneo5/match_full en TODOS los clubes; revirtio a `is string` (`d053bb2c`). Raiz: docs desincronizados de los sources reales.
- **[ALTA · gap] Cero Cloud Functions:** cliente puede falsificar resultados; sin trigger para notificaciones (F116 bloqueado); `clip_states` es passthrough sin logica servidor.
- **[ALTA · riesgo] Secretos en repos:** password NVR trackeado + SA JSON no-ignorado en los 3 NUCs; PAT rotado 2026-06-03 pero deuda persiste (Worker HP pendiente).
- **[ALTA · deuda] `LISTENER_NUC_ID` hardcoded;** WellStreet multi-club (Pickle+Padel) comparte ID -> heartbeat/pulsos ambiguos.
- **[MEDIA] Modelo fragmentado** `usuarios/{uid}/guardados` vs `users/{uid}` sin migracion. Dos pipelines FFmpeg divergentes (NUC local vs Actions clip_edit). Indices collectionGroup sin validacion. `cleanup_pulses_ci.py` best-effort sin tx. Inconsistencia retencion NVR (BP 7d, WS 5d, IP 14d). Interpadel aun en Forms CSV (no Firestore).
- **[BAJA] Sin API REST** para cliente externo/movil (todo Firestore directo).

---

## 2. Arquitectura de datos y flujo end-to-end

### 2.1 Mapa de colecciones Firestore

| Coleccion | Escribe | Lee | Regla actual | Hueco de seguridad |
|---|---|---|---|---|
| `pending_pulses/` | Cliente (web), NUC consume | NUC listener | `create if source is string` (post-revert) | Allowlist fragil; un cambio sin grep rompe todo (outage 06-03) |
| `clip_states/{id}` | NUC | Cliente (heartbeat-watcher) | read publico | Passthrough sin validacion servidor |
| `clip_edits/{id}` | Cliente | Actions poll 5m | restringido por uid | OK |
| `matches/{id}` | Cliente (owner) | Publico (`read: if true`) | owner-only write | Sin idempotencia ni validacion de marcador; cliente puede falsear |
| `matches/{id}/claims/{uid}` | Cliente (claimer) | collectionGroup | uid-own | Sin tx en dual-claim; sin cascada al cancelar |
| `ratings/{uid}` | **NADIE** | Cliente (signedIn) | `write: if false` | **Coleccion vacia; ranking nunca persiste** |
| `users/{uid}` | Cliente (owner) | **Publico (`read: if true`)** | owner write | **Privacidad NO aplicada server-side** |
| `usuarios/{uid}/guardados` | Cliente | Cliente | privado | Legacy sin migrar; coexiste con `users/` |
| `groups/{id}` + `/members` | Cliente (admin/self) | signedIn (collectionGroup F96) | admin-gated | `inviteCode` no validado -> join abierto |
| `friendships/{id}` | Cliente | Cliente (2 queries) | participantes | OK (funciona E2E) |
| `handles/{handle}` | Cliente (tx local) | Cliente | `create if !exists` | Tx solo local, regla no garantiza atomicidad |
| `users/{uid}/torneos5/active` | Cliente (owner) | Solo owner | privado | **No observable, no collectionGroup-able** |
| `nuc_heartbeat/{clubId}` | NUC | Cliente | read publico | `LISTENER_NUC_ID` hardcoded, colision multi-club |

### 2.2 Flujo E2E y donde se ROMPE la cadena

```
[Usuario pide puntazo]
        |
        v
  pending_pulses.add()  ----(canal Firestore o Apps Script legacy segun club)
        |
        v
  NUC listener (script.py) --> valida ventana NVR --> consume doc
        |
        v
  FFmpeg local (trim+logo+outro) --> rclone Dropbox
        |
        v
  GitHub Actions reindex --> videos_recientes.json   [<-- ROMPE #1: indice en JSON, FUERA de Firestore, no queryable/triggerable]
        |
        v
  [Clip asociado a match por ventana temporal]  --> matches/{id}.clipCount
        |                                              [<-- ROMPE #2: best-effort; si JSON falla, clipCount stale (matches.js:1087)]
        v
  [Match termina: status='ended']
        |
        X  <-- ROMPE #3 (CRITICO): NO hay Cloud Function onMatchEnded. La cadena MUERE aqui.
        |
        v (deberia, pero NO ocurre en servidor)
  ratings/{uid} actualizado  [<-- ROMPE #4: ratings/ nunca se escribe. Ranking se "calcula" client-side en RAM al abrir mi-nivel.html, efimero]
        |
        v
  groups/{id}/rankings/{uid}  [<-- ROMPE #5: no existe match.groupId, no existe la subcoleccion, placeholder "Proximamente"]
```

**Cadenas paralelas rotas:**
- **Modos de juego (Capa 2):** King/Americano/Sortear -> localStorage (muere). Torneo 5 -> `users/{uid}/torneos5/active` (privado, muere). **Ninguno entra a `matches/` ni al ranking.** Isla total.
- **Privacidad:** settings guardados en `users/{uid}.privacy` -> nunca se consultan en reglas -> lectura abierta.

El patron es claro: **la captura de datos (izquierda) funciona; la sintesis social (derecha) esta desconectada por falta de la pieza servidor.**

---

## 3. Brecha vision vs realidad

| Que pide la vision | Que existe | Brecha | Criticidad |
|---|---|---|---|
| Cloud Function `onMatchEnded` aplica Glicko-2, escribe `ratings/{uid}`, `ratingAudit`, `ratingProcessed` | Nada. `ranking.js` es libreria pura; `ranking-client.js` calcula en RAM | **100%** — no hay backend de computo | **P0 critica** |
| Ranking persistente y consistente entre dispositivos | Recalculo efimero client-side, limit 100 | **~95%** — algoritmo OK, datos efimeros | **P0** |
| Ratings de oponentes globales | Aproximacion local (1500 default) | **90%** — consume datos incorrectos | **P0** |
| Idempotencia via `ratingProcessed` | No se escribe | **100%** | **P0** |
| `match.groupId` -> ranking local de grupo | `matches` sin `groupId`; `groups` no sabe sus partidos | **100%** | **P1** |
| Ranking interno por grupo + ligas recurrentes | Placeholder "Proximamente" | **100%** | **P1** |
| `sessions/` top-level multi-jugador (King/Americano cloud, join QR) | 4 islas; Torneo 5 en subcoleccion privada | **50-80%** | **P1** |
| Modos alimentan `matches/` y ranking | Cero integracion | **100%** | **P1** |
| Privacidad aplicada (public/friends/private) | UI guarda enum; reglas `read: if true` | **~90%** — cosmetica | **P1 (seguridad)** |
| inviteCode valida acceso a grupo | Cosmetico; reglas no lo checan | **100%** | **P1** |
| Flujo "Ese soy yo" end-to-end en link compartido | Compartir OK; overlay hidden/disabled (Issue 2) | **~60%** | **P1** |
| Claim retroactivo de partidos viejos | Solo disenado (`claim_requests/`), sin codigo | **100%** | **P2** |
| Notificaciones push (claim, marcador, amistad) | Inexistente (F116 bloqueado por CF) | **100%** | **P2** |
| Tiebreak en padel (6-6 -> tiebreak con +/-) | Desactivado F79; 6-6 -> 7-6 sin tiebreak | UX, no comunicada en UI | **P2** |
| Pickleball target configurable 11/15/21 | Hardcoded 11 | parcial | **P2** |
| Secretos fuera de repos | Password NVR + SA JSON trackeados en 3 NUCs | **alta deuda** | **P0 (ops)** |
| Amistades + handles + perfiles | Funciona end-to-end | **0%** — completo | — |
| Schema partidos flexible 0-4 slots + equipo | Implementado y funciona | **0%** | — |

**Preguntas de diseno aun sin resolver:**
1. **Torneo 5: migrar a `sessions/` o dejarlo?** (F114 decidio NO migrar; ahora bloquea ranking/observabilidad).
2. **Ranking: recompute total cada cambio de algoritmo o append incremental?** (afecta diseno de `ratingProcessed` y `recomputeAllRatings`).
3. **Privacidad: enforcement por reglas (caro en complejidad) o por modelo de datos (espejos publicos/privados)?**
4. **`matchId` UUID como unico secreto del link compartido, o token separado + rate-limit?** (hoy `read: if true` en `matches/`).
5. **Interpadel: forzar Firestore antes de mas features, o seguir en CSV?** (arquitectura divergente).

---

## 4. Estado deseado por area

### 4.1 Registro de partidos (end-state)
- **Schema:** `matches/{id}` con `version` (timestamp/nonce) para optimistic locking. `equipo` siempre consistente (sincronizado en cada claim). `clipCount` con flag `-1` = "contando" mientras se resuelve.
- **Computo:** `updateMatch()` y `claimSlot()` envueltos en `runTransaction` (lee version, rechaza si diverge). Dual-claim resuelto en tx (lee `jugadores[slot]` + claims, rechaza si conflicto).
- **Garantias:** idempotencia (rechazo de segundo PUT con version stale), convergencia de equipos (claim escribe `equipo`), durabilidad de `clipCount` (retry + flag).

### 4.2 Ranking (end-state)
- **Schema:** `ratings/{uid}` poblado: `{rating, RD, volatility, conservativeRating, nivel, bucket, matchCount, wins, losses, lastMatchAt, isCalibrating, recentOpponents{}, sparkline7d[]}`. `matches/{id}.ratingAudit` + `ratingProcessed=true`.
- **Computo:** Cloud Function `onMatchEnded` (trigger en `status: !ended -> ended`): fetch match + `ratings/{uid}` globales -> `applyMatchToRatings()` -> writeBatch ratings + audit -> `ratingProcessed=true`. Anti-farm y decay RD persistidos. Callable `recomputeAllRatings()` (admin) para cambios de algoritmo.
- **Garantias:** idempotencia (verifica `ratingProcessed`), convergencia global (ratings de oponentes reales), consistencia entre dispositivos (lectura pura), durabilidad (Firestore). `ranking-client.js` migra a read-only de `ratings/{uid}`.

### 4.3 Sesiones/modos (end-state)
- **Schema:** `sessions/{sessionId}` top-level (`type`, `ownerUid`, `state`, `players[]` con `uid?`, `claims/`). Torneo 5 migrado aqui.
- **Computo:** owner escribe, invitados leen via onSnapshot. Cada mini-partido escribe a `matches/` con `sourceMode` + `sessionId` -> alimenta ranking. Conflict resolution con `serverTimestamp()`.
- **Garantias:** observabilidad multi-device, durabilidad (historial por `sessionId`), convergencia (serverTimestamp como verdad).

### 4.4 Ligas/grupos (end-state)
- **Schema:** `matches/{id}.groupId` (nullable). `groups/{id}/rankings/{uid}` poblado por CF. `claim_requests/{id}` para claim retroactivo.
- **Computo:** `onMatchEnded` actualiza ranking global Y local (si `groupId`). CF semanal `computeGroupRanking`. inviteCode validado en reglas. Privacidad por reglas o modelo espejo.
- **Garantias:** seguridad (inviteCode + privacidad real), durabilidad (ligas persistentes con seasons), real-time (onSnapshot en miembros).

### 4.5 Backend (end-state)
- Cero secretos en repos (SA JSON en `.gitignore`, password en env). `LISTENER_NUC_ID` configurable/UUID. Minimo 2 Cloud Functions (ranking + notificaciones). Indices validados. Migracion `usuarios/` -> `users/`. Observabilidad (Cloud Logging + alertas de costo). Interpadel en Firestore.

---

## 5. Roadmap consolidado por etapas

> Reconcilia las recomendaciones de los 6 lanes, elimina duplicados y resuelve conflictos. **Conflicto resuelto:** varios lanes piden "Cloud Function onMatchEnded" por separado (ranking, ligas, backend); se consolida en **E2** como una sola CF que escribe ranking global + local. **Camino critico marcado con [CC].**

| Etapa | Scope | Prioridad | Esfuerzo | Por que este orden | Que desbloquea |
|---|---|---|---|---|---|
| **E0** [CC] | Sanear secretos (Worker HP-BP/IP): quitar password NVR trackeado, ignorar SA JSON en 3 NUCs | P0 | Chico | Riesgo de seguridad vivo; barato; no debe haber features nuevas con secretos expuestos | Higiene base para todo lo demas |
| **E1** [CC] | Hardening de reglas `pending_pulses`: test suite que grepea TODOS los `source` reales antes de deploy; documentar allowlist | P0 | Chico | El outage 06-03 puede repetirse; protege produccion | Estabilidad para iterar reglas sin tumbar clubes |
| **E2** [CC] | **Cloud Function `onMatchEnded`** + poblar `ratings/{uid}` + `ratingAudit` + `ratingProcessed` (idempotencia) + ranking local si `match.groupId` | P0 | Grande | **Pieza raiz ausente.** Desbloquea ranking real, ligas, notificaciones. Sin esto nada "social" converge | Ranking persistente, ligas, F116 |
| **E3** | `matches.js`: idempotencia en `updateMatch()`/`claimSlot()` (version + runTransaction); sincronizar `equipo` en claim | P0 | Mediano | Bugs de datos que corrompen partidos/equipos; pre-requisito de ranking confiable | Datos de partido confiables para E2 |
| **E4** | Crear `sessions/` + reglas; vincular `match.groupId` en schema | P1 | Chico | Infra previa para modos cloud y ligas | E5, E6, E7 |
| **E5** | `ranking-client.js` -> read-only de `ratings/{uid}` (fallback temporal); leaderboard global `leaderboard.html` | P1 | Mediano | Post-E2; baja bandwidth y muestra ranking real | Ranking visible y consistente |
| **E6** | Ligas: ranking interno por grupo (CF semanal `computeGroupRanking`); quitar placeholder; validar inviteCode en reglas | P1 | Mediano | Post-E2+E4; entrega valor "liga" real | Ligas con leaderboard |
| **E7** | Migrar Torneo 5 a `sessions/`; King/Americano a cloud sync (serverTimestamp); escribir mini-partidos a `matches/` | P1 | Grande | Post-E4; conecta modos al ranking | Modos sociales alimentan ranking |
| **E8** | Fixes UX/dictado: bug Item 12 (auth-ready race), overlay "Ese soy yo" end-to-end, onSnapshot miembros grupo | P1 | Mediano | Bugs que bloquean uso social hoy | Flujo social usable |
| **E9** | Privacidad server-side (reglas o modelo espejo) | P1 | Mediano | Seguridad; hoy es bypass-able | Datos privados realmente privados |
| **E10** | Interpadel a Firestore (Worker A-D); `LISTENER_NUC_ID` UUID/configurable | P1 | Grande | Unifica arquitectura; quita CSV legacy | 3er club en la plataforma |
| **E11** | Notificaciones push (FCM + Service Worker) | P2 | Grande | Depende de E2 (CF) | Engagement |
| **E12** | Claim retroactivo (`claim_requests/`); pickleball target configurable; documentar/educar tiebreak F79 en UI | P2 | Mediano | Mejoras de cobertura | Onboarding de partidos viejos |
| **E13** | Observabilidad (Cloud Logging, dashboard costos, alertas); migracion `usuarios/`->`users/`; indices validados | P2 | Mediano | Ops a escala | Costos predecibles |
| **E14** | Tests de integracion (NUC mock); API REST (si app movil); reindex incremental | P3 | Grande | Futuro | Escalabilidad/movil |

**Camino critico:** E0 -> E1 -> E2 -> (E3, E4 en paralelo) -> E5/E6/E7. Todo lo "social serio" cuelga de E2.

---

## 6. Decisiones que Isaac debe tomar ya

1. **¿Adoptar Cloud Functions ahora?** **Recomendacion: SI, es la decision raiz.** Sin servidor de computo, ranking/ligas/notificaciones/privacidad son imposibles de hacer bien. *Trade-off:* costo de aprender deploy + cold starts + costo Firebase (marginal a su escala) vs. seguir con un ranking efimero y manipulable que nunca sera una plataforma. **No hay atajo client-side honesto.**

2. **¿Migrar Torneo 5 a `sessions/`?** **Recomendacion: SI** (revertir decision F114). Mantenerlo en `users/{uid}/torneos5/active` lo deja fuera del ranking y sin multi-device. *Trade-off:* costo de migracion + CF de migracion vs. una anomalia permanente que duplica el modelo de sesiones.

3. **Privacidad: ¿reglas o modelo espejo?** **Recomendacion: modelo espejo** (doc publico minimo + doc privado completo) por simplicidad y costo de queries. *Trade-off:* duplicacion de datos vs. reglas de privacidad complejas y caras de mantener. Decidir antes de E9.

4. **Link de partido: ¿`matchId` como unico secreto o token + rate-limit?** **Recomendacion: para MVP, `matchId` UUID basta** (128 bits, no enumerable). Revisar si se exponen datos sensibles. *Trade-off:* simplicidad vs. defensa en profundidad.

5. **Interpadel: ¿forzar Firestore antes de mas features?** **Recomendacion: SI, bloquear features nuevas de IP hasta migrar** (E10). *Trade-off:* retrasa onboarding de IP vs. mantener 2 arquitecturas (CSV + Firestore) indefinidamente, que multiplica deuda.

6. **Ranking: ¿recompute total o incremental?** **Recomendacion: incremental con `ratingProcessed` + callable `recomputeAllRatings` para cambios de algoritmo.** *Trade-off:* el incremental es barato pero requiere recompute al cambiar TAU/MOV; el total cada vez es simple pero caro a escala.

7. **Tiebreak F79: ¿reactivar o documentar?** **Recomendacion: documentar en UI** (hint "6-6 -> el siguiente game decide"). Reactivar tiebreak confunde a usuarios (razon original de F79). *Trade-off:* fidelidad al reglamento vs. simplicidad UX.

---

## 7. Backlog priorizado (P0 primero) — listo para briefs de worker

**P0 (bloqueantes / camino critico):**
- Worker HP-BP + HP-IP: quitar password NVR de `script.py` trackeado; `.gitignore` para SA JSON en los 3 NUCs. *(chico)*
- Test suite de reglas `pending_pulses`: grep de todos los `source` en `assets/*.js` + `docs/*.md` antes de cada deploy. *(chico)*
- **Cloud Function `onMatchEnded`:** Glicko-2 -> `ratings/{uid}` + `ratingAudit` + `ratingProcessed`; idempotencia; ranking local si `groupId`. *(grande)*
- Poblar schema completo `ratings/{uid}`. *(mediano, parte de la CF)*
- `matches.js`: idempotencia en `updateMatch()` (version + runTransaction). *(mediano)*
- `matches.js`: sincronizar `equipo` en `mergeMatchWithClaims()`/`claimSlot()`. *(chico)*

**P1:**
- Crear `sessions/` + reglas; agregar `match.groupId` (nullable) al schema. *(chico)*
- `ranking-client.js` -> read-only de `ratings/{uid}`; crear `leaderboard.html`. *(mediano)*
- CF `computeGroupRanking` semanal; quitar placeholder en `grupo.html:151`; validar inviteCode en reglas. *(mediano)*
- Migrar Torneo 5 a `sessions/`; King/Americano cloud sync con serverTimestamp; escribir mini-partidos a `matches/`. *(grande)*
- Fix bug Item 12 (auth-ready race en `grupos.html:212`/`amigos.html:290`). *(chico)*
- Exponer overlay "Ese soy yo" en `detalle.html` end-to-end (Issue 2). *(mediano)*
- onSnapshot en miembros de grupo (`grupo.html:197`). *(chico)*
- Privacidad server-side (modelo espejo o reglas). *(mediano)*
- Interpadel a Firestore (Worker A-D); `LISTENER_NUC_ID` UUID/configurable. *(grande)*
- runTransaction en `addAdmin/removeAdmin` (`groups.js:192`). *(chico)*

**P2:**
- Notificaciones push FCM + Service Worker. *(grande)*
- Claim retroactivo `claim_requests/`. *(grande)*
- Pickleball target configurable (`validatePickleGame(target)`). *(mediano)*
- Hint UI tiebreak F79 en modal terminar. *(chico)*
- `clipCount` con retry + flag `-1`. *(mediano)*
- Cascada de borrado de claims al cancelar match. *(mediano)*
- Migracion `usuarios/{uid}/guardados` -> `users/{uid}/savedVideos`. *(mediano)*
- Observabilidad Firestore (Cloud Logging + dashboard costos). *(mediano)*
- Dedupe de jugadores por uid; normalizacion accent-insensitive de handles. *(chico)*

**P3:**
- Americano N=4-8 dinamico; King variantes vs-all/bracket; Pick-a-finger V1. *(mediano c/u)*
- Tests de integracion (NUC mock). *(grande)*
- Reindex incremental (delta). *(mediano)*
- API REST para cliente movil. *(grande)*
- Aviso "sesion local" en King/Americano/Sortear. *(chico)*
