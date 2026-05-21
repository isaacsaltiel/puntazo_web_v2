# Etapa 6.5 — Captura de los 4 jugadores (padel 2v2)

## Objetivo

El pádel se juega **2 vs 2** (4 jugadores). El modelo de datos (Etapa 3) y la tarjeta resumen (Etapa 6) ya soportan 4 jugadores, pero **ningún punto del flujo de UI los captura** — todo partido real se crea con `jugadores: []` y la tarjeta termina mostrando "Equipo 1 / Equipo 2" genérico.

Esta etapa cierra ese hueco: agrega la captura de los 4 nombres **en dos momentos** (decisión del owner):

1. **Opcional al inicio**: un formulario "¿Quiénes juegan?" que se puede saltar.
2. **Confirmable al terminar**: el modal "Terminar partido" muestra los 4 campos prellenados (con lo que se haya capturado al inicio) y permite editarlos antes de guardar.

Resultado: la tarjeta resumen muestra los nombres reales de los 4 jugadores en sus 2 equipos.

## Contexto

Estado del flujo tras Etapas 3-6:

```
QR/entrada → login → iniciar partido → [clips: botón físico o digital] →
  terminar partido (modal con marcador) → mi-partido ended → resumen.html
```

El modelo Firestore `matches/{matchId}` tiene el campo `jugadores`: array de hasta 4 objetos `{ nombre, uid? }` (ver `docs/matches-schema.md`). `assets/matches.js` ya lo sanea en `create()` via `sanitizeJugadores()` (máx 4, nombres ≤80 chars). La tarjeta `resumen.html` ya mapea `jugadores[0,1]` → Equipo 1 y `jugadores[2,3]` → Equipo 2.

**El problema**: los botones "Iniciar partido" (en `entrada.html` y en el banner CTA de `lado.html`) llaman `PuntazoMatches.create({ loc, can, lado })` **sin** `jugadores`. Y el modal "Terminar partido" en `mi-partido.html` captura `marcador` pero **no** `jugadores`. Así que `jugadores` siempre queda vacío.

**La solución (esta etapa)**: centralizar la captura. `mi-partido.html` ya tiene un modo `?nueva=1` (Etapa 4) que crea el match inline. Hoy ese modo crea inmediatamente. Lo vamos a enriquecer: en modo `nueva`, antes de crear, muestra el formulario opcional de jugadores. Y `entrada.html` + el CTA de `lado.html` se cambian para **redirigir a `mi-partido.html?nueva=1&...`** en vez de crear el match ellos mismos. Así el formulario vive en UN solo lugar.

## Arquitectura relevante

**`assets/matches.js` (Etapa 3):**

- `create({ loc, can, lado, jugadores?, marcadorInicial? })` — **ya acepta `jugadores`** y los sanea. No requiere cambios para la captura al inicio.
- `end(matchId, { marcador? })` — **NO acepta `jugadores` todavía**. Hay que extenderlo (ver Alcance §1).
- `sanitizeJugadores(input)` — helper interno: filtra a objetos, corta a 4, nombres a 80 chars, conserva `uid` si es string. Reusar.
- `validateMarcador(m)` — helper interno ya existente.

**Firestore Rules**: el campo `jugadores` NO está en la lista de inmutables del `update` rule (los inmutables son `userId, loc, can, lado, startedAt, createdAt`). Por tanto actualizar `jugadores` vía `end()` (que es un update) **está permitido por las rules actuales**. NO se necesita cambiar Firestore Rules.

**`mi-partido.html` (Etapas 4/5/6):**

- Modo `?nueva=1&loc=&can=&lado=`: hoy llama `create()` inmediatamente y hace `history.replaceState` a `?matchId=X`.
- Modo `?matchId=X`: muestra el partido. Estado `active` tiene el modal "Terminar partido" (con inputs de marcador: `set1t1`, `set1t2`, ... `set3t2`, selector `mpGanador`). Helpers existentes: `readSet()`, `buildMarcador()`, `renderMatch()`, etc.
- Estado `active` muestra chips de `match.jugadores` (hoy vacío en partidos reales).

**`entrada.html` (Etapa 4):**

- Botón "Iniciar partido en esta cancha" (usuario autenticado): hoy llama `PuntazoMatches.create({ loc, can, lado })` y redirige a `mi-partido.html?matchId=X`.

**`lado.html` (Etapas 4/5):**

- Banner CTA (IIFE al final del body): el botón "Iniciar partido" llama `create()` y redirige a `mi-partido.html?matchId=X`.

**Convención de equipos** (consistente con `resumen.html` de Etapa 6):

- `jugadores[0]` y `jugadores[1]` = Equipo 1.
- `jugadores[2]` y `jugadores[3]` = Equipo 2.
- Mantener este orden en todo lado para que la tarjeta resumen sea consistente.

## Archivos importantes (lee antes de empezar)

| Archivo | Por qué |
|---|---|
| [docs/workers/README.md](README.md) | Convención. **Branch base: `rediseno-jugador`**. |
| [docs/workers/etapa-06.5-jugadores-2v2.md](etapa-06.5-jugadores-2v2.md) | Este brief. |
| [assets/matches.js](../../assets/matches.js) | `create()`, `end()`, `sanitizeJugadores()`. Vas a extender `end()`. |
| [docs/matches-schema.md](../matches-schema.md) | Shape de `jugadores`. |
| [mi-partido.html](../../mi-partido.html) | Modo `nueva`, modal terminar, chips de jugadores. Cambios principales aquí. |
| [entrada.html](../../entrada.html) | Botón "Iniciar partido" — cambiar a redirigir con `?nueva=1`. |
| [lado.html](../../lado.html) | Banner CTA — cambiar el botón "Iniciar partido" a redirigir con `?nueva=1`. NO tocar el banner de filtro de Etapa 5 ni la lógica de clips. |
| [resumen.html](../../resumen.html) | Solo para confirmar el mapeo de equipos `jugadores[0,1]` / `[2,3]`. NO modificar. |

## Alcance

### 1. `assets/matches.js` — extender `end()`

- En `end(matchId, opts)`, además del manejo actual de `marcador`, aceptar `opts.jugadores`:
  ```
  if (o.jugadores !== undefined) {
    update.jugadores = sanitizeJugadores(o.jugadores);
  }
  ```
- Reusar el `sanitizeJugadores` ya existente. No duplicar.
- NO cambiar `create()` (ya acepta `jugadores`).
- Es el único cambio en `matches.js`. NO tocar nada más del módulo.

### 2. `mi-partido.html` — formulario de jugadores en modo `nueva`

- Hoy el modo `?nueva=1` crea el match inmediatamente. Cambiarlo: **antes de crear**, mostrar un formulario "¿Quiénes juegan?":
  - Título: "¿Quiénes juegan? (opcional)".
  - 4 campos de texto agrupados visualmente: **Equipo 1** (Jugador 1, Jugador 2) / **Equipo 2** (Jugador 3, Jugador 4).
  - Botón primario "Iniciar partido" → toma los nombres no vacíos, arma `jugadores: [{nombre}, ...]` (omitiendo campos vacíos, **preservando el orden de posición** — si Jugador 1 y Jugador 3 están llenos pero 2 y 4 vacíos, ver nota abajo) → `PuntazoMatches.create({ loc, can, lado, jugadores })` → `history.replaceState` a `?matchId=X` → entra al modo normal.
  - Botón secundario "Saltar" → `create({ loc, can, lado })` sin jugadores → mismo replaceState.
  - **Nota sobre posiciones vacías**: para que el mapeo de equipos sea consistente, si el usuario llena Jugador 1 y Jugador 3 pero deja 2 y 4 vacíos, NO colapses el array (no mandes `[j1, j3]` porque eso pondría j3 en Equipo 1). En su lugar: rellena las posiciones vacías con un placeholder o manda el array con las 4 posiciones donde las vacías van como `{nombre: ""}`. **Decide e implementa la opción más limpia** y documéntala en el reporte. Recomendación: si el usuario llena algo, exígele las 4 (o al menos valida que llene equipos completos); si lo deja todo vacío, "Saltar". Lo más simple y sin ambigüedad: el formulario es "todo o nada" — o llenas los 4, o saltas. Implementa eso salvo que veas algo mejor.
- Mobile-first, usa tokens CSS existentes.

### 3. `mi-partido.html` — jugadores en el modal "Terminar partido"

- El modal de terminar (que hoy tiene los inputs de marcador) gana una sección de 4 campos de jugadores, con la misma estructura Equipo 1 / Equipo 2.
- **Prellenar** los campos con `match.jugadores` actuales (si se capturaron al inicio). Si el match no tiene jugadores, los campos arrancan vacíos.
- Al "Guardar y terminar": además del `marcador`, armar `jugadores` de los 4 campos y pasarlo: `PuntazoMatches.end(matchId, { marcador, jugadores })`.
- Misma regla "todo o nada" para los jugadores: o los 4 o ninguno (consistencia de equipos).
- Si el usuario no toca los campos de jugadores (porque ya estaban prellenados del inicio), se reenvían igual — idempotente.

### 4. `entrada.html` — redirigir a modo `nueva`

- El botón "Iniciar partido en esta cancha" (usuario autenticado): en vez de llamar `create()` y redirigir con `?matchId=X`, ahora **redirige a `mi-partido.html?nueva=1&loc=&can=&lado=`** (sin crear el match — la creación pasa a mi-partido tras el formulario).
- Cero otros cambios en `entrada.html`.

### 5. `lado.html` — redirigir a modo `nueva`

- En el banner CTA (la IIFE de Etapa 4), el botón "Iniciar partido" (caso sin match activo): en vez de `create()` + redirect, ahora **redirige a `mi-partido.html?nueva=1&loc=&can=&lado=`**.
- El botón "Continuar →" (caso con match activo) NO cambia — sigue yendo a `mi-partido.html?matchId=X`.
- NO tocar el banner de filtro de Etapa 5 (`#pz-match-filter-banner`) ni la lógica de clips ni nada más de `lado.html`.

## Fuera de alcance

- Vincular jugadores a cuentas Firebase (`uid`) — futuro. Por ahora solo `nombre`.
- Editar jugadores fuera del modal de terminar (ej. durante el partido activo) — no en esta etapa.
- Cambiar `resumen.html` (ya mapea equipos correctamente; solo verifica).
- Cambiar Firestore Rules (no hace falta — `jugadores` no es inmutable).
- Tocar `create()` en matches.js (ya acepta jugadores).
- Tocar `script.js`, `reactions.js`, `card.js`, `auth.js`, `firebase-core.js`, `header.js`, `estilo.css`.
- Tocar cualquier HTML que no sea `mi-partido.html`, `entrada.html`, `lado.html`.
- Validación de nombres (longitud, caracteres) más allá de lo que `sanitizeJugadores` ya hace.

## Riesgos

1. **Mapeo de equipos roto por posiciones vacías**: si colapsas el array de jugadores (filtras vacíos), un jugador del Equipo 2 puede terminar en Equipo 1. Por eso la regla "todo o nada": o los 4 nombres o ninguno. Implementa y valida esto con cuidado — es el riesgo central de la etapa.
2. **Romper el modo `nueva` existente**: hoy funciona (crea inline). Al intercalar el formulario, no rompas el `history.replaceState` ni el flujo de "si ya hay `?matchId` no recrear".
3. **Romper `entrada.html` / `lado.html`**: el cambio es mínimo (cambiar a dónde redirige un botón). Pero verifica que el botón "Continuar" de lado.html (match activo) NO se vea afectado.
4. **Doble creación**: si el formulario de `nueva` permite click múltiple en "Iniciar partido", podrías crear 2 matches. Usar un flag `busy` durante la creación.
5. **Modal de terminar sobrecargado**: agregar 4 campos al modal que ya tiene 6 inputs de marcador + selector puede hacerlo largo en móvil. Cuida el layout — scroll dentro del modal si hace falta, secciones claras ("Jugadores" / "Marcador").
6. **Prellenado del modal**: si `match.jugadores` tiene los 4, prellenar bien cada campo en su posición correcta (j[0]→Jugador1, etc.).

## Validaciones

`python -m http.server 8080`. Login Google. Firestore real.

Reportar status (✅/❌/⏭️) + output:

1. **entrada.html → redirección**: "Iniciar partido en esta cancha" → te lleva a `mi-partido.html?nueva=1&loc=&can=&lado=` (NO crea match todavía; verifica que NO aparece doc nuevo en Firestore aún).
2. **Formulario nueva**: en `mi-partido.html?nueva=1` ves el formulario "¿Quiénes juegan? (opcional)" con 4 campos (Equipo 1 / Equipo 2) + botones "Iniciar partido" y "Saltar".
3. **Crear con jugadores**: llena los 4 nombres → "Iniciar partido" → match creado en Firestore con `jugadores` = 4 objetos `{nombre}` en orden → redirige a `?matchId=X`.
4. **Saltar**: en otro intento, "Saltar" → match creado con `jugadores: []` → redirige a `?matchId=X`.
5. **Chips en partido activo**: si capturaste jugadores al inicio, el estado active de mi-partido muestra los chips con esos nombres.
6. **Modal terminar prellenado**: en un match con jugadores capturados al inicio, abrir "Terminar partido" → los 4 campos de jugadores están prellenados correctamente (Jugador 1 = jugadores[0], etc.).
7. **Modal terminar vacío**: en un match creado con "Saltar", abrir "Terminar partido" → los 4 campos de jugadores están vacíos.
8. **Editar y guardar jugadores**: en el modal, escribe/edita los 4 nombres + marcador → "Guardar y terminar" → en Firestore el doc tiene `jugadores` actualizado (4 objetos) + `marcador` + `status: ended`.
9. **Regla todo-o-nada**: intenta guardar con solo 2 de 4 campos de jugadores llenos → debe haber un comportamiento claro y consistente (rechazar con mensaje, O ignorar parciales). Documenta cuál implementaste.
10. **resumen.html refleja los 4**: abre `resumen.html?matchId=X` de un match con 4 jugadores → la tarjeta muestra los nombres reales en Equipo 1 (2 nombres) y Equipo 2 (2 nombres), no "Equipo 1/2" genérico.
11. **lado.html CTA → redirección**: banner "Iniciar partido" → redirige a `mi-partido.html?nueva=1&...`. El botón "Continuar →" (con match activo) sigue yendo a `?matchId=X` directo.
12. **No regresión lado.html**: el banner de filtro de Etapa 5 (`?matchId`) sigue funcionando; los clips se listan normal.
13. **Doble click en "Iniciar partido"** del formulario nueva → solo 1 match creado.
14. **Mobile responsive** (375×667): formulario nueva usable, modal terminar con jugadores+marcador usable (scroll si hace falta), sin overflow.
15. **Sin errores nuevos en consola JS** en las 3 páginas.

## Definition of Done

- [ ] `matches.js`: `end()` acepta y sanea `jugadores`.
- [ ] `mi-partido.html`: formulario de jugadores en modo `nueva` + 4 campos en el modal de terminar (prellenados) + envío de `jugadores` en `end()`.
- [ ] `entrada.html`: botón "Iniciar partido" redirige a `?nueva=1`.
- [ ] `lado.html`: botón CTA "Iniciar partido" redirige a `?nueva=1`; "Continuar" intacto; banner de filtro intacto.
- [ ] Regla "todo o nada" de jugadores implementada y documentada.
- [ ] Las 15 validaciones ejecutadas y reportadas.
- [ ] Branch `etapa-06.5-jugadores-2v2` creada **desde `rediseno-jugador`**, pusheada.
- [ ] NO mergeada.
- [ ] Cero modificaciones fuera de los 4 archivos del scope.

## Formato del reporte de regreso

Del template en [docs/workers/README.md](README.md). Documentar explícitamente qué decisión tomaste para la regla "todo o nada" de jugadores (validación 9).
