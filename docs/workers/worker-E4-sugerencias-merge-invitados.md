# Worker #10 — ETAPA E4: Sugerencias retroactivas + fusión de invitados

## Título de etapa
E4 — Cerrar el arco de invitados/claim. (A) Cuando alguien reclama su lugar ("yo soy Gabo") y ese slot
era un invitado persistente, **sugerirle los OTROS partidos donde aparece como ese mismo invitado** y
dejar que los reclame todos de golpe. (B) Que el dueño pueda **fusionar invitados duplicados** ("Gabo" y
"Gabito" son la misma persona). CLIENTE PURO — sin tocar backend ni reglas, sin deploy.

## Contexto (lo que YA existe)
- **E3a/E3b (claim):** `match-actions.claim(matchId, slotIndex)` agrega mi uid a un slot dummy de un match
  pending (reglas `isClaimAction` LIVE). `confirmar.html` tiene el flujo "¿Cuál eres?" → reclamar → confirmar,
  con auto-amistad. El claim NO borra el `guestId` del slot (solo le agrega `uid`).
- **E3c (invitados persistentes):** los slots dummy llevan `{ nombre, equipo, guestId, ownerUid, uid:null }`.
  `users/{uid}/guests/{guestId}` = `{ name, searchName, createdAt, lastUsedAt, claimedByUid:null }`.
  `assets/guests.js` (`PuntazoGuests`: listMyGuests/ensureGuest/renameGuest/deleteGuest), dedup por `searchName`.
  `assets/identity.js` expone `normalizeName`.
- **Reglas (clave para el alcance):** `matches` **read público** (`allow read: if true`) → el que reclama PUEDE
  consultar los partidos del dueño. PERO el dueño **NO puede reescribir** `jugadores` de un match **pending**
  (update solo permite claim/decline/confirm). ⇒ la **fusión NO reescribe partidos**: es un puntero en los
  invitados del dueño. NO intentes editar slots de matches (lo bloquean las reglas).
- Las matches del invitado fueron registradas por su DUEÑO ⇒ `userId == ownerUid`. Eso permite encontrarlas
  sin índice de array: `matches where userId == ownerUid` + filtro en cliente por `guestId`.

## Archivos a LEER primero
- `confirmar.html` — flujo de claim (`doClaim`, `renderState`, `renderClaim`, estados). AQUÍ va la sugerencia
  retroactiva tras reclamar.
- `assets/match-actions.js` — `claim(matchId, slotIndex)` (lo reusas para el batch).
- `assets/guests.js` — añades `mergeGuests` + resolución de `mergedInto`.
- `amigos.html` — sección "Mis invitados" (de E3c). AQUÍ va la UI de fusión.
- `assets/match-confirmation.js` — `teamOf`/`teamUids` para ubicar slots/equipo.

## Alcance — Parte A (headline): sugerencia retroactiva al reclamar
1. Tras un `claim()` exitoso en `confirmar.html`, lee del slot reclamado su `guestId` + `ownerUid` (siguen en el
   slot; el claim solo agregó tu uid). Si no hay `guestId`, NO hay sugerencia (termina el flujo normal).
2. Consulta `db.collection("matches").where("userId","==",ownerUid).limit(100).get()` y filtra en cliente los que:
   - `status == "pending_confirmation"` y NO vencidos (`confirmation.expiresAtMs`),
   - tienen un slot con `guestId == <miGuestId>` (o un guestId que **fusionó** en él, ver Parte B) **y sin `uid`**,
   - donde yo (claimer) **NO** estoy ya en `playerUids`,
   - excluye el match que acabo de reclamar.
3. Si hay ≥1 → muestra "**También apareces como `<nombre>` en N partido(s) más.**" con botón
   **"Reclamar todos"** (y "Ahora no"). "Reclamar todos" llama `claim(matchId, slotIndex)` por cada uno
   (el slotIndex del slot con ese guestId), en serie o con límite de concurrencia; best-effort, cuenta cuántos
   lograste y muestra el resultado ("Reclamaste N partidos"). La auto-amistad ya ocurre dentro de cada claim.
4. Tras reclamar todos, re-render normal (sigues en el partido original para confirmar/lo que toque). No rompas
   los estados existentes (confirmar/disputar/terminales).

## Alcance — Parte B: fusionar invitados duplicados (cliente, por puntero)
5. `guests.js`: añade `mergeGuests(fromGuestId, intoGuestId)` → marca el duplicado:
   `users/{uid}/guests/{fromGuestId}.mergedInto = intoGuestId` (+ opcional `mergedAt`). **No toca partidos.**
   - `listMyGuests()`: EXCLUYE los que tengan `mergedInto` (ya no son canónicos; no ensucian el roster).
   - `ensureGuest(name)`: si el match por `searchName` cae en un guest con `mergedInto`, **sigue el puntero**
     y devuelve el guest CANÓNICO (`{guestId: canónico, name: canónico}`), actualizando su `lastUsedAt`.
     (Así, escribir "Gabito" tras la fusión reattachea al guestId de "Gabo".) Resuelve 1 nivel (o varios con guard
     anti-ciclo).
   - Expón un helper `aliasGuestIds(canonicalGuestId)` → `[canónico, ...los que fusionaron en él]`, para que la
     Parte A expanda el guestId del slot a todos sus alias al buscar partidos.
6. `amigos.html` (sección "Mis invitados"): permite **fusionar** dos invitados — elegir uno y "es el mismo que…"
   → seleccionar el invitado destino (canónico) → `mergeGuests(dup, canónico)` → refresca la lista (el duplicado
   desaparece). Confirma con un `confirm(...)` claro ("Vas a fusionar 'Gabito' en 'Gabo'. Los partidos viejos de
   'Gabito' seguirán como están; los nuevos usarán 'Gabo'."). Mantén el renombrar/borrar de E3c.

## FUERA de alcance (NO tocar)
- Backend/functions/reglas — NO deploy. NO reescribir `jugadores` de matches (las reglas lo bloquean en pending).
- NO cambiar la lógica de `claim/decline/confirm` ni el motor de ranking/scoring.
- NO `claimedByUid` automático del guest del dueño (es señal para el dueño, no la toques en E4 salvo dejar null).
- Ligas, head-to-head, nav, notificaciones.

## Riesgos / cuidados
- **No reescribas matches:** la fusión es SOLO sobre `users/{uid}/guests` (puntero `mergedInto`). Los slots
  históricos conservan su guestId original; la resolución por alias lo cubre en lectura.
- **Batch claim best-effort:** si un claim falla (carrera, ya reclamado, vencido) no abortes los demás; reporta el
  conteo. Cada claim cumple `isClaimAction` (delta = solo tu uid) — reusa `match-actions.claim`, no inventes otro patch.
- **slotIndex correcto:** al reclamar en otro match, ubica el índice del slot cuyo `guestId` coincide y `!uid`.
- **Privacidad:** la consulta `userId==ownerUid` lee matches (read público) — ok. NO expongas guests de otros.
- **Anti-ciclo** en `mergedInto` (A→B→A): guard de profundidad al resolver.
- **Degradar:** si `PuntazoGuests`/consulta fallan, el claim normal sigue funcionando (la sugerencia es un extra).
- CRLF/mojibake: cero `�`. JS web ajeno sin commitear (`ranking.js` M, `ranking-read.js` untracked) → NO incluir,
  aislar con `git stash -u`. (matches.js ya está sano en HEAD; si aparece modificado en tu árbol, NO lo toques salvo
  que sea tu cambio intencional — revisa el diff.)

## Validaciones (tests reales)
- `node --check` de los archivos tocados (confirmar.html inline, guests.js, amigos.html inline, match-actions si lo tocas).
- Lógica pura en Node si extraes helpers (filtro de "matches con guestId Y sin uid y sin mí"; resolución de alias/mergedInto anti-ciclo).
- (Pídele al maestro un escenario sembrado) 2 partidos pendientes del mismo dueño con el mismo guest "Gabo" → al
  reclamar uno, la UI sugiere el otro; "Reclamar todos" me mete en ambos. Fusionar "Gabito"→"Gabo" oculta el dup y
  reattachea el nombre. Sin regresión en el claim/confirm normal.
- Sin login / sin guestId en el slot: no hay sugerencia, sin errores.

## Definition of Done
- Sugerencia retroactiva + "Reclamar todos" en `confirmar.html` (reusa `claim`, best-effort, conteo).
- `mergeGuests` por puntero en `guests.js` + resolución alias en `listMyGuests`/`ensureGuest` + UI de fusión en amigos.
- Sin reescribir matches, sin deploy. Commit quirúrgico + push a master (commit acotado → `git stash -u` → `fetch`
  → `rebase origin/master` → `push` → `stash pop`). No colar el JS ajeno.

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA E4
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
