# Etapa 15 — Lógica real de partido + form jugadores visual

> Worker web. Branch `etapa-15-logica-partido` desde **master** (después
> de que Etapa 14 esté mergeada). Toca `assets/matches.js`, `mi-partido.html`,
> `resumen.html`. Schema breaking de `matches.jugadores` con backward
> compatibility en código. NO incluye link compartible / claim de slot —
> eso es Etapa 15.5.

## Objetivo

Reemplazar el form de jugadores actual y la lógica de marcador con un
sistema que respete las reglas reales del pádel:

- **Form de jugadores**: cancha visual top-down (2x2 con divisor de red).
  Slots flexibles 0-4 (no más invariante 0-or-4). Cada slot puede estar
  vacío, tener solo nombre, o tener nombre + uid vinculado.
- **Lógica de scoring real**: sets válidos (6-0 a 6-4, 7-5, 7-6 con
  tiebreak). UI con botones +/-, sin teclado. Ganador auto-detectado.
  El partido termina cuando uno gana N sets (mejor de 3 = 2 ganados;
  mejor de 5 = 3 ganados). Coloreado por set en resumen.
- **Modos de partido**: `partido_3`, `partido_5`, `reta`, `libre`. Más
  formatos (americano, torneos) en etapas posteriores.
- **Schema extensible**: agregar `deporte: "padel" | "tenis"` desde ya
  (default `padel`, sin UI todavía).

## Contexto post-Etapa 14

- Producción master tiene: Etapas 0-13 + hot-patches + limpieza de
  reactions/comments/mejores (Etapa 14).
- `matches/` en Firestore con schema actual:
  - `userId, loc, can, lado, status, startedAt, endedAt, createdAt`
  - `jugadores: string[]` de longitud 0 ó 4 (invariante de Etapa 6.5
    que ROMPEMOS en esta etapa).
  - `marcador: {sets: [{team1, team2}], ganador?: "team1"|"team2"}`.
- `assets/matches.js` (window.PuntazoMatches) tiene `create`, `end`,
  `cancel`, `get`, `listByUser`, `getActiveForUser`, `findClipsForMatch`,
  `sanitizeJugadores`, `validateMarcador`.
- `mi-partido.html`: cronómetro, contador clips (índice JSON), sección
  "Pulsos de este partido" (Firestore live), botón "Pedir clip ahora",
  botón "Terminar" con modal de marcador, "Cancelar partido". Form de
  jugadores opcional al inicio + confirmable al terminar.
- `resumen.html`: tarjeta tipo Strava, splitTeams asume `jugadores[0,1]`
  = team1, `jugadores[2,3]` = team2.

## PROTOCOLO

1. Branch `etapa-15-logica-partido` desde master (no desde Etapa 14 si
   aún no mergeo — confirma con el maestro). `git status` clean.
2. NO mergees a master tú mismo. Push del branch y reporta.
3. NO toques `assets/clip-states.js`, `assets/auth.js`,
   `assets/firebase-core.js`, ni el sistema local NUC.
4. NO toques `entrada.html` (no es necesario para esta etapa).
5. NO implementes link compartible / claim de slot — eso es Etapa 15.5.
6. Commits chicos y descriptivos.
7. Las 12 validaciones de abajo deben tener PASS/FAIL en el reporte.

## Schema nuevo en `matches/`

Campos modificados/agregados (los demás se conservan):

```js
{
  // Existente
  userId:    string,
  loc:       string,
  can:       string,
  lado:      string,
  status:    "active" | "ended" | "cancelled",
  startedAt: Timestamp,
  endedAt:   Timestamp | null,
  createdAt: Timestamp,

  // NUEVOS / MODIFICADOS
  deporte:   "padel" | "tenis",    // NUEVO. Default "padel". Sin UI todavía.
  modo:      "partido_3" | "partido_5" | "reta" | "libre",  // NUEVO. Default "partido_3".
  jugadores: Array<{               // CAMBIO BREAKING
    nombre: string,                // "" si vacío (puede usarse para reservar slot sin nombre)
    equipo: "team1" | "team2",
    uid?:   string,                // opcional, vinculación al usuario
    claimedByUid?: string          // opcional, reservado para Etapa 15.5 (claim via link)
  }>,
  marcador:  {                     // EXTIENDE según modo (ver abajo)
    sets?:    [{ team1, team2 }],  // modo partido_3, partido_5
    ganador?: "team1" | "team2",   // modo reta, o cualquiera con ganador
    gamesTotal?: { team1, team2 }, // modo libre (suma de games sin sets)
    tiebreak?: [{ team1, team2 }]  // tiebreaks del set, mismo índice que sets
  }
}
```

### Migración / backward compat

- **Lectura**: `assets/matches.js` debe detectar formato legacy y normalizar
  en memoria al formato nuevo. Lógica:
  - Si `jugadores` es `string[]`, convertir a `[{nombre, equipo}]` con
    `[0,1]→team1` y `[2,3]→team2`.
  - Si falta `deporte`, asumir `"padel"`.
  - Si falta `modo`, asumir `"partido_3"`.
- **Escritura**: SIEMPRE escribir formato nuevo. No reescribir docs
  viejos preventivamente — solo cuando el usuario edite.
- **NO script de migración masiva**. Los partidos legacy se siguen
  leyendo correctamente.

### Validador `sanitizeJugadores` actualizado

- Antes: aceptaba solo arrays de longitud 0 ó 4.
- Ahora: acepta arrays de longitud 0 a 4. Cada elemento debe tener
  `nombre` (string), `equipo` ("team1" o "team2"). `uid` y
  `claimedByUid` opcionales (strings).
- Filtrar/sanitizar nombres vacíos opcionalmente NO los borre — un
  slot reservado sin nombre es válido (ej. "espacio para Galia").

### Reglas Firestore (extender el bloque `matches/` existente)

- `allow read: if true` para `matches/{matchId}` (relajación necesaria
  para Etapa 15.5; ya la hacemos aquí para no tener que tocar dos veces).
  El anterior era "dueño O status=ended". Justificación: matchId es UUID
  no enumerable; quien tiene el ID es porque alguien lo compartió. Mismo
  modelo que `clip_states/`.
- Update: extender la lista de fields inmutables, NO incluir `jugadores`,
  `marcador`, `modo`, `deporte` (estos son editables por el dueño).
  `userId, loc, can, lado, startedAt, createdAt` siguen inmutables.
  `endedAt` write-once.
- Worker debe proponer las reglas NUEVAS completas en el reporte (mismo
  patrón que Etapas anteriores).

## Lógica de scoring (modo `partido_3` y `partido_5`)

### Set válido

Un set termina cuando:
- Un equipo llega a 6 games con diferencia ≥2 → 6-0, 6-1, 6-2, 6-3, 6-4.
- O llega a 7 games por 5 → 7-5.
- O van 6-6 → se juega tiebreak. Quien gana el tiebreak (mínimo 7
  puntos, diferencia ≥2) se lleva el set 7-6.

### Partido válido

- `partido_3`: gana quien primero llega a 2 sets ganados (mejor de 3).
- `partido_5`: gana quien primero llega a 3 sets ganados (mejor de 5).
- Si el partido termina con `partido_3` y un equipo va 2-0, NO se permite
  registrar tercer set. UI deshabilita "agregar set".

### UI sin teclado

- Cada set en el modal "Terminar partido" se ingresa con botones +/-:
  - `[− Team1 +]   6   [− Team2 +]   4`
- Validación viva:
  - Si el set ya es válido (uno tiene 6 con dif ≥2, o 7-5, o 7-6 con
    tiebreak), se marca verde y el botón "Siguiente set" se habilita.
  - Si no, en rojo con mensaje "Set no válido (debe terminar 6-X con
    diferencia ≥2, 7-5, o 7-6 con tiebreak)".
  - Si llega 6-6, aparece automáticamente sección "Tiebreak"
    con su propio +/- (puntos del tiebreak, mismo formato).
- Botón "Set ganado por team1" / "Set ganado por team2" NO existe —
  se deduce solo.

### Modo `reta`

- Sin sets. UI muestra solo "¿Quién ganó?" con 2 botones grandes
  "Equipo 1" / "Equipo 2". `marcador = {ganador: "team1"}`.

### Modo `libre`

- Sin sets. UI muestra contador de games sumados por equipo (botones
  +/-). No hay ganador auto. Al terminar, el equipo con más games gana
  (o empate si igual). `marcador = {gamesTotal: {team1, team2},
  ganador: "team1"|"team2"|"empate"}`.

## Form de jugadores: cancha visual top-down

### Layout

SVG o CSS grid representando una cancha de pádel vista desde arriba.
Divisor horizontal central = la red. Arriba = Equipo 2, abajo = Equipo 1
(o al revés — decide visualmente cuál se siente más natural).

Cada equipo tiene 2 cuadrantes (uno por jugador):

```
╔════════╦════════╗
║ slot 0 ║ slot 1 ║   ← Equipo 1 (o 2)
║        ║        ║
╠════════╬════════╣   ← red
║ slot 2 ║ slot 3 ║   ← Equipo 2 (o 1)
║        ║        ║
╚════════╩════════╝
```

### Estado de cada slot

- **Vacío**: muestra ícono "+" centrado, fondo sutilmente más claro.
  Tap → bottom sheet (o modal) para agregar.
- **Con nombre (sin uid)**: muestra solo el nombre tipográficamente
  bonito. **NO muestra avatar genérico** (Isaac 2026-05-23: "que no
  invada la estética").
- **Vinculado (nombre + uid)**: muestra foto del usuario + nombre.

### Bottom sheet "Agregar jugador a slot N"

- Input "Nombre" (libre).
- Botón "Soy yo" (vincula el slot al usuario actual; solo aparece si
  hay user autenticado Y el user no está ya en otro slot).
- Botón "Guardar" → escribe en `matches.jugadores[N]`.
- Botón "Quitar" (solo si slot no vacío) → limpia.

### Validación

- Permitir 0, 1, 2, 3 o 4 slots ocupados.
- No exigir nombres únicos.
- No exigir que cada equipo tenga 2 — un partido puede tener 1 jugador
  por equipo (1v1) o desbalanceado (3 vs 1) en modo `reta` / `libre`.
- Para modos `partido_3` y `partido_5`, sugerir (no obligar) 2v2 con
  un hint visual: "Sugerencia: pádel se juega 2 vs 2".

### Cuándo se edita el form

- **Al crear partido** (en `entrada.html` o `mi-partido.html`): opcional,
  el usuario puede entrar sin jugadores y agregarlos después.
- **Durante el partido** (`mi-partido.html`): editable en cualquier
  momento.
- **Al terminar** (modal de "Terminar"): editable como hoy.
- **En el resumen** (`resumen.html`): visible pero NO editable post-end
  (excepto por el dueño, si quieres habilitar — decide).

## Coloreado por set en `resumen.html`

Hoy `resumen.html` colorea TODO el marcador según el ganador del partido.
Cambiar a: cada set independiente.

- Por cada set en `marcador.sets`:
  - Si team1 ganó ese set → nombres team1 en **azul**, números team1
    en azul. team2 en gris.
  - Si team2 ganó → al revés.
- El nombre del ganador del PARTIDO completo se marca con un ícono extra
  (corona, check, etc).

Ejemplo visual (modo partido_3, team1 gana 2-1):

```
                Set 1   Set 2   Set 3
Equipo 1
 · Isaac (azul)   6      3       7  (azul)
 · Jul   (azul)
                                          ← team1 gana set 1 y 3
Equipo 2
 · Amir  (gris)   4      6       5
 · Galia (gris)         (azul)
                  (azul, set 2 lo gana team2)
                                          ← team2 gana solo set 2
```

(El render exacto lo decides tú; lo importante es que cada set se
colorea independientemente.)

## Tests de validación

1. **Branch limpia + base actualizada**: `git status` clean, base es
   `master` (post Etapa 14 si está mergeada).

2. **Schema backward compat — lectura**: crear manualmente en Firebase
   Console un doc legacy `matches/TEST_LEGACY` con
   `jugadores: ["A","B","C","D"]` y sin `modo`/`deporte`. Abrir
   `mi-partido.html?id=TEST_LEGACY`. Verificar que se renderiza
   correctamente como 4 slots ocupados, 2v2, modo `partido_3` default.

3. **Schema backward compat — escritura**: editar el partido legacy
   anterior (agregar set al marcador). Verificar que en Firestore el
   doc queda escrito con el formato nuevo (`jugadores` array de objetos,
   `modo` populado).

4. **Form 0-4 slots flexible**: crear partido nuevo, dejar 0 jugadores
   → guardar → reabrir → siguen 0. Editar y agregar 2 → guardar →
   reabrir → siguen 2. Misma prueba con 3.

5. **Cancha visual sin avatar placeholder**: en un slot con solo nombre
   (sin uid), verificar que NO hay avatar circular gris genérico. Solo
   nombre tipográfico.

6. **Cancha visual con uid**: agregar slot con "Soy yo" → verificar
   que se muestra foto del user actual + nombre.

7. **Scoring partido_3 ganador automático**: crear partido modo
   `partido_3`, terminar con marcador team1 6-4, team1 6-3 → verificar
   que `marcador.ganador == "team1"` automático, partido se cierra,
   NO se permite agregar 3er set.

8. **Scoring tiebreak**: terminar partido con set 6-6 → verificar que
   UI abre tiebreak automático. Marcar tiebreak 7-3 → set queda 7-6
   con tiebreak `{team1:7, team2:3}` registrado.

9. **Scoring validación viva**: intentar registrar set 1-2 → UI
   marca en rojo "set no válido". Botón "guardar" disabled.

10. **Modo reta**: crear partido modo `reta`, terminar con "ganó
    team1" → `marcador = {ganador: "team1"}` sin sets. Resumen muestra
    "Reta — Ganaron Isaac y Jul" sin tabla de sets.

11. **Coloreado por set**: crear partido `partido_3` ganado 2-1
    (sets: 6-4, 3-6, 7-5). Verificar en resumen:
    - Set 1: team1 nombres+números azul, team2 gris.
    - Set 2: team2 azul, team1 gris.
    - Set 3: team1 azul, team2 gris.
    - Ganador del partido (team1) tiene ícono extra (corona, etc).

12. **No regresión Etapa 13**: la sección "Pulsos de este partido" en
    mi-partido.html sigue funcionando idéntica. La mini-sección
    "Estado de tus clips" en resumen.html también.

## Formato del reporte

```
## REPORTE ETAPA 15 — Lógica real de partido + form visual

### Resumen ejecutivo
…

### Archivos modificados / nuevos
…

### Decisiones técnicas tomadas
…

### Schema nuevo en matches/ (ejemplo de doc nuevo y de doc legacy normalizado)
…

### Lógica de scoring implementada (resumen del algoritmo)
…

### Form visual: capturas/mockups del estado vacío, solo-nombre, vinculado
(descripción textual está bien si no hay browser disponible)
…

### Reglas Firestore propuestas (bloque completo nuevo)
```
…
```

### Bugs encontrados
…

### Riesgos detectados
…

### Validaciones (12 con PASS/FAIL)
…

### Recomendación al arquitecto maestro
(qué falta para Etapa 15.5, qué encontraste que pueda afectar Etapa 16/17)
…
```

## Cómo empezar

1. `git checkout master && git pull && git checkout -b etapa-15-logica-partido`.
2. Lee completo `assets/matches.js`, `mi-partido.html`, `resumen.html`.
3. Sirve local con `python -m http.server 8000` para probar.
4. Trabaja en este orden recomendado:
   - (a) Extender `matches.js` con nuevo schema + backward compat lectura/escritura.
   - (b) Implementar form visual (cancha top-down) en `mi-partido.html`.
   - (c) Implementar scoring real (validación, tiebreak, ganador auto).
   - (d) Actualizar `resumen.html` con coloreado por set.
   - (e) Validar tests 1-12.
5. Reporta y push.
