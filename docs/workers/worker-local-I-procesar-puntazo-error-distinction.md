# Worker Local I — Hot-patch: distinguir "RTSP 404 / fuera de ventana" vs "TCP timeout" en procesar_puntazo

> Worker de **implementación** corriendo dentro de la NUC (BreakPoint, y
> eventualmente WellStreet cuando esa NUC esté lista). Path: `c:\Puntazo\runner\`.
> NO trabaja sobre el repo web. Coordinado por el chat maestro.
>
> **Branch base**: `master` local del repo NUC.

## Objetivo

Cerrar el bug residual reportado por Worker D ("worker-local-D-pulse-resilience.md"
sección Bugs encontrados):

> Severidad: media — `script.py:procesar_puntazo` clasifica
> `download_clip_ffmpeg` falla como `(False, "connection")` → reintento eterno
> con backoff de 10 min, sin estado terminal. Si la NUC procesa un pulso cuyo
> NVR-window expiró entre el momento del consume y el momento del worker,
> queda en loop infinito. La fix R6 ataja la mayoría de casos en el listener,
> pero no este escenario residual (consume reciente, worker tarda > 7 días).

Esta etapa parchea `procesar_puntazo` para que distinga:

- **TCP timeout / conexión perdida** → sigue siendo `"connection"` (recuperable, reintento).
- **RTSP 404 / rango no disponible** (NVR confirmó que ese segmento ya no existe) →
  pasa a **STATE_ERROR** con `error_reason="nvr_window_exceeded_late"`.

Esto evita el loop infinito de pulsos viejos cuyo NVR-window expiró
después del consume (lo que el R6 listener no podía pre-detectar porque
en ese momento el consume era reciente).

## Contexto que ya sabemos

### Estado del listener R6 (post-Worker D)

- Pre-tx check de NVR-window en `_handle_pending_pulse` (`script.py:2007-2049`):
  si `event_at` < (Date.now() - NVR_RETENTION_DAYS), cierra el doc con
  `error_reason="nvr_window_exceeded"` SIN intentar procesar.
- `NVR_RETENTION_DAYS = 7` como conservador para BreakPoint.

### El caso residual que falta cubrir

Worker D explicó:

> Recomendación al maestro: hot-patch para distinguir "RTSP 404 / rango inválido"
> de "TCP timeout" y marcar STATE_ERROR con detalle `nvr_window_exceeded_late`.

Escenario concreto:
1. T=0: user pide pulso recovery con `event_at=T-3 días`.
2. T=0: listener evalúa NVR-window: `3 días < 7 días → OK, procesa`.
3. T=0: doc se marca `consumed_at`, se añade a la cola del worker.
4. T+5 días: worker llega al pulso (porque la cola estaba larga / NUC estuvo offline,
   etc.). Ahora `event_at` es de hace 8 días, fuera del retention de 7 días.
5. `download_clip_ffmpeg` falla porque el NVR ya no tiene ese segmento.
6. Hoy: clasifica como `"connection"` → reintenta cada 10 min para siempre.

Lo correcto: cuando el NVR confirma "ese rango no está disponible" (típicamente
con un HTTP 404 / RTSP error específico), marcar el pulso con
`error_reason="nvr_window_exceeded_late"` y NO reintentar.

## Arquitectura relevante

- **Lenguaje**: Python.
- **Función afectada**: `procesar_puntazo` en `script.py`. Probablemente
  llama a `download_clip_ffmpeg` (función helper).
- **NVR**: Hikvision. Sus respuestas típicas para "rango no disponible":
  - HTTP 404 en endpoint ISAPI.
  - RTSP `404 Stream Not Found`.
  - RTSP `416 Range Not Satisfiable`.
  - Algunos modelos: `400 Bad Request` con body que menciona "no recording for this time".
  Es decir, **no hay un único error code**. Worker debe identificar 1-2 patrones
  más comunes y agruparlos como "fuera de ventana".

## Archivos importantes a revisar

- `script.py` función `procesar_puntazo` y `download_clip_ffmpeg`.
- Logs históricos de la NUC para identificar qué error específico devuelve
  el Hikvision cuando el rango no está disponible (si hay alguno reciente).

## Alcance

1. **Auditar** `download_clip_ffmpeg` y entender cómo distingue hoy errores
   recuperables vs terminales (probablemente todo cae a "connection").

2. **Inspeccionar respuesta RTSP/HTTP** del Hikvision cuando intenta cortar
   un segmento fuera de retention. Modos:
   - Si usa RTSP directo: parsear el código de error (404/416).
   - Si usa ffmpeg con URL HTTP del NVR: capturar el exit code + stderr
     y buscar patrones tipo `"404 Not Found"`, `"416 Range Not Satisfiable"`,
     `"No recording found"`.

3. **Modificar la clasificación de errores**:
   ```python
   def classify_download_error(stderr_text, exit_code, http_status=None):
       # Patrones que indican "rango no disponible" → terminal con error_reason
       NVR_GONE_PATTERNS = [
           "404 not found",
           "416 range not satisfiable",
           "no recording for this time",
           "stream not found",
           # agregar otros patrones que descubras en logs reales
       ]
       t = (stderr_text or "").lower()
       if http_status in (404, 416):
           return ("terminal", "nvr_window_exceeded_late")
       for p in NVR_GONE_PATTERNS:
           if p in t:
               return ("terminal", "nvr_window_exceeded_late")
       # Default: connection (recuperable)
       return ("connection", None)
   ```

4. **Aplicar a `procesar_puntazo`**:
   - Si `classify_download_error` retorna `("terminal", reason)`:
     - Marcar el doc `pending_pulses/{id}` con
       `consumed_at` (si todavía es null) + `error_reason=reason`.
     - NO reintentar. Quitar de la cola.
     - Log INFO con doc_id + razón.
   - Si retorna `("connection", None)`:
     - Comportamiento actual: reintento con backoff.

5. **Heartbeat**: ya existe `pendingQueue` que cuenta no-terminales. Sin
   cambios necesarios — los pulsos cerrados con error_reason quedan
   terminales y dejan de contar en pendingQueue.

## Fuera de alcance

- Re-procesar manualmente pulsos que hoy están en loop infinito. Si hay
  alguno colgado, listar en el reporte y dejarlo al maestro para decidir
  si se cierran manual con script aparte (no parte de este worker).
- Cambios al listener R6 — el listener pre-tx ya cubre el caso normal,
  este worker solo cubre el escenario residual donde el worker llega tarde.
- Cambios al pipeline post-procesamiento (subida Dropbox, gestion_indice, etc.).

## Riesgos

- **Falso positivo**: si clasificamos un TCP timeout transitorio como
  `nvr_window_exceeded_late`, el pulso se cierra mal y no se reintenta.
  Mitigación: ser conservador en `NVR_GONE_PATTERNS`. Solo agregar patrones
  que estés 100% seguro indican "definitivamente no hay grabación", no
  "el NVR no responde ahora".

- **Logs antiguos no muestran el error exacto**: si no hay registros recientes
  de pulsos viejos que fallaron, hay que provocar el escenario para
  observar la respuesta real. Idea: en testing, intentar descargar un
  segmento de hace 30 días (fuera del retention real) y capturar stderr.

- **Hikvision cambia formato de error con firmware**: no podemos asumir
  que el patrón es estable. Documentar versión del firmware testeado en
  el reporte. Si hay actualización futura, este código puede necesitar revisión.

## Validaciones

Cada item ✅ ❌ o ⏭️ con razón:

1. **Audit de logs**: hay al menos 1 caso real donde el worker entró en
   loop infinito por NVR-window-late post-consume. Reportar SHA del log
   y patrón observado en stderr.

2. **Test forzado con timestamp viejo**: provocar manualmente con un doc
   `pending_pulses` que tenga `event_at = NOW - 30 días`, observar
   stderr de ffmpeg / RTSP response, identificar patrón.

3. **Test del clasificador unitario**: alimentar `classify_download_error`
   con 5 ejemplos (404, 416, "no recording", TCP timeout, RTSP TCP reset)
   y verificar que retorna lo esperado.

4. **End-to-end terminal**: meter un doc con event_at fuera de ventana
   que el listener pre-check NO atrapó (porque NVR_RETENTION_DAYS está
   sobre-configurado a 30, por ejemplo, simulado). Verificar que el worker
   lo procesa, falla, y CIERRA con `error_reason=nvr_window_exceeded_late`.
   NO reintenta.

5. **End-to-end transitorio**: simular un timeout TCP (apagando temporalmente
   el NVR durante la descarga). Verificar que SE COMPORTA COMO HOY: reintento
   con backoff, NO marca terminal.

6. **No regresión clip normal**: una sesión de pulsos normales (rango
   reciente, NVR online) procesa correcto y sube a Dropbox.

7. **Pulsos viejos colgados**: listar en el reporte cuántos docs hay hoy
   en `pending_pulses` con `consumed_at != null` y antigüedad > 24h sin
   resolución (probablemente colgados por este bug). El maestro decide
   si los cierra manualmente o los deja a que el siguiente arranque los
   re-evalúe y los marque terminal con la nueva lógica.

## Definition of done

- `classify_download_error` (o equivalente) implementado y testeado.
- `procesar_puntazo` usa la clasificación nueva: terminal marca error_reason,
  connection sigue reintentando como hoy.
- Validaciones 1-7 documentadas.
- Branch `worker-local-I-procesar-puntazo-error-distinction` con commit SHA.
- Reporte en formato `docs/workers/README.md`.

## Cambios coordinados que pide a la web

Mínimos. La web ya mapea `error_reason` a copy amigable desde F129:
- `nvr_window_exceeded` → "Ese video ya no está disponible — pasó más tiempo
  del que el sistema guarda."
- Nuevo `nvr_window_exceeded_late` → **mismo mapeo** (es la misma causa real
  desde la perspectiva del user, solo cambia cuándo se detectó).

Acción: agregar `nvr_window_exceeded_late` al map en
`assets/heartbeat-watcher.js` `errorReasonText()`. 1-line change. El
maestro web lo hace cuando reciba este reporte (o ya puedes pedir
en el bloque "Cambios coordinados").

## Formato del reporte de regreso

Ver `docs/workers/README.md`. Sí o sí incluir:
- Patrón(es) RTSP/HTTP observados para "rango no disponible" en el Hikvision
  específico (modelo + firmware).
- Lista de pulsos colgados hoy (si los hay).
- Bloque "Cambios coordinados que pide a la web" con el 1-line del map.

---

**Referencias rápidas**:

- Worker D R6 (etapa hermana): `worker-local-D-pulse-resilience.md`.
- F129 web R6-companion: commit `49554bb48` (banner + errorReasonText).
- Repo web (solo lectura desde NUC):
  https://github.com/isaacsaltiel/puntazo_web_v2
