# Worker #3 — ETAPA E3a: Fundaciones de Claiming (modelo de datos + reglas Firestore, probadas en emulador, SIN desplegar)

## Título de etapa
E3a — Modelo de datos de invitados (`guests`) + reglas Firestore de **claim** (reclamar un lugar dummy) y **decline** (declinar/removerse), probadas al 100% en el emulador. **NO se despliega** (el deploy reconciliado lo hace el arquitecto maestro tras revisar).

## Objetivo
Dejar lista y BLINDADA la capa de seguridad + el modelo de datos para que la siguiente etapa (E3b, la UI) construya encima sin sorpresas. Concretamente:
1. Definir el modelo `users/{ownerUid}/guests/{guestId}` y la forma de un jugador dummy dentro de un match.
2. Agregar al ruleset **reconciliado** (`firestore.rules`) las reglas de: subcolección `guests`, **claim** y **decline**, sin romper nada de lo existente.
3. Extender `functions/itest/rules-emu.js` con casos nuevos y dejar el emulador **100% verde**.

## Contexto del proyecto
Puntazo tiene un flujo de registro sin hardware ya LIVE: registras un partido, queda `pending_confirmation`, y un **rival con cuenta** lo confirma (entonces el ranking se mueve). Decisión nueva de producto (ver spec): **registrar NUNCA debe trabarse por falta de cuentas** → se permite meter puros nombres (dummies); las cuentas llegan después y la persona **reclama su lugar** ("yo soy Pedro"), o **declina** si la metieron sin haber jugado.

LEE OBLIGATORIO antes de tocar nada:
- `docs/plans/spec-registro-claiming-ligas-2026-06-08.md` — secciones **§2 (identidad/dummies/claiming/decline)** y **§6 (reglas que esto requiere)**. Es la fuente de verdad del diseño.
- `firestore.rules` — el ruleset RECONCILIADO vivo (v100 + ranking + matches dos flujos). **Sobre ESTE archivo agregas**, sin romper bloques existentes.
- `functions/itest/rules-emu.js` — el harness de tests de reglas (ya cubre el flujo confirmar/disputar). Lo extiendes.
- `assets/match-actions.js` y `assets/match-confirmation.js` — para entender la forma del match: `jugadores:[{nombre,equipo,uid|null}]`, `playerUids:[...uids reales...]`, `scoreAcceptedBy:{uid:true}`, `status`, `confirmation`, `userId` (registrante).

## ⚠️ Lección crítica (incidente 7-jun)
Desplegar reglas equivocadas tumbó el sitio. POR ESO: en E3a **NO ejecutas `firebase deploy`**. Solo editas el archivo + pruebas en emulador. El maestro revisa y despliega el set reconciliado. Commitear el archivo a git **no** lo despliega (son cosas distintas) — sí puedes commitear/pushear el archivo.

## Modelo de datos a definir (documéntalo en comentarios + en el reporte)
- `users/{ownerUid}/guests/{guestId}` = `{ name, searchName, createdAt, lastUsedAt, claimedByUid|null }`. Un "invitado" reusable del dueño (para que "Gabo de ayer" = "Gabo de hoy").
- Jugador **dummy** dentro de `matches/{id}.jugadores[]` = `{ nombre, equipo, guestId, ownerUid, uid:null }` (un jugador con cuenta es `{nombre, equipo, uid}`). El `guestId/ownerUid` sirve para sugerencias/merge en etapas futuras; **las reglas NO dependen de ellos**.

## Reglas a agregar (en `firestore.rules`, set reconciliado)
1. **`users/{uid}/guests/{guestId}`**: `allow read, write: if isMe(uid);` (solo el dueño).
2. **Claim** (en el bloque `matches`): un usuario con sesión puede **AGREGARSE** a un match `pending_confirmation`:
   - `request.auth.uid` NO estaba en `resource.data.playerUids` y SÍ está en `request.resource.data.playerUids` (se agrega exactamente a sí mismo).
   - `affectedKeys().hasOnly(['jugadores','playerUids','updatedAt','version'])`.
   - `marcador`, `userId`, `status` (sigue `pending_confirmation`) y `ratingProcessed` (sigue false) **inmutables**.
   - No puede reclamar si ya es jugador.
3. **Decline / "no fui yo"** (compañero se remueve): un `player` (uid en `playerUids`) puede **REMOVERSE**:
   - su uid sale de `playerUids`; `affectedKeys().hasOnly(['jugadores','playerUids','updatedAt','version'])`; `marcador/userId/status/ratingProcessed` inmutables; `status` sigue `pending_confirmation`.
   - (El "declinar" del RIVAL = disputar, que YA existe; no lo dupliques.)
4. **Mantener intacto**: rival-confirma (`uid != userId`), no autoconfirmar, anti create-as-confirmed, y todo v100.

### Limitación técnica a respetar y documentar
Las reglas Firestore **no pueden iterar `jugadores[]`** (arrays). Por eso la invariante fuerte se ancla en **`playerUids`** (lista: verificas que el caller se agrega/quita exactamente a sí mismo) + en la **inmutabilidad de `marcador`/`userId`/`status`/`ratingProcessed`**. Lo que no es verificable a nivel de reglas (p.ej. que el slot dummy concreto sea el correcto) queda a la capa app + disputa. Documenta esto explícitamente.

## Tests a agregar en `rules-emu.js` (y dejar 100% verde)
- **Claim OK**: un usuario nuevo (no en playerUids) se agrega a un match pending (playerUids gana su uid, sin tocar marcador) → `assertSucceeds`.
- **Claim toca marcador** → `assertFails`.
- **Claim cuando ya eres jugador** → `assertFails`.
- **Claim marca ratingProcessed=true** → `assertFails`.
- **Decline OK**: un compañero (en playerUids) se remueve (playerUids pierde su uid) → `assertSucceeds`.
- **Decline removiendo a OTRO** (quitas un uid que no es el tuyo) → `assertFails`.
- **guests**: el dueño lee/escribe su guest (`assertSucceeds`); otro usuario `assertFails`.
- No rompas los tests existentes (confirmar/disputar/legacy/anti-autoconfirmar siguen verdes).

## Alcance (SOLO esto)
Editar `firestore.rules` (agregar guests + claim + decline) y `functions/itest/rules-emu.js` (tests). Documentar el modelo. Correr el emulador y dejar todo verde.

## FUERA de alcance (NO tocar / NO hacer)
- **NO `firebase deploy`** de ningún tipo (reglas ni functions).
- NO UI, NO `registrar-min.html`/`confirmar.html`/`jugador.html`, NO `assets/*.js` de app (solo LEER match-actions/match-confirmation/identity como referencia).
- NO `functions/index.js`, NO motor de ranking, NO ligas, NO sugerencias/merge (eso es E3b/E4).
- NO cambiar bloques existentes de `firestore.rules` salvo para AÑADIR las funciones/reglas nuevas.

## Cómo correr el emulador (Java disponible)
```
cd functions
firebase emulators:exec --only firestore --project puntazo-rules-test "node --test itest/rules-emu.js"
```
Si el puerto 8080 está ocupado por un emulador colgado, mátalo (proceso java en :8080) y reintenta. Espera ver TODOS los tests con ✔.

## Validaciones (tests reales)
- Emulador 100% verde, incluyendo los casos nuevos de claim/decline/guests y los preexistentes.
- `firestore.rules` compila (el emulador lo valida al cargar).
- Revisa que NO desplegaste nada (no corriste `firebase deploy`).

## Definition of Done
- `firestore.rules` (reconciliado) con reglas de `guests`, claim y decline, sin romper lo existente.
- `rules-emu.js` extendido; emulador 100% verde (reporta el conteo).
- Modelo `guests` + forma del dummy documentados (comentarios + reporte).
- Commit quirúrgico (`firestore.rules` + `functions/itest/rules-emu.js`, opcional un doc) y push a master siguiendo la convención (commit acotado → `git stash -u` → `fetch` → `rebase origin/master` → `push` → `stash pop`). **SIN desplegar a Firebase.** OJO: hay JS web sin commitear en el árbol (`matches.js`, `ranking.js`, `ranking-read.js`) que NO son tuyos → NO los incluyas, aíslalos con el stash.

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA E3a
### Resumen ejecutivo
### Archivos modificados
### Decisiones técnicas tomadas (con justificación)
### Bugs encontrados
### Riesgos detectados
### Qué quedó pendiente
### Qué validaciones se hicieron (tests reales — incluye el conteo del emulador)
### Resultado (qué quedó funcionando)
### Recomendación al arquitecto maestro (siguiente etapa)
### NOTA DE DEPLOY: confirmar que NO se desplegó nada y qué debe desplegar el maestro
```
