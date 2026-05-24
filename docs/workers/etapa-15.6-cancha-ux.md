# Etapa 15.6 — Refinamientos UX de la cancha visual

> Worker web. Branch `etapa-15.6-cancha-ux` desde **master** (post
> Etapa 15.5 mergeada, commit `85fc7dce` o posterior). Toca
> principalmente `mi-partido.html` (cancha visual + bottom sheet),
> opcionalmente `resumen.html` y `assets/matches.js`. NO cambia schema,
> NO toca clip-states.js, NO toca rules Firestore.

## Objetivo

Darle al usuario más control sobre la cancha visual de jugadores, manteniendo
el principio de **"sin miedo"** (libertad para editar, no anti-abuse). 7
features compactas:

| # | Feature | Origen |
|---|---------|--------|
| A | Drag-and-drop entre slots (con swap inteligente) | Isaac |
| B | Tachesito ✕ discreto para borrar slot ocupado (cualquiera puede) | Isaac |
| C | Pegar lista en bulk (botón "Pegar jugadores") | Master |
| D | Doble tap en slot vacío = "Soy yo" rápido | Master |
| E | Toasts de feedback en cada acción del form | Master |
| F | Indicador "cambios sin guardar" (puntito naranja) | Master |
| G | Conteo discreto "N/4 jugadores" | Master |

**No toques scoring, modos, terminar partido, link compartible, claim
flow.** Esta etapa es PURAMENTE UX del form de jugadores.

## Contexto post-Etapa 15.5

- `mi-partido.html` tiene cancha visual principal (insertada por E15.5)
  con grid 2×2 (clases `.mp-court-grid`, `.mp-court-wrap`, `.mp-slot`).
- Bottom sheet `mpSlotSheet` para editar slot (input + "Soy yo" toggle +
  "Quitar" + "Guardar").
- Sistema de claims con subcollection (E15.5) — un slot puede mostrar
  `.mp-slot-claim-tag` con el reclamante.
- Modo invitado vs dueño determinado por `currentViewMode === "owner" | "guest"`.
- `PuntazoMatches.update(matchId, partial)` y `claimSlot`/`unclaimSlot`
  ya existen.

## PROTOCOLO

1. Branch `etapa-15.6-cancha-ux` desde master.
2. NO mergees a master tú mismo. Push del branch y reporta.
3. NO toques `assets/clip-states.js`, `assets/auth.js`,
   `assets/firebase-core.js`.
4. NO toques rules Firestore — esta etapa no necesita cambios de rules.
5. NO modifiques schema de `jugadores[]` ni el modelo de claims/.
6. NO toques el modal "Terminar" (scoring +/-), ni `cancelar`, ni el
   modo `reta`/`libre`, ni los pulsos en vivo (Etapa 13).
7. Commits chicos, uno por feature idealmente (7 features → 5-7 commits).
8. Las 12 validaciones de abajo deben tener PASS/FAIL en el reporte.

## Decisiones de diseño macro

### Quién puede usar qué

Modelo **"sin miedo"** (Isaac 2026-05-23 — libertad estilo Google Doc):

- **Dueño**: TODO. Edita slots, drag, borra cualquiera, pega bulk.
- **Invitado autenticado**: puede borrar slots ocupados (también
  ajenos) sin login extra. Puede hacer drag sobre TODOS los slots. Puede
  pegar bulk (pisa lo que haya). Razón: "sin miedo" — confianza social,
  no anti-abuse.
- **Invitado sin auth**: solo lectura. Si intenta drag/borrar/pegar,
  modal "Login con Google" (igual que claim flow actual).

### Persistencia

- Drag, borrar y pegar bulk SIEMPRE escriben al doc `matches/{matchId}`
  vía `PuntazoMatches.update({ jugadores: nuevo_array })`.
- `claimedAt` y subcollection `claims/` NO se tocan en estas operaciones.
  Si un slot con claim se mueve por drag, el claim queda apuntando al
  índice viejo — solución pragmática: **al hacer drag, también
  re-emitir el claim al nuevo slot index** si el slot reposicionado
  tenía claim del current user. Para claims ajenos, dejar el claim
  apuntando al índice viejo (el dueño puede limpiarlo manualmente
  desde el modal de conflicto que ya existe).
  - Detalle: si el caller es OWNER y mueve un slot que tiene claim de
    OTRO uid, el claim queda "huérfano" (apunta a posición que ahora
    tiene otro nombre). Mostrar warning en toast: "El claim de [otro
    user] quedó desincronizado — pídele que lo retome o bórralo".

## Alcance por feature

### A) Drag-and-drop entre slots

- HTML5 drag-and-drop API. Cada `.mp-slot` ocupado es `draggable=true`.
  Slots vacíos son `dropzone` siempre. Slots ocupados son dropzone
  también (para swap).
- Eventos: `dragstart` guarda índice fuente, `dragover` previene default,
  `drop` ejecuta la lógica de swap/mover.
- **Swap inteligente**:
  - Drop sobre slot VACÍO → mover el jugador (slot fuente queda vacío,
    destino recibe el objeto del jugador con el `equipo` del destino).
  - Drop sobre slot OCUPADO → intercambiar los dos jugadores (cada uno
    conserva el `equipo` correspondiente a su nuevo slot).
- Visual durante drag:
  - Slot fuente: opacidad 0.4.
  - Slot destino válido al hover: borde azul o highlight sutil.
- Móvil: drag-and-drop con touch events (`touchstart`/`touchmove`/`touchend`).
  Si es complejo o el tiempo del worker es limitado, **fallback aceptable**:
  long-press en mobile abre un mini-menú "Mover a... [equipo 1 / equipo 2 / slot 0..3]".
- Después del drop exitoso: `update({ jugadores: nuevoArray })` + toast
  "Slots actualizados".

### B) Tachesito ✕ discreto para borrar slot

- En la esquina superior derecha de cada slot ocupado, un botón ✕ pequeño
  (~16px). Opacidad 0.4 por default, 1.0 al hover.
- Click → confirmación inline (no modal): el ✕ se convierte en un mini
  "¿Borrar?" con botón check verde y X roja, durante 3 segundos. Si no
  hay confirmación, vuelve a estado normal.
- Al confirmar: `update({ jugadores: nuevoArray sin ese slot })` + toast
  "Slot eliminado".
- Si el slot borrado tenía claim: NO borrar el claim automáticamente
  (no podemos borrar claim ajeno desde acá). Solo limpiar el `uid` del
  doc principal. El claim queda como dato hasta que el dueño limpie
  manualmente o el claimer reclame otro slot.
- **Importante**: cualquiera (dueño o invitado autenticado) puede borrar
  cualquier slot. Es "sin miedo".

### C) Pegar lista en bulk

- Botón "📋 Pegar jugadores" en la esquina inferior izquierda de la
  cancha (visible siempre).
- Click → modal/bottom sheet con:
  - Textarea: "Pega los nombres separados por coma o nueva línea".
  - Placeholder de ejemplo: `Isaac, Jul, Amir, Galia`.
  - Botón "Aplicar".
- Lógica:
  - Split por `,` o `\n` o `;`. Trim de cada uno. Filtrar strings vacíos.
  - Tomar los primeros 4. Asignar:
    - índices 0,1 → equipo 1.
    - índices 2,3 → equipo 2.
  - Sobreescribir TODO el array `jugadores[]` (warning en el modal:
    "Esto reemplazará a los jugadores actuales").
- Si auth es invitado SIN login y intenta aplicar, login flow.

### D) Doble tap en slot vacío = "Soy yo" rápido

- Atajo en mobile/desktop: doble click/tap rápido en slot vacío =
  ejecutar "Soy yo" sin abrir bottom sheet.
- Requiere user autenticado. Si no hay user, abrir login.
- Si ya hay otro slot con tu uid → mostrar toast "Ya estás en el slot
  N. ¿Quieres moverte aquí?" con acción "Sí" que hace el swap.
- Visual: animación corta de "ping" en el slot al activarse.

### E) Toasts de feedback

- Implementar un sistema simple de toasts (si no existe ya en el repo
  — revisa, puede que sí). Posición: bottom center, fade in/out 2s.
- Disparar toast en cada acción exitosa del form:
  - "Jugador agregado"
  - "Slot eliminado"
  - "Slots intercambiados"
  - "Lista aplicada (N jugadores)"
  - "Soy yo en slot N"
  - "Claim cancelado"
- Toast de ERROR si una operación falla (ej. update rejected): "No se
  pudo guardar — intenta de nuevo".

### F) Indicador "cambios sin guardar"

- Las operaciones A, B, C, D escriben directo a Firestore (no hay
  "guardar" — es write-through). Pero el ESTADO LOCAL puede estar
  desfasado del servidor durante la latencia (~200-500ms).
- Mostrar un puntito naranja sutil en la esquina superior derecha de
  la cancha durante el round-trip: aparece al disparar update, desaparece
  cuando el onSnapshot confirma el cambio.
- Si pasa >5s sin confirmación, el puntito se vuelve rojo + tooltip
  "No se pudo guardar — revisa tu conexión".

### G) Conteo "N/4 jugadores"

- Texto pequeño y discreto en la esquina inferior derecha de la cancha:
  "N/4 jugadores".
- Si hay claims:`N/4 jugadores · M reclamado(s)`.
- Sin acción al click — solo informativo.

## Tests de validación (12)

1. **Branch limpia desde master post-E15.5**: PASS/FAIL.

2. **Drag entre slots vacíos** (feature A): drag desde slot ocupado a
   slot vacío → jugador mueve, slot fuente vacío. Cambio persiste en
   Firestore (verificar en Console). PASS/FAIL.

3. **Drag con swap** (feature A): drag desde slot ocupado a otro slot
   ocupado → ambos jugadores intercambian (cada uno conserva el equipo
   del nuevo slot). PASS/FAIL.

4. **Drag mobile/touch** (feature A): probar en DevTools mobile mode o
   en un dispositivo real. Si solo se implementó fallback long-press,
   verificar que el menú aparece y el slot se mueve. PASS/FAIL.

5. **Tachesito ✕** (feature B): hover sobre slot ocupado → ✕ visible →
   click → confirmación inline → confirmar → slot vacío. Firestore
   refleja. PASS/FAIL.

6. **Tachesito como invitado autenticado** (feature B): desde sesión
   incógnita logueada con otra cuenta, borrar slot ajeno → permitido,
   slot se borra. PASS/FAIL.

7. **Pegar bulk** (feature C): botón "Pegar jugadores" → modal → pegar
   `Isaac, Jul, Amir, Galia` → click "Aplicar" → 4 slots populados,
   2v2. Firestore refleja. PASS/FAIL.

8. **Pegar bulk con >4 nombres** (feature C): pegar 6 nombres → solo
   los primeros 4 se toman, advertencia en toast "Se ignoraron 2
   nombres adicionales". PASS/FAIL.

9. **Doble tap "Soy yo"** (feature D): doble click rápido en slot
   vacío estando logueado → slot ocupado por user actual + foto.
   Sin abrir bottom sheet. PASS/FAIL.

10. **Toasts en cada acción** (feature E): cada feature (A-D) dispara
    el toast correspondiente, visible al menos 1.5s, sin solapamiento
    si hay varias acciones seguidas. PASS/FAIL.

11. **Indicador "guardando"** (feature F): al disparar update, puntito
    naranja aparece. Desaparece al confirmarse el snapshot. Si se
    deshabilita la red en DevTools, puntito naranja → rojo después
    de 5s con tooltip. PASS/FAIL.

12. **Conteo N/4 + claims** (feature G): con 2 slots y 1 claim, el
    texto dice "2/4 jugadores · 1 reclamado". Se actualiza en vivo
    al agregar más. PASS/FAIL.

## Formato del reporte (igual estructura que etapas anteriores)

```
## REPORTE ETAPA 15.6 — Refinamientos UX cancha visual

### Resumen ejecutivo
…

### Archivos modificados / nuevos
…

### Decisiones técnicas tomadas
(en especial: cómo resolviste el drag en mobile, qué pasa con claims
huérfanos en drag, cómo implementaste el toast)

### Bugs encontrados
…

### Riesgos detectados
(en especial: race conditions entre múltiples editores simultáneos)

### Validaciones (12 con PASS/FAIL)
…

### Recomendación al arquitecto maestro
…
```

## Cómo empezar

1. `git checkout master && git pull && git checkout -b etapa-15.6-cancha-ux`.
2. Lee `mi-partido.html` post-E15.5 — entiende cómo está construida la
   cancha visual principal, el bottom sheet, los claim tags, y la
   distinción owner/guest.
3. Revisa si ya existe un sistema de toast en el repo (`grep -r
   "toast" assets/`). Si existe, reusa. Si no, mini-implementación
   inline (~30 líneas CSS+JS).
4. Implementa en este orden recomendado (cada feature un commit):
   - (E) Toast system primero (lo van a usar todas las demás).
   - (B) Tachesito ✕ (simple, base de las demás).
   - (D) Doble tap (también simple).
   - (C) Pegar bulk (modal nuevo).
   - (G) Conteo N/4 (texto puro).
   - (F) Indicador guardando (más sutil).
   - (A) Drag-and-drop (más complejo, déjalo al final).
5. Sirve local con `python -m http.server 8000` y prueba con 2
   navegadores (dueño + invitado autenticado) para validar permisos.
6. Reporta y push.
