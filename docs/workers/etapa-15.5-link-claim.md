# Etapa 15.5 — Link compartible + claim de slot

> Worker web. Branch `etapa-15.5-link-claim` desde **master** (post Etapa 15
> ya mergeada, commit `8f2899b4` o posterior). Toca `mi-partido.html`,
> `resumen.html`, `assets/matches.js`. Nueva subcollection en Firestore
> `matches/{matchId}/claims/{uid}` con rules específicas. NO toca el
> schema de `jugadores[]` del doc principal (sigue idéntico a Etapa 15).

## Objetivo

Habilitar el "link compartible" del partido, que decidió Isaac como
modelo central de Capa 1 (ver `idea-puntazo-plataforma-expandida.md`):

- **Un link por partido** (no por persona). Solo el dueño lo genera y
  lo comparte por WhatsApp/etc.
- **Quien tenga el link puede**:
  - Ver el partido completo SIN login (cancha visual, marcador en vivo
    o final, pulsos, clips). El acceso al link es la única "auth" para
    leer.
  - Login solo se le pide cuando intenta **reclamar un slot** ("yo soy
    Galia").
- **Vinculación opcional**: si el invitado no quiere reclamar slot, no
  pasa nada. Puede solo ver y compartir clips. El partido sigue siendo
  privado del dueño.
- **Estética elegante sin avatares placeholder** (ya cumplido en
  Etapa 15): slots con solo nombre se ven tipográficamente bonitos, sin
  ícono de persona genérico.

**No incluido en esta etapa**: sección "Mis partidos vinculados" en el
perfil del usuario. Eso es Etapa 15.6 o futura — requiere un
`collectionGroup('claims').where(...)` y UI nueva en `perfil.html`.

## Contexto

- Producción master tiene: Etapas 0-15 (cancha visual top-down funcional,
  schema breaking de `jugadores[]`, scoring engine puro, modos de partido,
  coloreado por set en resumen).
- Reglas Firestore activas (ya pegadas por Isaac 2026-05-23 al cerrar
  Etapa 15): `match /matches/{matchId}` con `allow read: if true` (es la
  precondición que esta etapa necesita). Update sigue restringido al
  dueño con fieldUnchanged.
- `mi-partido.html` (post Etapa 15) ~75 KB. Tiene cancha visual con
  bottom sheet de edición, modal de terminar, scoring +/-, contador de
  clips, sección de pulsos en vivo, botones "Terminar / Cancelar /
  Pedir clip".
- `resumen.html` (post Etapa 15) tiene render por modo (sets coloreados,
  reta, libre), tarjeta Strava, mini-sección "Estado de tus clips".
- `assets/matches.js` (post Etapa 15) exporta `create, get, listByUser,
  end, cancel, update, getActiveForUser, findClipsForMatch,
  sanitizeJugadores, validateMarcador, normalizeMatchFromDoc,
  score.{validateSet, validateTiebreak, deduceMatchWinner}`.
- Hay un campo `claimedByUid?` opcional en `jugadores[]` que el Worker
  E15 dejó previsto. **NO se usa en esta etapa**. La vinculación vive
  en la subcollection nueva. El campo queda como dato muerto del
  schema (no breaking — solo no se usa, limpieza futura).

## Decisión arquitectónica: subcollection vs campo

Considerado por el chat maestro:

- **Opción A — campo `claimedByUid` en `jugadores[i]`**: requiere rule
  Firestore compleja que valide diff entre `request.resource.data.jugadores`
  y `resource.data.jugadores` para permitir que NO-dueño solo cambie un
  field específico de un slot vacío. Feasible pero engorroso y frágil.
- **Opción B — subcollection `matches/{matchId}/claims/{uid}`**:
  ELEGIDA. Rules simples (cada user crea su propio doc con `docId ==
  auth.uid`), atomicidad nativa, fácil de leer con `onSnapshot` paralelo
  a matches/.
- Opción C — Cloud Function: descartada por overhead, billing, latencia.

## Schema nuevo

### Doc en `matches/{matchId}/claims/{claimUid}`

```js
{
  slot: 0 | 1 | 2 | 3,                  // qué slot del partido reclama
  claimedAt: Timestamp,                 // server timestamp
  displayName: string                   // opcional: nombre que quiere mostrar
                                        //   en el slot (sobreescribe el del slot)
}
```

`claimUid` (doc id) = `auth.uid` del que clama. Esto garantiza que cada
user solo tenga UN claim por partido (el último update gana).

### Doc principal `matches/{matchId}` — sin cambios

No tocar el schema de la etapa 15.

## Reglas Firestore propuestas (bloque completo NUEVO)

**Preservar TODOS los bloques existentes exactamente como están.** Solo
AGREGAR el bloque nuevo `match /matches/{matchId}/claims/{claimUid}`
después del bloque `matches/{matchId}` y antes del catch-all.

> **Nota al worker (lección de Etapa 14)**: NO simplifiques ni modifiques
> ningún otro bloque. Si tienes dudas sobre algún bloque vigente, pega
> los bloques actuales literales y agrega SOLO el nuevo.

```
// ── Claims de slot por matchmate (Etapa 15.5) ──────────────────
match /matches/{matchId}/claims/{claimUid} {
  // Read público: la UI muestra quién reclamó qué slot a todos los
  // visitantes del link.
  allow read: if true;

  // CREATE — el que clama crea su PROPIO doc (docId == auth.uid).
  // Slot debe ser 0..3 y claimedAt = server time.
  allow create: if request.auth != null
                && request.auth.uid == claimUid
                && request.resource.data.slot in [0, 1, 2, 3]
                && request.resource.data.claimedAt == request.time;

  // UPDATE — solo el propio claimer puede cambiar su claim
  // (ej. cambiar de slot, cambiar displayName).
  allow update: if request.auth != null
                && request.auth.uid == claimUid
                && request.resource.data.slot in [0, 1, 2, 3];

  // DELETE — el claimer puede retractarse, o el dueño del match
  // puede limpiar (para resolver conflictos de doble-claim manuales).
  allow delete: if request.auth != null
                && (
                  request.auth.uid == claimUid
                  || request.auth.uid == get(/databases/$(database)/documents/matches/$(matchId)).data.userId
                );
}
```

**No validamos en rules que el slot esté libre** (un `get()` extra es
costoso y se evita). Si dos uids distintos reclaman el MISMO slot por
race, ambos claims viven; la UI debe detectarlo y mostrar warning. El
dueño puede borrar el claim sobrante.

## API nueva en `assets/matches.js`

Agregar al módulo `PuntazoMatches`:

- `subscribeToClaims(matchId, onUpdate, onError) → unsubscribe` —
  `onSnapshot` a la subcollection `claims/`. `onUpdate(claimsArray)`
  donde cada elemento es `{uid, slot, claimedAt, displayName?}`.
- `claimSlot(matchId, slotIndex, displayName?) → Promise<void>` —
  crea/actualiza el claim del usuario actual.
- `unclaimSlot(matchId) → Promise<void>` — borra el claim del usuario
  actual.
- `unclaimSlotAsOwner(matchId, claimUid) → Promise<void>` — borra un
  claim ajeno (solo si el caller es el dueño del match).
- `mergeMatchWithClaims(match, claims) → match` — helper puro que toma
  un match doc y la lista de claims y devuelve el match con
  `jugadores[]` enriquecido (cada slot que tenga un claim recibe `uid`
  y opcionalmente `nombre` del displayName del claim).

`mergeMatchWithClaims` regla de conflict (cuando 2 claims apuntan al
mismo slot): el claim más reciente (`claimedAt` mayor) gana en UI; el
otro se marca como "conflicto" para que el dueño lo limpie. Detalle de
UX: si hay conflicto, mostrar un banner sutil al dueño "Hay conflicto
de claim en el slot N — toca para resolver".

## Cambios en `mi-partido.html`

### A) Botón "Compartir partido" (solo dueño)

- En la barra de acciones, junto a "Terminar" y "Cancelar", agregar un
  nuevo botón "🔗 Compartir partido". Visible **solo si el caller es el
  dueño** (`currentUser.uid === match.userId`).
- Click → modal con:
  - URL: `https://puntazoclips.com/mi-partido.html?matchId={matchId}`
    (o `${location.origin}/mi-partido.html?matchId={matchId}` para
    funcionar también en localhost durante development).
  - Input readonly con la URL + botón "Copiar" (clipboard API).
  - Botón "Compartir vía WhatsApp" usando Web Share API
    (`navigator.share`) si está disponible, fallback a `wa.me/?text=...`.
  - Texto explicativo: "Quien tenga este link puede ver el partido en
    vivo y reclamar su slot si quiere".

### B) Modo invitado (NO dueño)

Cuando `currentUser.uid !== match.userId` (o no hay user autenticado):

- Banner arriba: "Estás viendo el partido de **[nombre del dueño]**."
  El nombre del dueño puede sacarse de `jugadores[]` si el dueño
  reclamó su propio slot O del displayName de Google si no.
- **OCULTAR**: botón "Terminar partido", botón "Cancelar partido",
  botón "Pedir clip ahora" (es exclusivo del dueño que está en cancha),
  bottom sheet de edición de slot (no puede editar nombres ajenos).
- **MANTENER**: cancha visual (read-only para los slots no-claim del
  invitado), marcador (read-only), cronómetro, sección "Pulsos de este
  partido", sección "Mis clips" (cuando aplique).
- **NUEVO**: en cada slot, mostrar acción "Tomar este slot" si el slot
  no está ya claimed por OTRO uid:
  - Slot vacío sin claim → botón "Tomar este slot".
  - Slot con solo nombre (sin uid en jugadores y sin claim) → botón
    "Soy yo (tomar este slot)".
  - Slot con claim de OTRO uid → mostrar "Reclamado por [displayName o
    Google displayName]" + sin botón de tomar (mostrar avatar si hay).
  - Slot con claim DEL caller actual → mostrar "Tú reclamaste este
    slot" + botón "Cancelar mi claim".

### C) Claim flow

1. Invitado tap en slot disponible.
2. Si NO autenticado: modal "Login con Google para reclamar este slot"
   → on success, continuar al paso 3.
3. Modal "¿Eres [nombre del slot]?" con:
   - Input pre-rellenado con el nombre actual del slot (editable).
   - Botón "Sí, este soy yo".
   - Botón "Cancelar".
4. Al confirmar: llama `PuntazoMatches.claimSlot(matchId, slotIndex,
   displayNameEditado)`. UI se actualiza vía `onSnapshot` de claims.

### D) Doble-claim conflict (caso raro)

- Si `mergeMatchWithClaims` detecta dos claims apuntando al mismo slot:
  - Para el dueño: banner naranja "Hay un conflicto de claim en el slot
    N — toca para resolver". Click → modal listando los 2 claims con
    displayNames + uid (parcialmente truncado) + botón "Mantener este"
    por cada uno (borra el otro).
  - Para invitados y visitantes: render normal (gana el más reciente).

## Cambios en `resumen.html`

Mismo modelo de claim, pero como el partido está `ended`:

- Mantener el render visual de la tarjeta Strava (intacto).
- Agregar la lista de "Reclamados" mostrando quién es cada uno (foto +
  nombre).
- Agregar botones de claim igual que en mi-partido para que un invitado
  pueda vincularse al partido POST-ended (también vale, para que el
  partido aparezca en su perfil cuando se implemente Etapa 15.6).
- NO agregar "Compartir partido" duplicado — ya hay uno en mi-partido y
  el link funciona para ambos casos.

## Tests de validación (numera y reporta)

1. **Branch limpia desde master post-E15**: `git checkout -b etapa-15.5-link-claim`,
   `git status` clean. PASS/FAIL.

2. **API nueva expuesta**: `window.PuntazoMatches.subscribeToClaims`,
   `claimSlot`, `unclaimSlot`, `unclaimSlotAsOwner`, `mergeMatchWithClaims`
   existen y son funciones. PASS/FAIL.

3. **Botón "Compartir" visible solo para dueño**: con un partido propio
   abierto, ver el botón. Abrir el mismo matchId en sesión incógnita
   (otro user o sin login), NO ver el botón. PASS/FAIL.

4. **URL del link**: el modal de compartir muestra
   `<origin>/mi-partido.html?matchId={matchId}` correcto. Copiar al
   portapapeles funciona. PASS/FAIL.

5. **Lectura sin login**: abrir `mi-partido.html?matchId=...` en
   incógnita SIN login. Ver cancha visual, marcador, pulsos. NO ver
   error de permisos. PASS/FAIL.

6. **Modo invitado oculta acciones del dueño**: en incógnita logueado
   con OTRO user (no el dueño), NO ver botones "Terminar", "Cancelar",
   "Pedir clip", "Compartir". Banner "Estás viendo el partido de X"
   visible. PASS/FAIL.

7. **Claim flow exitoso**: como invitado logueado, tap en slot vacío →
   modal → "Sí soy yo" → claim creado en Firestore (verificable en
   Console). UI actualiza el slot con tu nombre + foto. PASS/FAIL.

8. **Claim con displayName custom**: claim editando el nombre →
   verificar que el `displayName` se guarda y se renderiza. PASS/FAIL.

9. **Unclaim funcional**: como claimer, botón "Cancelar mi claim" →
   doc borrado en Firestore, UI vuelve al slot vacío. PASS/FAIL.

10. **Dueño limpia claim ajeno**: como dueño, modal de conflicto (o
    botón equivalente) → borrar un claim ajeno → verificar que se
    permite. PASS/FAIL. (Si no se puede generar conflicto real, validar
    al menos que `unclaimSlotAsOwner` ejecuta sin error.)

11. **Rules: invitado NO puede crear claim para otro uid**: intentar
    desde DevTools Console crear un doc en `claims/` con `docId` ≠
    `auth.uid`. Debe fallar con permission-denied. PASS/FAIL.

12. **Rules: invitado NO puede borrar claim ajeno** (a menos que sea
    dueño del match): intentar borrar un claim de otro uid → debe
    fallar. PASS/FAIL.

13. **No regresión Etapa 15**: cancha visual del dueño sigue editable,
    bottom sheet funciona, scoring +/-, modos partido/reta/libre,
    coloreado por set en resumen. PASS/FAIL.

14. **Resumen con claims**: terminar el partido → resumen.html muestra
    los slots con sus claims (foto + nombre). Un invitado puede claim
    desde el resumen. PASS/FAIL.

## Formato del reporte (igual estructura que etapas anteriores)

```
## REPORTE ETAPA 15.5 — Link compartible + claim de slot

### Resumen ejecutivo
…

### Archivos modificados / nuevos
…

### Decisiones técnicas tomadas
…

### Schema nuevo (subcollection claims/)
…

### Reglas Firestore propuestas (bloque NUEVO a agregar — preservar lo demás)
…

### Bugs encontrados
…

### Riesgos detectados
…

### Validaciones (14 con PASS/FAIL)
…

### Recomendación al arquitecto maestro
…
```

## PROTOCOLO (igual estructura que etapas anteriores)

1. Branch nueva `etapa-15.5-link-claim` desde master.
2. NO mergees a master tú mismo. Push del branch, reporta.
3. NO toques `assets/clip-states.js`, `assets/auth.js`, `assets/firebase-core.js`.
4. NO toques el schema de `jugadores[]` (Etapa 15).
5. NO modifiques otros bloques de Firestore rules — solo AGREGAR el
   nuevo `claims/{claimUid}`. **Lección de Etapa 14**: preservar TODOS
   los bloques no mencionados.
6. Commits chicos y descriptivos.
7. Las 14 validaciones deben tener PASS/FAIL en el reporte.

## Cómo empezar

1. `git checkout master && git pull && git checkout -b etapa-15.5-link-claim`.
2. Lee `assets/matches.js` (post Etapa 15) — entiende el shape del doc
   y la API actual.
3. Lee `mi-partido.html` y `resumen.html` — identifica dónde meter el
   modo invitado y el botón compartir.
4. Implementa en este orden recomendado:
   - (a) API en `matches.js` (subscribeToClaims, claimSlot, etc.).
   - (b) Botón "Compartir" + modal en mi-partido.html.
   - (c) Modo invitado en mi-partido.html (oculta acciones, agrega
     botones "Tomar slot").
   - (d) Claim flow (modal "Sí, soy yo").
   - (e) Actualizar resumen.html con claims.
   - (f) Validar los 14 tests.
5. Sirve local con `python -m http.server 8000` y prueba con 2 navegadores
   distintos (uno como dueño, otro incógnito como invitado).
6. Reporta y push.
