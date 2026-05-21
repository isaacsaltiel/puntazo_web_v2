# Etapa 8C — Botón digital "Pedir clip ahora" en `mi-partido.html`

## Objetivo

Reemplazar el placeholder deshabilitado "Pedir clip ahora" en `mi-partido.html` (entregado por Etapa 4) por un **botón funcional** que dispare la captura de un clip via el mismo mecanismo digital que ya usa `boton.html` (Google Apps Script → CSV en Google Drive → lectura por el sistema Python local del club).

**Punto clave de arquitectura**: el clip generado se asociará automáticamente al partido active **por ventana temporal** (decisión de Etapa 3). No se necesita pasar `matchId` al pipeline. El polling vivo de Etapa 5 (`findClipsForMatch` cada 20s) lo recogerá solo.

**Resultado para Isaac**: desbloquea generación de clips desde su celular sin tocar el sistema local del club, durante cualquier partido activo. Permite probar el flujo end-to-end (incluyendo el contador en vivo, el filtro de lado.html, y el futuro resumen.html de Etapa 6) con clips reales.

## Contexto

Después de Etapa 5, el flujo del jugador está conectado pero **hueco**: no hay forma de generar clips desde la web. El botón físico Arduino en cancha sí funciona, pero requiere acceso físico al hardware del club. Para iteración y testing remoto, Isaac necesita poder pulsar "clip ahora" desde su celular.

`boton.html` ya implementa exactamente este mecanismo digital, pero como página standalone (selector de club + cancha + botón grande, sin contexto de partido). El usuario lo usa cuando NO está en un partido formal. Hoy llama a un Google Apps Script que escribe a un CSV en Google Drive; el sistema Python local del club sincroniza el CSV y dispara el mismo job que el Arduino físico.

Esta etapa **no crea infraestructura nueva** — solo agrega un punto de entrada al mecanismo existente desde dentro del flujo de partidos. El sistema Python local **NO se toca**.

## Arquitectura relevante

**Flujo digital ya existente (vía `boton.html`):**

```
boton.html (cualquier celular)
   ↓ fetch(APPS_URL + '?action=save&club=X&cancha=Y', { redirect:'follow' })
Google Apps Script (deployed)
   ↓ escribe fila en Google Sheet/CSV
G:\Mi unidad\BP_Puntazo\... (sync de Google Drive en PC del club)
   ↓ archivo CSV detectado por el watcher
core/sources/button_csv.py (sistema Python local)
   ↓ dispara mismo job que Arduino
RTSP playback del NVR → FFmpeg con logos → rclone a Dropbox →
GitHub Actions workflow → videos_recientes.json actualizado
```

**Lo que Etapa 5 ya hace**: `mi-partido.html` polea `findClipsForMatch` cada 20s. Cualquier clip nuevo en `videos_recientes.json` que caiga dentro de la ventana del partido activo aparecerá en el contador "🎬 N clips capturados" sin acción extra.

**Lo que Etapa 8C añade**: el botón funcional. La cadena entera ya funciona — solo le pegamos un nuevo punto de entrada en `mi-partido.html`.

**Time-of-flight observado**: desde el click hasta que el clip aparece en `videos_recientes.json` puede tardar **30-90 segundos** (Google Drive sync + procesamiento FFmpeg + workflow GitHub). El usuario debe ver feedback inmediato del click + un mensaje claro de que el clip aparecerá pronto.

## Archivos importantes (lee antes de empezar)

| Archivo | Por qué |
|---|---|
| [docs/workers/README.md](README.md) | Convención. **Tu branch base es `rediseno-jugador`** (no master). |
| [docs/workers/etapa-08c-boton-digital.md](etapa-08c-boton-digital.md) | Este brief. |
| [boton.html](../../boton.html) | **Lectura crítica**: copia el patrón del `$bigBtn.addEventListener('click', ...)` (busca "CLICK PRINCIPAL"), la lógica de cooldown, el manejo de `data.ok / data.error`, vibe(), feedback visual. La constante `APPS_URL` se define al inicio del IIFE del script — léela y copia el valor exacto. |
| [mi-partido.html](../../mi-partido.html) | El único archivo que modificas. Identifica el placeholder actual de "Pedir clip ahora" (creado en Etapa 4, deshabilitado). |
| [docs/matches-schema.md](../matches-schema.md) | Recordatorio del modelo: asociación clip↔match es por ventana temporal. NO pases matchId al APPS_URL. |
| [assets/matches.js](../../assets/matches.js) | Solo para confirmar shape de `match.loc`, `match.can` (los necesitas para el fetch). |

## Alcance

### Único deliverable: modificar `mi-partido.html`

1. **Reemplazar el placeholder** "Pedir clip ahora" (deshabilitado, con texto "próximamente — usa el botón físico de la cancha por ahora") por un **botón funcional habilitado**, visible SOLO cuando `match.status === "active"`.

2. **Lógica del click**:
   - Reusar el patrón de `boton.html` (`$bigBtn.addEventListener('click', ...)`):
     - Estado `idle / loading / success / error` (puedes simplificar; mínimo loading + success + error con feedback visual claro).
     - `fetch(APPS_URL + '?action=save&club=' + encodeURIComponent(match.loc) + '&cancha=' + encodeURIComponent(match.can), { redirect:'follow' })`
     - Parsear `data.ok / data.error` igual que boton.html.
     - **NO mandar `matchId` ni `lado`** al Apps Script — no son parámetros que el endpoint espere (verifica con boton.html que solo manda `club` y `cancha`).
   - **Cooldown**: bloquear el botón ~5 segundos tras un click exitoso para evitar spam (boton.html usa 4s, similar es bien).
   - **Feedback inmediato**: el click debe sentirse instantáneo (cambiar estado visual antes del fetch). Vibración opcional (puedes copiar `vibe([40,60,40])` de boton.html si quieres).
   - **Mensaje post-éxito**: bajo el botón o como toast: "✅ Puntazo guardado. Aparecerá en el contador en ~60 segundos."
   - **Manejo de error**: si el fetch falla o `data.ok === false`, mostrar mensaje rojo: "No se pudo guardar el clip. Intenta de nuevo." Permitir reintentar inmediatamente (sin cooldown en caso de error).

3. **`APPS_URL`**: copia el valor EXACTO de boton.html. No inventes una URL nueva. No modifiques el Apps Script.

4. **Visibilidad**:
   - Si `match.status === "active"`: botón habilitado.
   - Si `match.status === "ended"` o `"cancelled"`: oculto o reemplazado por nada (el partido terminó, no tiene sentido pedir clips).

5. **Coordinación con el contador de clips (Etapa 5)**:
   - Tras un click exitoso, **puedes opcionalmente** disparar un poll inmediato adicional del contador (`pollClipsOnce()` o equivalente — busca el nombre real en mi-partido.html) tras ~30s y ~60s para acelerar feedback visual.
   - Si esto requiere refactorizar más de 10 líneas existentes, NO lo hagas — déjalo natural al ciclo de 20s.

## Fuera de alcance

NO hacer:

- Tocar `boton.html` (sigue funcionando como está, página standalone).
- Tocar el sistema Python local del club (`Puntazo-release - copia/`).
- Tocar el Google Apps Script.
- Tocar `assets/script.js`, `reactions.js`, `card.js`, `auth.js`, `firebase-core.js`, `matches.js`, `header.js`, `estilo.css`.
- Tocar cualquier HTML que no sea `mi-partido.html`.
- Cambiar la lógica de asociación clip↔match (sigue siendo ventana temporal, NO mandar matchId al Apps Script).
- Agregar el botón a `entrada.html`, `lado.html` u otras páginas.
- Crear `resumen.html` (Etapa 6).
- Implementar reintentos automáticos, queue de clicks, almacenamiento offline.
- Cambiar el tiempo del cooldown a algo distinto de ~5s sin razón.

Si descubres algo fuera de scope que parezca crítico, anótalo en "Recomendación al maestro".

## Riesgos

1. **CORS desde puntazoclips.com**: `boton.html` ya llama al Apps Script desde el mismo dominio. Si copia el patrón exacto en mi-partido.html, debería funcionar sin issues. Pero si pruebas desde `http://localhost:8080` puede haber CORS issues. Mitigación: el Apps Script DEBE estar configurado con `setAccessControlAllowOrigin('*')` o similar (boton.html ya lo prueba en local). Si CORS falla en local pero funciona en producción, está OK — reportar y seguir.

2. **APPS_URL contiene secretos**: la URL del Apps Script es semi-pública (cualquiera con el link puede invocar). NO la commitees como variable nueva — copia el valor que ya está en `boton.html` (ya está en el repo público, mismo nivel de exposición).

3. **Cancha que no existe en el config del Apps Script**: si el `match.loc` o `match.can` no están registrados en la config server-side del Apps Script, devuelve error. Mostrar el error tal cual al usuario ("No se pudo guardar: <error>"). No es bloqueante.

4. **Doble click no bloqueado**: si el cooldown se implementa solo con CSS `disabled` y el JS no chequea un flag interno, un click rápido puede pasar dos requests. Usar un flag `busy = true` durante el ciclo (boton.html lo hace así).

5. **El status del match puede cambiar durante el botón**: si el user clickeó "Terminar partido" y mientras tanto otra pestaña hizo el cancel, el botón podría enviar clip a un partido inactivo. Aceptable: el clip se sube de todos modos (cae a la cancha como clip suelto), no rompe nada. No mitigar.

6. **Polling del contador NO se acelera si solo Etapa 5 polling natural**: tras 1 click, el clip aparece ~30-90s después. El contador puede tardar hasta otros 20s en mostrarlo (próximo tick del polling). Total: hasta ~110s de delay percibido. Aceptable con el mensaje "aparecerá en ~60 segundos" que ya pide el alcance.

## Validaciones

`python -m http.server 8080`. Login Google con tu cuenta. Idealmente en un club real (`BreakPoint`, `Interpadel`, etc.) donde sí haya canchas registradas en el Apps Script.

Reportar status (✅/❌/⏭️) + output observado:

1. **Botón visible y habilitado** en partido active: crear match en cancha real → mi-partido.html muestra botón "🎯 Pedir clip ahora" (o nombre similar) habilitado, NO el placeholder deshabilitado.
2. **Click → spinner → success**: click → cambio inmediato a estado loading → tras ~1-3s ves "✅ Puntazo guardado. Aparecerá en el contador en ~60 segundos."
3. **Cooldown post-success**: ~5s tras success, el botón está deshabilitado/atenuado. Un click extra en ese intervalo no dispara nada. Después de ~5s vuelve a activarse.
4. **Click error path**: si el Apps Script falla (probarlo con cancha inválida, ej. modificar manualmente la URL en DevTools antes de click), ves mensaje rojo "No se pudo guardar el clip. Intenta de nuevo." y el botón se reactiva inmediatamente para reintentar.
5. **Contador refleja el clip nuevo**: tras success real, espera 60-90s y verifica que el contador "🎬 N clips capturados" sube +1 (o N corresponde a los clips reales en la ventana). Si tienes el sistema local andando, debería pasar; si no, marca ⏭️ con razón.
6. **Botón oculto/deshabilitado** cuando status !== active: terminar el partido → la pantalla cambia a estado "ended" (Etapa 5) → el botón "Pedir clip ahora" desaparece o queda deshabilitado.
7. **Doble click rápido bloqueado**: hacer 2 clicks en <1s, solo 1 request sale (verificar en DevTools Network).
8. **Mobile responsive**: en DevTools iPhone SE (375×667), botón tappable (mínimo 44px alto), feedback visual claro.
9. **Filtro lado.html refleja el clip**: tras terminar el partido y abrir `lado.html?...&matchId=X`, el banner debe decir "N de M" con N >= 1 (el clip nuevo) si el clip ya cayó dentro de la ventana del partido.
10. **Sin errores nuevos en consola JS**: DevTools → Console limpia.

## Definition of Done

- [ ] `mi-partido.html` modificada: placeholder reemplazado por botón funcional con cooldown, feedback visual, manejo de error.
- [ ] `APPS_URL` copiada de `boton.html` (mismo valor exacto).
- [ ] Botón solo visible/habilitado cuando `match.status === "active"`.
- [ ] Las 10 validaciones ejecutadas y reportadas.
- [ ] Branch `etapa-08c-boton-digital` creada **desde `rediseno-jugador`**, commits limpios, pusheada.
- [ ] **NO** mergeada a `rediseno-jugador` ni a `master`.
- [ ] Cero modificaciones a otros archivos (especialmente NO `boton.html`).
- [ ] Diff esperado: solo `mi-partido.html`, ~50-100 líneas net positivo.

## Formato del reporte de regreso

Del template en [docs/workers/README.md](README.md). Llenar cada sección.
