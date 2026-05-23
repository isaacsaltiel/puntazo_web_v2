# Etapa 13 — Estados vivos del clip en la web (R3.1)

> Worker web de **implementación**. Branch desde `rediseno-jugador`,
> nombre `etapa-13-estados-vivos`. Toca `mi-partido.html` y `resumen.html`.
> Coordinado por el chat maestro.

## Objetivo

Hacer que la web muestre **en tiempo real** el ciclo de vida de cada clip
generado durante el partido, leyendo de la colección `clip_states/` que
publicó el sistema local en R2.

Hoy el jugador en `mi-partido.html` ve un contador de "🎬 N clips capturados"
que apunta al índice JSON estático y solo crece cuando un clip ya está
publicado y subido (~7 min después del pulso). En el medio, el jugador no
sabe si su puntazo se capturó o no. **Esa es la regla de oro del producto
trasladada a UX: que el jugador SIEMPRE sepa que su pulso fue registrado,
aunque el clip aún no esté listo.**

Después de esta etapa, cuando el jugador pulsa el botón digital (o un
botón físico funciona), el feedback inmediato aparece en pantalla:
`Puntazo #3 · 14:32:18 · en cola` → `… · listo` (con link al clip) o
`… · error/pendiente`.

## Contexto técnico (post-R2 + R2.1)

### Colección Firestore `clip_states/`

Doc id = `clip_id` (UUID estable). Esquema:

```js
{
  clip_id:          string,
  state:            "en_cola" | "visible" | "error" | "pendiente_por_conexion",
  state_detail:     string,
  state_updated_at: Timestamp,       // server
  ts_pulso:         string,          // ISO "YYYY-MM-DDTHH:MM:SS"
  club:             string,          // ej "BreakPoint"
  cancha:           string,          // ej "Cancha1"
  lado:             string,          // ej "LadoA"
  source:           "pulse" | "button" | "form" | "manual",
  job_id:           string,
  video_url:        null,            // HOY siempre null — se compone en web (ver abajo)
  published_at:     Timestamp        // server
}
```

**4 estados publicados** (los intermedios `recuperando_video`, `procesando`,
`subiendo`, etc. NO se publican; quedan invisibles para la web).

**Reglas Firestore activas**: read público para `clip_states/`, write nadie
(solo service account). Pegadas por Isaac 2026-05-23. La web puede leer
sin autenticación.

### `video_url` y el índice JSON existente

`video_url` en el doc Firestore es **siempre `null` por decisión**.
La URL del clip se compone en la web cruzando contra el índice JSON
existente:

- El sistema local nombra el clip subido como
  `Club_Cancha_Lado_DDMMYYYY_HHMMSS.mp4` donde `DDMMYYYY_HHMMSS` viene
  del `ts_pulso`. Ejemplo: pulso del 22 mayo 2026 16:49:54 →
  `BreakPoint_Cancha1_LadoA_22052026_164954.mp4`.
- El índice JSON que la web consume hoy (revisar `assets/script.js`
  línea ~704 — el contrato `card.id = entry.nombre`) trae los clips ya
  publicados por club/cancha/lado.
- Para componer la URL: cuando un doc `clip_states` está en `state=visible`,
  buscar en el índice JSON correspondiente la entry cuyo `nombre` coincida
  con el patrón derivado del `ts_pulso`. Cuando hace match, usar la URL/path
  de esa entry. Si no encuentra match (puede pasar si el índice no se
  refrescó aún), mostrar el estado `visible` pero sin link clickable —
  intentar otra vez en el próximo refresh o reload.

**Tolerancia**: el matching debería ser por timestamp **dentro de ±2
segundos** para tolerar drift del reloj del sistema local. Si dos clips
caen en la misma ventana de 2s, ordenar por proximidad exacta.

### Asociación clip ↔ partido (por ventana temporal)

`clip_states/` NO tiene `userId` ni `matchId`. La asociación se hace en
la web cruzando:

- **club** = `matches.loc`
- **cancha** = `matches.can`
- **lado** = `matches.lado`
- **ts_pulso** ∈ `[matches.startedAt, matches.endedAt || now]`

Para un partido **activo** (no terminado): incluir todos los clips con
`ts_pulso >= startedAt` y los mismos loc/can/lado.

Para un partido **terminado**: rango `[startedAt, endedAt]` cerrado.

### SDK y patrón

El proyecto usa **Firebase Web SDK v8 compat**, no v9 modular. La
sintaxis es:

```js
const db = window.PuntazoFirebase.db();
const unsubscribe = db.collection("clip_states")
  .where("club", "==", match.loc)
  .where("cancha", "==", match.can)
  .where("lado", "==", match.lado)
  .where("ts_pulso", ">=", match.startedAt.toDate().toISOString().slice(0, 19))
  .onSnapshot(snapshot => { … }, error => { … });
```

(`ts_pulso` se guarda como **string ISO** en los docs, no como Timestamp.
Por eso el filtro `>=` es lexicográfico — funciona para ISO 8601, pero
verifica que el formato del lado del cliente coincida exactamente: 19
caracteres `"YYYY-MM-DDTHH:MM:SS"`, sin zona horaria, sin milisegundos.
Si Worker B usó otro formato — algo como `"2026-05-23 09:10:44"` con
espacio en vez de T — usa ese mismo formato en el filtro.)

**Probable que Firestore pida un índice compuesto** al primer query.
La consola te da el link para crearlo con 1 click — pásamelo en el
reporte y lo confirmo con Isaac.

## Alcance — qué implementar

### A) `mi-partido.html` — lista de pulsos en vivo durante partido activo

Hoy: hay un contador `mpClipCount` que polling al índice JSON. Mantén
ese contador funcionando (es la "verdad final" de clips publicados),
pero **AGREGA** una nueva sección "Pulsos de este partido" debajo (o
arriba, decide visualmente) que viene de Firestore en tiempo real.

Estructura visual sugerida (HTML/CSS al estilo `mp-*` existente):

```
┌──────────────────────────────────────┐
│ 🎯 Pulsos de este partido            │
├──────────────────────────────────────┤
│ #1  14:32:18  ✅ listo  [Ver clip ↗] │
│ #2  14:35:02  ⏳ en cola              │
│ #3  14:35:11  ⚠️ pendiente conexión  │
│ #4  14:36:40  ❌ error                │
└──────────────────────────────────────┘
```

Cada fila:
- **#N** = orden cronológico dentro del partido (1-indexed).
- **HH:MM:SS** del `ts_pulso`.
- **Estado** con ícono + texto: `en_cola` → ⏳ "en cola",
  `visible` → ✅ "listo", `error` → ❌ "error",
  `pendiente_por_conexion` → ⚠️ "pendiente conexión".
- Cuando `visible`: botón "Ver clip" → resuelve la URL contra el índice
  JSON (ver sección de `video_url` arriba) y abre en nueva pestaña o
  reproduce inline (lo que sea consistente con `lado.html`).
- Cuando `error` o `pendiente_por_conexion`: tooltip o expandir con
  `state_detail` para debug — no críptico al jugador, pero visible si
  hace hover/tap.

Comportamiento:
- Suscripción `onSnapshot` activa mientras el partido está `active`.
- Al terminar el partido (transición a `ended` en el flujo de Etapa 5):
  desuscribir (`unsubscribe()`). El resumen toma el relevo (sección B).
- Si Firestore falla (red, permisos): mostrar mensaje sutil "Sin conexión
  con el servicio de estados" + intentar resuscribir cada 30s. NO romper
  el resto de la página.
- Mantener el contador `mpClipCount` existente sin cambios (sigue
  apuntando al índice JSON).

### B) `resumen.html` — extender con estados de clips post-partido

Hoy (Etapa 6/6.5): al terminar, `resumen.html` muestra marcador +
duración + #puntazos + jugadores y el botón "Ver clips de tu partido"
que redirige a `lado.html?...&matchId=`.

Extender: ANTES o DESPUÉS del marcador (decide visualmente, no roto el
flujo), agregar una **mini-sección "Estado de tus clips"** que liste
los clips del partido con estado, como en mi-partido.html pero ahora
sobre el rango cerrado `[startedAt, endedAt]`.

Si TODOS los clips están `visible`: mensaje verde "Todos tus clips
están listos. [Ver clips de tu partido]".

Si hay alguno `en_cola` o `pendiente_por_conexion`: mensaje neutral
"Algunos clips siguen procesándose (X de Y). Refresca en unos minutos
o ve a `lado.html` para verlos cuando estén listos."

Si hay alguno `error`: mensaje claro "X clips tuvieron un problema. Si
es importante, [reportar por WhatsApp](https://wa.me/<numero>)."
(El número de WhatsApp puede ser hardcoded `5215551234567` con un TODO
para que Isaac lo cambie — pregúntale el número antes de hardcodear
algo random.)

La suscripción aquí puede ser un `get()` one-shot (no `onSnapshot`)
porque el partido ya terminó y los estados ya no van a cambiar
frecuentemente. Pero si quieres `onSnapshot` por simplicidad, también
está bien — costo bajo.

### C) NO toques `lado.html` en esta etapa

`lado.html` ya tiene el filtro por matchId (Etapa 5) que muestra solo
los clips del partido. Esa lista viene del índice JSON existente —
sigue funcionando. La sección de estados de Firestore queda para una
etapa futura (R3.3 — Mis pendientes en perfil).

### D) Reusable: `assets/clip-states.js` (NUEVO)

Para no duplicar la lógica de suscripción entre mi-partido y resumen,
crear un módulo IIFE en `assets/clip-states.js` con API:

```js
window.PuntazoClipStates = {
  // Suscribe a clips de un partido activo. Devuelve una función unsubscribe.
  subscribeToMatch({ loc, can, lado, startedAt, endedAt = null, onUpdate, onError }) { … },

  // Query one-shot sobre rango cerrado.
  getForMatch({ loc, can, lado, startedAt, endedAt }) { return Promise<Array>; },

  // Compone la URL del clip cruzando con el índice JSON. Devuelve null si no encuentra.
  resolveVideoUrl(clipState, indexEntries) { … },

  // Genera el nombre esperado del archivo a partir de un clip state.
  expectedFileName(clipState) { return "Club_Cancha_Lado_DDMMYYYY_HHMMSS.mp4"; }
};
```

Cargar el módulo desde `mi-partido.html` y `resumen.html`, igual que
`matches.js`. El módulo NO inicializa nada solo — solo expone API.

### E) Estilos CSS

Define un bloque `.cs-*` (clip-state) reutilizable en una sección
nueva del `<style>` de cada página (o en `assets/estilo.css` si crees
que es razonable globalizarlo — decisión tuya, ambas válidas). Los
estilos `mp-*` existentes son referencia de paleta y tipografía:
mantén consistencia visual.

## Restricciones e invariantes

1. **No tocar el flujo de Etapa 5** (re-render como `ended`, botón "Ver
   clips de tu partido"). Solo agregar la sección de estados; no
   reemplazar ninguna pieza existente.
2. **No tocar `matches.js`** salvo si encuentras algo claramente roto
   relacionado a R3. Si necesitas un dato del match que `matches.js`
   no expone, **AVISA** en el reporte en vez de modificar.
3. **No tocar `lado.html`** (R3.3 lo cubre).
4. **No tocar el índice JSON ni `assets/script.js`** — la web sigue
   leyendo el índice como hoy. R3 solo AGREGA Firestore al mix.
5. **El contrato `card.id = entry.nombre`** (script.js:704) sigue
   intocable.
6. **video_url siempre null en Firestore** — no asumas que va a venir
   poblado en el futuro. La resolución es siempre en cliente.
7. **No introduzcas dependencias nuevas**. Firebase SDK ya está cargado
   en estas páginas (Auth + Firestore vía v8 compat).
8. **Performance**: la suscripción onSnapshot debería costar 1 read
   inicial + 1 read por update. Para un partido de 1.5 hr con 10 clips,
   son ~40-50 reads totales. Sin problema.

## Tests de validación (numera y reporta)

Marca cada uno PASS/FAIL. Usa el reporte para listar evidencia.

1. **Branch + base limpia**: branch `etapa-13-estados-vivos` desde
   `rediseno-jugador`. `git status` clean al empezar.

2. **Módulo carga**: `window.PuntazoClipStates` existe en `mi-partido.html`
   y `resumen.html` después de cargar.

3. **Subscripción base (sin docs reales)**: con un partido activo de
   prueba en una cancha SIN clips, la suscripción se monta sin error y
   muestra estado vacío ("Aún no hay pulsos registrados").

4. **Doc seed manual**: crear MANUALMENTE en Firebase Console un doc
   `clip_states/TEST_R3_<timestamp>` con club/cancha/lado del partido de
   prueba y `state=en_cola`, `ts_pulso` reciente. Verificar que aparece
   en la lista de mi-partido.html en <2s. Después cambiarlo a `visible`
   en la consola, verificar que actualiza en vivo a "listo". Borrarlo
   al terminar.

5. **Filtro temporal**: crear un doc con `ts_pulso` ANTERIOR al
   `startedAt` del partido. Verificar que NO aparece en la lista
   (filtro `>=` funcionando). Borrarlo.

6. **Filtro de cancha**: crear un doc con club/cancha/lado distintos
   al del partido. Verificar que NO aparece. Borrarlo.

7. **Resolución de video_url** (mock o real): con un doc `state=visible`
   cuyo `ts_pulso` corresponda a un clip real existente en el índice
   JSON del lado.html: verificar que el botón "Ver clip" abre la URL
   correcta. Si no hay clip real para probar, crear un doc mock cuyo
   ts_pulso coincida con un clip real del índice y verifica match.

8. **Unsubscribe al terminar partido**: terminar el partido (botón
   "Terminar" en mi-partido.html). Verificar en DevTools Console
   (puedes agregar un `console.log("clip_states unsubscribed")` en el
   módulo) que la suscripción se cerró. Crear un doc nuevo y verificar
   que NO genera más updates en la página.

9. **Resumen post-partido**: tras terminar, `resumen.html` muestra la
   mini-sección de estados con conteo correcto (X visibles / Y total).
   Si todos visibles → mensaje verde. Si hay error → mensaje + link
   WhatsApp.

10. **Robustez sin Firestore**: deshabilitar la red (DevTools →
    Network → offline), o cambiar el `projectId` a uno inválido
    temporalmente. La página NO debe romperse — solo el módulo de
    estados muestra "sin conexión" y el resto sigue funcionando
    (contador del índice, botón pedir clip, etc.).

11. **No regresión Etapa 5**: terminar el partido → resumen → click
    "Ver clips de tu partido" → llega a lado.html filtrado por matchId
    igual que antes. Esa pieza NO debe cambiar.

12. **Índice Firestore creado** (si Firestore lo pidió): documenta en
    el reporte el query que disparó el pedido + el link directo de
    creación + confirmación de Isaac (le pasas el link y él crea con
    1 click).

## Formato del reporte

```
## REPORTE ETAPA 13 — Estados vivos del clip (R3.1)

### Resumen ejecutivo
…

### Archivos modificados / nuevos
…

### Decisiones técnicas tomadas
…

### Bugs encontrados
…

### Riesgos detectados
…

### Qué quedó pendiente
…

### Validaciones (las 12, con status + evidencia)
…

### Índices Firestore requeridos
(query exacto + link de creación o "no requirió")

### Recomendación al arquitecto maestro
…
```

## Cómo empezar

1. `git checkout rediseno-jugador && git pull && git checkout -b etapa-13-estados-vivos`.
2. Lee completos `mi-partido.html`, `resumen.html`, `assets/matches.js`,
   `assets/script.js` (al menos la parte del card.id), `assets/firebase-core.js`.
3. Verifica en Firebase Console (Firestore → Data) que `clip_states/`
   existe y está vacía (Worker C la limpió 2026-05-23). Si hay docs,
   son nuevos del sistema corriendo en vivo.
4. Para probar suscripciones sin esperar a que la NUC publique clips
   reales, crea docs manualmente en la consola (validaciones 4-7).
5. Trabaja incremental: módulo → mi-partido → resumen → tests.
6. Para CADA cambio significativo: commit. Mantén commits chicos y
   descriptivos.
7. Al terminar, push del branch y reporta. **NO mergees a
   `rediseno-jugador` tú mismo**; el chat maestro decide cuándo.
