# Etapa 14.5 — Limpieza pendiente (jugador.html + admin.html + copy index.html)

> Worker web. Branch `etapa-14.5-cleanup-pendiente` desde **master**
> (post Etapa 15.6). Tres tareas distintas pero relacionadas, todas de
> housekeeping derivadas del rediseño centrado en el jugador.

## Objetivo

Cerrar los pendientes documentados por el worker de Etapa 14 que NO se
hicieron por scope:

1. **Borrar `jugador.html`** — quedó casi inútil tras Etapa 14 (sus
   queries a `participants/` ya no existen, siempre muestra "Sin
   apariciones").
2. **Limpiar `admin.html`** — quitar UI relacionada a la feature
   eliminada (tab "🔥 Reacciones", KPIs `kpiReactions`/`kpiComments`/
   `kpiClaims`, columna "⭐" badge inmortal). Mantener el resto.
3. **Reescribir el copy de `index.html`** con el positioning nuevo
   centrado en el flujo de partido (entrada → mi-partido → resumen), no
   "ranking de mejores clips" como hoy.

## PROTOCOLO

1. Branch `etapa-14.5-cleanup-pendiente` desde master.
2. NO mergees a master tú mismo. Push del branch y reporta.
3. NO toques: `mi-partido.html`, `resumen.html`, `entrada.html`,
   `assets/clip-states.js`, `assets/auth.js`, `assets/firebase-core.js`,
   `assets/matches.js`, rules Firestore, schema.
4. NO toques `data/` (índices JSON, metrics).
5. Commits por pieza (3 commits: jugador.html / admin.html / index.html).
6. Las 9 validaciones de abajo deben tener PASS/FAIL.

## Parte A — Borrar `jugador.html`

### Acción

- Borrar el archivo `jugador.html` completo.
- Buscar referencias y quitarlas:
  - `grep -r "jugador.html" --include="*.html" --include="*.js" --include="*.css"`
  - Esperables: posible link en `assets/header.js`, posible link en
    `perfil.html` o `index.html`. Quitar cada uno (link, botón, item
    de menú).
- Si encuentras código JS asociado (funciones que solo se llaman desde
  jugador.html), borrar también.

### Tests

- `ls jugador.html` → "No such file".
- `grep -r "jugador.html"` → 0 matches (excepto en docs).
- Cargar `index.html` y `perfil.html` localmente: sin errores 404 en
  console.

## Parte B — Limpiar `admin.html`

### Estado actual (post-Etapa 14)

Worker E14 dejó `admin.html` casi intacto. Su recomendación explícita
para Etapa 14.5 (cito del reporte):

> Quitar tab "🔥 Reacciones", los 3 KPIs (`kpiReactions`/
> `kpiComments`/`kpiClaims`) y la columna ⭐ inmortal. Y la función
> `getParticipantsFor*`.

### Acción

Inspeccionar `admin.html` y remover:

1. **Tab "🔥 Reacciones"** (UI + handler). Probablemente alrededor de
   un `<button>` o `<a>` con texto "Reacciones" o emoji 🔥. Sigue el
   listener que lo activa y quita la tab pane asociada.
2. **KPIs**:
   - El elemento DOM con id `kpiReactions` y su line de actualización
     en JS (`s('kpiReactions', ...)`).
   - Idem para `kpiComments` y `kpiClaims`.
   - Si la fila completa de los 3 KPIs queda vacía o desbalanceada,
     ajustar el layout (no dejar columna fantasma).
3. **Columna ⭐ inmortal** en alguna tabla de videos (línea ~1126
   reportada por E14): `${d.immortal?'<span class="pill pill-gold">⭐</span>':''}`.
   Quitar la celda completa. Ajustar `<thead>` correspondiente.
4. **Función `getParticipantsFor*`** y todas sus llamadas. Limpiar.

### Mantener intacto

- Stats analíticas que NO son de reactions (kpis de matches, clips,
  usuarios, etc.).
- Login admin con Firebase Auth + allowlist (no tocar el auth de
  admin).
- Cualquier KPI o panel que tenga datos vivos.

### Tests

- `grep -i "reacciones\|kpiReactions\|kpiComments\|kpiClaims\|getParticipantsFor" admin.html`
  → 0 matches.
- Cargar `admin.html` con sesión admin: la página se ve coherente
  (sin huecos visuales), KPIs restantes siguen mostrando datos, no
  hay errores en console.

## Parte C — Reescribir copy de `index.html`

### Lo que está hoy (problemas)

- Hero subtítulo: *"Captura, comparte y destaca tus mejores jugadas."*
  — sigue hablando del modelo viejo (clips sueltos, destacar).
- Sección "Novedades" menciona *"primera edición del concurso mensual
  de Puntazos"* — feature CANCELADA en E14 (no hay concurso).
- Sección "Cómo funciona" subtítulo: *"...Y si tu video prende, se gana
  su lugar entre los mejores del sitio"* — referencia al ranking
  cancelado.
- Step 2 incluye *"badge-dev: Próximamente: activación por gestos 🤚"*
  — verificar si sigue vivo o también es legacy.
- Otras referencias menores a "ranking", "mejores", "destacar" que
  deben pivotar al nuevo posicionamiento.

### Lo que debe comunicar (positioning nuevo)

Puntazo es:

- **Una plataforma para vivir un partido completo**: inicias, juegas,
  cada puntazo se captura, terminas con un resumen visual compartible.
- **No** es un sitio para "rankear clips" ni para "destacar entre la
  comunidad".
- El club instala el sistema; el jugador usa la app antes/durante/después.

### Mensajes clave (5)

Tu trabajo es alinearlos al copy actual respetando el tono (directo,
deportivo, sin marketing inflado, mismo formato visual). NO agregues
features que no existen. Si dudas sobre wording, deja un TODO visible
en el HTML para que Isaac revise antes de merge.

1. **Hero**: el deporte merece tecnología — pero ahora articulado
   alrededor del partido, no del clip suelto.
   - Sugerencia título: mantener "El deporte merece tecnología de
     punta" si funciona, o pivotar a "Tu partido. Tus puntazos. Tu
     resumen."
   - Sugerencia subtítulo: "Inicia tu partido, captura cada puntazo con
     el botón, y comparte el resumen visual al terminar."
   - Sugerencia: agregar CTA primaria "Iniciar partido" (link a
     `entrada.html`) junto a "Encuentra tus clips" (que sigue válida).

2. **Novedades**: pivotar de "concurso mensual" a "el partido digital".
   - Sugerencia: "Lo nuevo: partidos digitales. Inicia desde el QR de
     tu club, lleva el marcador, comparte el resumen estilo Strava."
   - Quitar referencia al concurso/ranking.

3. **Stats**: la sección actual ("3 clubs activos", "24h clips
   disponibles", "5 soluciones") está OK. No tocar salvo si los números
   están claramente desactualizados (en cuyo caso, deja TODO visible).

4. **"Cómo funciona"**: reformular el subtítulo y los 3 steps al
   nuevo flujo (entrada → mi-partido → resumen).
   - Subtítulo nuevo: "Desde que escaneas el QR hasta que compartes tu
     resumen, todo sucede sin pensarlo."
   - Step 1: "Escaneas el QR de tu cancha" (sustituye "Juega como
     siempre").
   - Step 2: "Tocas el botón en cada puntazo" (mantener, con leve ajuste
     si necesario).
   - Step 3: "Terminas el partido y compartes el resumen" (sustituye
     o ajusta el step 3 actual).
   - El badge `badge-dev: activación por gestos 🤚` — DECIDIR: si es
     legacy descontinuado, quitar. Si Isaac lo tenía planeado a futuro,
     reformular o quitar igual. Por defecto QUITAR (a menos que el copy
     actual sea claramente intencional). Deja un comentario `<!-- TODO
     Isaac: gestos era roadmap? -->` para confirmación.

5. **"Para clubs"** (si existe esta sección): conserva pero ajusta el
   pitch. En vez de "tráfico por concurso del mes" → "más tiempo de
   permanencia del jugador en tu marca: cada partido es una sesión
   completa".

### NO inventes

- Si NO sabes cómo articular algo, deja `<!-- TODO Isaac: ... -->`.
- NO agregues testimonios, NO agregues precios, NO menciones features
  que NO existen hoy en producción (ej. visión por computadora, app
  móvil propia, ranking ELO — todo eso es futuro/exploración).
- NO toques el footer copyright ni links de contacto.

### Tono y estilo

- Mantener emojis donde ya hay (es parte del tono).
- Mantener clases CSS existentes (`.section-wrap`, `.btn-primary`, etc).
- Mantener tracking analytics `gtag('event', ...)` — solo cambia los
  `event_label` si el nombre tiene sentido cambiar (ej. de
  `hero_cta_mejores` no debería existir ya — verificar que E14 los
  quitó).
- Conserva la estructura visual (hero → novedades → stats → cómo
  funciona → para clubs → footer). No reorganices secciones.

### Tests

- Cargar `index.html` localmente. Visualmente coherente, sin huecos.
- `grep -i "ranking\|concurso\|destaca tus mejores\|prende.*mejores"
  index.html` → 0 matches (palabras del positioning viejo).
- Las CTAs primarias funcionan (links a `entrada.html`, `explorar.html`,
  `lado.html`).
- Sin errores 404 en console (verificar links).
- Si dejaste TODOs visibles, listarlos en el reporte.

## Validaciones (9 con PASS/FAIL)

1. **Branch limpia desde master**: PASS/FAIL.
2. **jugador.html borrado + sin refs**: PASS/FAIL (grep limpio).
3. **No regresión otras páginas**: header.js sin link a jugador,
   perfil.html sin link, index.html sin link. PASS/FAIL.
4. **admin.html — tab "Reacciones" removida**: PASS/FAIL.
5. **admin.html — KPIs vacíos removidos**: `grep "kpiReactions\|kpiComments\|kpiClaims"` → 0. PASS/FAIL.
6. **admin.html — columna ⭐ removida**: PASS/FAIL.
7. **index.html — copy nuevo aplicado**: PASS/FAIL (visualmente
   coherente + grep "concurso\|ranking\|destaca tus mejores" → 0).
8. **No regresión visual general**: cargar las 8 páginas core
   (index, lado, clip, perfil, admin, entrada, mi-partido, resumen)
   localmente, abrirlas en browser, ver layout sin huecos. PASS/FAIL.
9. **Lista de TODOs visibles en index.html**: si hay dudas, marcadas
   con `<!-- TODO Isaac: ... -->`. Listar en el reporte para que el
   maestro decida.

## Formato del reporte

```
## REPORTE ETAPA 14.5 — Limpieza pendiente

### Resumen ejecutivo
…

### Archivos modificados / nuevos
…

### Decisiones de copy tomadas (qué reescribiste exactamente)
- Hero título: "ANTES" → "DESPUÉS"
- Hero subtítulo: "ANTES" → "DESPUÉS"
- Step 1: "ANTES" → "DESPUÉS"
- …

### TODOs dejados para Isaac
- línea N: "..."

### Bugs encontrados
…

### Riesgos detectados
…

### Validaciones (9 PASS/FAIL)
…

### Recomendación al arquitecto maestro
…
```

## Cómo empezar

1. `git checkout master && git pull && git checkout -b etapa-14.5-cleanup-pendiente`.
2. Lee `jugador.html` brevemente (solo para confirmar que es eliminable).
3. Lee `admin.html` (parte de KPIs y tabs — identifica qué quitar).
4. Lee `index.html` completo (es donde más vas a editar).
5. Sirve local con `python -m http.server 8000` para validar visualmente.
6. Trabaja Parte A → Parte B → Parte C (commits separados).
7. Reporta y push.
