# Etapa 4.5 — Hot-patch: borrar dead code del Top-3 badge en `lado.html`

## Objetivo

Borrar completamente el dead code del feature "Top-3 badge del mes" en `lado.html`. El script estaba truncado en producción (nunca funcionó por SyntaxError silencioso). El worker de Etapa 4 (`dc745d7`) dejó un cierre sintáctico inerte sin invocar `buildTop3()`. **Decisión del owner (Isaac, 2026-05-20)**: borrar el bloque entero, alineado con el plan de pausar reacciones / "mejores del mes" en Etapa 9. No rescatar el feature.

## Contexto

Puntazo (puntazoclips.com) es una plataforma de clips de pádel. La página `lado.html` muestra los clips de las últimas 24h de una cámara específica. Antes de Etapa 4, esta página tenía un `<script>` que pretendía decorar las cards de video más reaccionadas del mes con un badge "Top 1 / Top 2 / Top 3". Ese script estaba truncado en algún momento (alguien copy-pasteó mal o un commit anterior se perdió a medias) y nunca ejecutó en producción: el navegador implícitamente cerraba el `<script>` y el resto del DOM al encontrar EOF.

Cambios recientes:
- En Etapa 4 (commit `dc745d7`, mergeado a `rediseno-jugador` como `d5faaa0`), el worker cerró el bloque sintácticamente con una nota explícita, sin invocar `buildTop3()`. Eso preserva el comportamiento previo ("no aparece"), pero deja basura.
- Esta etapa 4.5 elimina la basura por completo.

## Arquitectura relevante

`lado.html` tiene varias secciones de `<script>` y `<style>` inline. Las que importan para esta etapa:

- **`<style>` global** al principio del file (después del `<head>`): contiene **todas** las reglas CSS de la página, incluyendo (en algún punto) las clases del badge Top-3.
- **`<script>` del Top-3 badge**: vive entre el script de "performance patches" y el script del **banner CTA de Etapa 4** (al final del body). Empieza con un `<script>` que define una IIFE `(function () { ... })();` cuya función interna se llama `buildTop3` y lee `reactions/...` de Firestore para decorar cards. Termina con el comentario:

  ```
  /* NOTE WORKER#2 (Etapa 4): archivo truncado en producción; cierre mínimo
     SIN invocar buildTop3() para preservar el comportamiento inerte previo. */
  '';
  });
  }
  });
  })();
  </script>
  ```

  Ese es el cierre que dejó el worker de Etapa 4. **Borra el `<script>` completo, desde su `<script>` de apertura hasta el `</script>` que añadió el worker.**

- **`<script>` del banner CTA de Etapa 4**: viene DESPUÉS del Top-3, está envuelto en `<!-- ── Banner CTA de partido (Etapa 4) — IIFE defensiva ... -->` y contiene `getActiveForUser`, `renderContinuar`, `renderIniciar`. **NO TOCAR este bloque.**

## Archivos importantes

| Archivo | Por qué |
|---|---|
| [docs/workers/README.md](README.md) | Convención del modelo, formato de reporte. Tu branch base es `rediseno-jugador`. |
| [docs/workers/etapa-04.5-borrar-top3.md](etapa-04.5-borrar-top3.md) | Este brief. |
| [lado.html](../../lado.html) | El único archivo que modificas. |

NO leer/modificar nada más en este brief — scope cerrado a un solo archivo.

## Alcance

### Acciones

1. **Identificar el `<script>` del Top-3** en `lado.html`:
   - Búsqueda inicial: grep por `buildTop3`, `pz-top-month-badge`, `Top 1`, `'<small>Top '`, o el comentario `NOTE WORKER#2 (Etapa 4): archivo truncado en producción`.
   - Confirma los límites EXACTOS del bloque: la línea `<script>` que lo abre y el `</script>` que lo cierra (cierre añadido por Etapa 4).
   - **Borra el bloque completo `<script>...</script>`** (incluye comentarios HTML/JS adyacentes si solo aplicaban a este script).

2. **Borrar el CSS del badge**:
   - En el `<style>` global de `lado.html`, busca selectores `.pz-top-month-badge`, `.pz-top-month-badge.rank-1`, `.pz-top-month-badge.rank-2`, `.pz-top-month-badge.rank-3` (o variantes equivalentes con `&.rank-N` si usan SCSS-like inline — no debería).
   - Borra **todas las reglas CSS asociadas exclusivamente al Top-3 badge**.
   - Si alguna regla CSS está compartida con otro feature (improbable, pero verificar) — **no la borres**, solo la parte exclusiva del Top-3.

3. **Confirmar que no quedan referencias colgantes**:
   - Tras borrar, `grep -n "pz-top-month-badge\|buildTop3" lado.html` debe devolver 0 matches.
   - `grep -rn "pz-top-month-badge\|buildTop3"` en todo el repo (no solo lado.html): reportar resultados. Si hay matches en otros archivos (`clip.html`, `mejores.html`, `assets/*.js`, etc.), **NO los borres** en esta etapa — anótalos en "Recomendación al maestro" como follow-up. Esta etapa es solo `lado.html`.

### Restricciones

- **Una sola rama, un solo archivo modificado**.
- Diff esperado: **net negativo** (mucho más `-` que `+`). El único `+` aceptable es si necesitas reformatear una línea adyacente porque el borrado dejó algo raro (idealmente cero `+`).
- **NO tocar el banner CTA de Etapa 4** (es el `<script>` que viene después del Top-3).
- **NO tocar el script de performance patches** (otro `<script>` que viene antes del Top-3, busca por `console.warn` o similar para identificarlo).
- **NO tocar la lógica de display de clips, reactions, claim, share, gate** — nada de lo que ya funcionaba.

## Fuera de alcance

- Borrar el badge Top-3 de otros archivos (si está en `clip.html`, `mejores.html`, otros) — anotar como recomendación, NO ejecutar.
- Eliminar la sección "mejores del mes" del nav o `mejores.html` — eso es Etapa 9.
- Cualquier feature change (eliminar reacciones/comentarios UI, etc.) — eso es Etapa 9.
- Refactor de CSS o JS general.
- Cualquier modificación a `entrada.html`, `mi-partido.html`, `assets/matches.js` u otros archivos.

## Riesgos

1. **Borrar de más**: el `<style>` y el `<script>` pueden estar entreverados con otros bloques. Lee con cuidado y confirma que cada línea borrada pertenece exclusivamente al Top-3 badge.
2. **Romper sintaxis de `<script>` adyacentes**: si el borrado deja un `<script>` huérfano (sin cierre) o pega dos scripts, la página rompe. Usa `node --check` o `new Function()` sobre cada bloque tras el cambio.
3. **Borrar el cierre del banner CTA por error**: el banner CTA viene justo después del Top-3. Confirma que el `</script>` que cierra el Top-3 es el del worker de Etapa 4, no el del banner.

## Validaciones

1. **Parse limpio**: `node --check` (o `new Function(...)`) sobre cada `<script>` inline restante en `lado.html` → todos parsean sin error.
2. **HTTP 200**: `python -m http.server 8080` desde la raíz; `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/lado.html` → `200`.
3. **Ausencia de basura**: `grep -n "pz-top-month-badge\|buildTop3" lado.html` → 0 matches.
4. **No regresión funcional** (en navegador real, capturable como screenshot o log):
   - `http://localhost:8080/lado.html?loc=Puntazo&can=CanchaX&lado=LadoA` carga.
   - Los clips se muestran (si hay clips recientes en esa cancha) o el mensaje vacío correspondiente.
   - Reacciones, claim "Soy yo", share funcionan visualmente.
   - El banner CTA de Etapa 4 funciona: sin sesión no aparece; con sesión + match activo en esa cancha aparece "Continuar →"; con sesión sin match aparece "Iniciar partido".
   - Consola del navegador: sin errores JS nuevos.
5. **Diff sano**: `git diff --stat rediseno-jugador..HEAD` muestra un solo archivo modificado (`lado.html`), net negativo (más borrados que insertados).
6. **Repo-wide grep**: `grep -rn "pz-top-month-badge\|buildTop3"` desde la raíz del repo → reportar todos los matches. Si hay en otros archivos, listarlos para el maestro.

## Definition of Done

- [ ] `<script>` del Top-3 borrado en `lado.html`.
- [ ] CSS asociado al `.pz-top-month-badge` borrado en `lado.html`.
- [ ] Validaciones 1-6 ejecutadas y reportadas.
- [ ] Branch `etapa-04.5-borrar-top3` creada **desde `rediseno-jugador`**, commits limpios, pusheada a GitHub.
- [ ] NO mergeada.
- [ ] Cero modificaciones a archivos fuera de `lado.html`.
- [ ] Diff con `rediseno-jugador` es net negativo.

## Formato del reporte de regreso

Estándar de [docs/workers/README.md](README.md). Incluir:

- Las líneas exactas borradas (rangos `-N..-M`).
- La salida de `git diff --stat`.
- La salida del repo-wide grep paso 6.
