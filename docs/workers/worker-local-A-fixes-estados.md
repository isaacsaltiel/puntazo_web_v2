# Worker Local A — Fixes críticos (P1/P2/P11) + instrumentación de estados local (R1)

> Worker de **implementación** corriendo vía Claude Code DENTRO de una PC real
> de club (BreakPoint), sobre el sistema local de Puntazo en `C:\Puntazo\runner\`.
> NO trabaja sobre el repositorio web. Es la implementación de la Fase 1 del
> rollout (R1) diseñado por el agente de auditoría. Coordinado por el chat maestro.

## Objetivo

Implementar **R1**: cerrar los 3 bugs críticos del sistema local e instrumentar el ciclo de vida del clip con un campo de estado — **todo en disco local, SIN Firestore** (la publicación a Firestore es Worker B, una fase posterior).

Los 3 bugs (confirmados en una auditoría previa de 2 fases):

- **P1** — un pulso de teclado/botón vive solo en memoria RAM durante ~10 segundos (el timer de encadenado) antes de tocar disco. Crash o corte de luz en esos 10s = pulso perdido para siempre. Medido en vivo: ventana de 10 segundos exactos sin persistencia.
- **P2** — si el NVR no responde en el instante del pulso, `handle_keypress()` descarta el pulso sin guardarlo en ningún lado.
- **P11** — `watchdog.py` identifica la ventana del runner por coincidencia de **subcadena** case-insensitive de `"puntazo"`; cualquier ventana con esa palabra en el título (VS Code, Explorador) puede recibir un `taskkill /F /T`.

Los tres violan la **regla de oro del producto: NUNCA PERDER EL PULSO.** El NVR graba 24/7, así que el video siempre es recuperable; lo irrecuperable es el pulso. Si se guarda `club + cancha + lado + timestamp + estado`, el clip se puede recuperar después aunque el procesamiento falle en el momento.

## Contexto del sistema (de la auditoría previa)

Puntazo (puntazoclips.com) es una plataforma de clips de pádel. Esta PC, dentro del club, escucha pulsos (botón físico vía Arduino, o teclas 1-8 del teclado), recupera ~60s de video del NVR, los procesa con FFmpeg, los sube a Dropbox y dispara un workflow de GitHub que regenera los índices de la web.

Lo que la auditoría estableció (verifica al inspeccionar — puede haber cambiado):

- Instalación en `C:\Puntazo\runner\`. Entry point `script.py` (~2559 líneas, monolítico, Python 3.14 de usuario en `%LOCALAPPDATA%\Python\`). Supervisor `watchdog.py`. Arranque vía `run_forever.bat` (loop de reinicio) lanzado por `AUTO_START_PUNTAZO.bat`.
- `STOP.flag` — si existe, nadie arranca el runner (kill switch). Hoy el sistema está detenido a propósito (STOP.flag presente).
- `queue\puntazo_local_queue.csv` — cola persistente, ~17 columnas, única fuente de verdad en disco. Estados actuales: solo `PENDING / DONE / DISCARDED`.
- Hilos que levanta `script.py`: worker (pipeline), heartbeat, cleanup, arduino-reset, scheduler, serial (si modo serial), y el loop principal de teclado.
- Flujo del pulso: `handle_keypress()` → `register_press()` (guarda en el dict `PENDING` en RAM + arma un `threading.Timer` de 10s para encadenar pulsos cercanos) → al vencer el timer, `_finalize_chain` → `_persist_and_enqueue` → `queue_add_pending()` **escribe la fila en el CSV**. O sea: **el pulso solo toca disco al cerrar la cadena de 10s** (ahí está P1).
- `procesar_puntazo()`: espera 20s, verifica NVR, descarga RTSP playback, FFmpeg (amplify+logos → outro → web-compat), `rclone copy` a Dropbox, `github_dispatch_index()`.
- `queue_on_failure()` reintenta con backoff; al 5º intento → `DISCARDED`.
- Funciones de cola relevantes: `ensure_queue_csv()` (hace migración suave de columnas nuevas), `_write_queue_rows()` (reescribe el CSV COMPLETO bajo `QUEUE_CSV_LOCK`), `queue_add_pending()`, `queue_mark_done()`, `queue_on_failure()`.
- Ciclo medido punta a punta: pulso EN VIVO → visible ~7 min.

**Tienes acceso al diseño completo**: el agente de auditoría produjo en su Fase 3 un documento de diseño detallado. Este brief implementa la parte R1 de ese diseño. Si necesitas el detalle de una decisión, pídeselo a Isaac (él tiene el documento de Fase 3). Pero este brief es autosuficiente para R1.

## PROTOCOLO DE SEGURIDAD (inviolable — esto es producción sin control de versiones)

El sistema local **no está bajo control de versiones** y es producción. Antes de tocar una sola línea:

1. **Paso 0 — `git init`**: inicializa un repo git en `C:\Puntazo\runner\`. Crea un `.gitignore` que EXCLUYA: `queue/`, `logs/`, `media/`, `exportados/`, `__pycache__/`, `*.pt` (modelos), `pulses.log`, `secrets/`, `heartbeat.txt`, `script.pid`, `*.lock`, `STOP.flag`, `cleanup_last_run.txt`, `watchdog_state.json`. Debe quedar versionado SOLO el código (`*.py`, `*.bat`, `src/`, `txt/`, el `.gitignore`). Haz un commit baseline: "baseline pre-Worker-A". Esto es tu red de seguridad real.
2. **Backups adicionales**: además del git, copia `script.py` y `watchdog.py` a `script.py.bak-AAAAMMDD` y `watchdog.py.bak-AAAAMMDD` antes de editarlos.
3. **Sistema detenido durante las ediciones**: confirma que `STOP.flag` existe (sistema parado) mientras editas. NO edites con el runner corriendo.
4. **Watchdog**: el watchdog puede matar ventanas (bug P11). Si tu ventana de VS Code/terminal contiene "puntazo" en el título, detén el proceso `pythonw` del watchdog mientras trabajas (con OK de Isaac) y reláncalo al final — igual que hizo el agente de Fase 2.
5. **Trabajo incremental**: implementa y valida pieza por pieza. No hagas todos los cambios y pruebes al final.
6. **Isaac está físicamente en la PC contigo.** Cualquier acción con efecto (arrancar el runner, simular un pulso, detener procesos): explícala y pide OK antes.
7. **Si algo se rompe**: revierte desde git (`git checkout -- script.py`) o desde el `.bak`. No improvises sobre un sistema roto.
8. **No `git push`** (el repo local que creas es solo local, no tiene remoto — y no le pongas uno).
9. **Secretos**: el `script.py` tiene credenciales del NVR en texto plano (~línea 71-72) y usa un PAT de GitHub desde la variable de entorno `PAT_GITHUB`. NO los imprimas completos, no los muevas, no los toques en este worker (su limpieza es otro tema).

## Alcance R1 — qué implementar

### 1. `pulses.log` — ledger append-only a prueba de crash (cierra P1)

- Nuevo archivo `C:\Puntazo\runner\queue\pulses.log`.
- En `register_press()`, **lo PRIMERO que pasa** al detectar un pulso — antes de tocar el dict `PENDING` o armar el timer — es escribir una línea JSON al `pulses.log` con `flush()` + `os.fsync()`. Una línea por pulso físico:
  `{"pulse_id": "...", "clip_id": "...", "ts_pulso": "ISO", "camera_key": N, "club": "...", "source": "pulse|button|form"}`
- `clip_id` = el `pulse_id` del PRIMER pulso de una cadena (id estable que sobrevive el encadenado).
- Append puro → O(1), sin lock global, sin reescribir archivo.
- **Rotación diaria**: `pulses_AAAAMMDD.log` para que no crezca infinito.
- Esto reduce la ventana de pérdida de P1 de 10 segundos a ~0 (lo que tarde el `fsync`, milisegundos).

### 2. `reconcile_pulses_log()` — recuperación al arranque (cierra P1)

- Nueva función llamada en el arranque de `main()`.
- Escanea `pulses.log` (el del día y el del día anterior). Por cada `pulse_id` que NO esté representado por ninguna fila-job del CSV y cuyo `ts_pulso` sea más viejo que `CHAIN_GAP_SECONDS` (la ventana de encadenado): crea su fila-job en el CSV con `state = en_cola`.
- Así, si la PC murió en la ventana de 10s, el pulso se recupera al reiniciar.

### 3. Columnas de estado en el CSV

- Extiende `QUEUE_FIELDS` con 5 columnas nuevas: `clip_id`, `state`, `state_updated_at`, `state_detail`, `published_at`.
- `ensure_queue_csv()` ya hace migración suave de columnas nuevas — verifica que las filas viejas reciban valores por defecto sin romperse.
- **Conserva la columna `status` existente** (`PENDING/DONE/DISCARDED`) por compatibilidad: derívala de `state` (`visible→DONE`, `error→DISCARDED`, resto→`PENDING`). Nada que lea `status` se debe romper.

### 4. `set_state(clip_id, new_state, detail="")` — instrumentación

- Nueva función. En esta R1 **solo actualiza el CSV** (bajo `QUEUE_CSV_LOCK`): setea `state`, `state_updated_at` (ISO now), `state_detail`.
- **NO publica a ningún lado** — la publicación a Firestore es Worker B. Deja un comentario claro: `# Worker B engancha aquí la publicación a Firestore`.
- No hace I/O de red, nunca bloquea el pipeline.

### 5. Enum de estados (10 estados)

```
pulso_registrado        pulso en disco; aún no es job
en_cola                 job creado, esperando worker
esperando_nvr           worker lo tomó; espera 20s + verifica NVR
recuperando_video       descargando del NVR por RTSP
procesando              pipeline FFmpeg (detail: aplicando_logos|outro|formato_web)
subiendo                rclone copy a Dropbox
publicando_indice       GitHub Action disparada
visible                 clip reproducible en la plataforma     [terminal-OK]
pendiente_por_conexion  NVR/internet caído; clip a salvo; reintenta solo  [NO terminal]
error                   falló N veces por causa real; recuperable manualmente  [terminal-fallo]
```

Puntos de instrumentación (1 llamada a `set_state()` por punto, en los lugares de log que YA existen — sin lógica nueva):

| Punto en `script.py` | Estado |
|---|---|
| `register_press()` (tras el append a pulses.log) | `pulso_registrado` |
| `_persist_and_enqueue()` / `queue_add_pending()` | `en_cola` |
| `procesar_puntazo()` inicio | `esperando_nvr` |
| antes de descargar el clip del NVR | `recuperando_video` |
| antes de `ffmpeg_amplify_and_logos` | `procesando` (detail `aplicando_logos`) |
| antes de `ffmpeg_concat_outro` | `procesando` (detail `outro`) |
| antes de `ffmpeg_force_web_compat` | `procesando` (detail `formato_web`) |
| antes de `rclone copy` | `subiendo` |
| tras `github_dispatch_index()` | `publicando_indice` |
| `queue_mark_done()` | mantener; `visible` lo pondrá Worker B (en R1 déjalo en `publicando_indice` o ponlo `visible` directo — ver nota) |
| `queue_on_failure()` | `pendiente_por_conexion` o `error` (ver punto 7) |

Nota sobre `visible`: en R1 (sin el publisher que confirma el workflow), al hacer `queue_mark_done()` puedes setear `state = visible` directamente (es lo que `status=DONE` significaba). Worker B refinará esto con la confirmación real del workflow.

### 6. Fix P2 — NVR caído no debe costar el pulso

Dos partes:

1. En `handle_keypress()` y en `manual_clip_prompt_and_enqueue()`: **QUITAR el gate** `if not nvr_reachable_fast(): return` que está ANTES de `register_press()`. El pulso SIEMPRE se registra, pase lo que pase con el NVR. (La verificación del NVR DENTRO de `procesar_puntazo()` se mantiene — eso está bien; lo que se elimina es que un chequeo de red TIRE el pulso en la captura.)
2. En `queue_on_failure()` (o donde se maneje el fallo del worker): **clasificar el fallo**:
   - **Fallo de conexión** (NVR inalcanzable, sin internet, timeout de red): `state = pendiente_por_conexion`. Reintento con backoff largo. **NO consume el presupuesto de intentos. NUNCA pasa a `error`/`DISCARDED`** — el video sigue en el NVR 24/7, se recupera cuando vuelva la conexión.
   - **Fallo real** (FFmpeg corrupto, archivo dañado, error no-de-red): cuenta el intento; tras `MAX_PROCESS_ATTEMPTS` → `state = error`. La fila **nunca se borra** (recuperable manualmente).

### 7. Fix P11 — watchdog mata por subcadena

En `watchdog.py`, dos partes:

1. `find_window_contains()`: comparar por título **EXACTO** (`"PUNTAZO"`, con trim + igualdad case-insensitive), no por subcadena.
2. Antes de cualquier `taskkill` (`kill_runner_window()` / equivalente): resolver el PID dueño de la ventana (`GetWindowThreadProcessId`, que ya se usa) y **CONFIRMAR** que el proceso es `python.exe`/`cmd.exe` cuya línea de comando referencia `script.py` o `run_forever.bat`. Si no se confirma → NO matar, solo loguear advertencia.

### 8. P3 — poda del CSV (prerequisito práctico)

- La instrumentación multiplica ~8x las escrituras del CSV, y `_write_queue_rows()` reescribe el archivo COMPLETO. Un CSV grande se vuelve cuello de botella.
- Implementa una poda: mantener en el CSV "vivo" solo las filas en estado NO terminal + las de las últimas 48h; archivar el resto a `queue\archive\puntazo_local_queue_AAAAMMDD.csv`.
- Que la poda corra al arranque y/o periódicamente (ej. en el hilo de cleanup que ya existe).

### 9. P4 — rotación de logs

- `watchdog.log` (~149 MB) y `runner.log` no rotan. Implementa rotación por tamaño (ej. `RotatingFileHandler` o equivalente manual: al pasar ~10 MB, renombrar a `.1`, `.2`, máximo ~3-5 archivos).

## Fuera de alcance (NO hacer en Worker A)

- **Firestore**: el módulo `state.py` con el publisher, el `state_publisher_loop`, el cliente REST de Firestore, la promoción a `visible` por confirmación del workflow. Todo eso es **Worker B**. En Worker A `set_state()` solo escribe el CSV.
- Migrar la cola a SQLite (sería rediseño — fuera de alcance, decisión del maestro).
- Mover/limpiar las credenciales del NVR o el PAT (otro tema; no las toques).
- Rediseñar el pipeline: la descarga RTSP, los 3 pasos de FFmpeg, la subida rclone, el dispatch a GitHub, el encadenado de pulsos, las colas en memoria, el modo serial/Arduino — **NO se tocan**. Solo se les "cuelgan" llamadas a `set_state()` y se cambia la clasificación de fallos.
- Cualquier cosa en el repositorio web.

## Riesgos

1. **Es producción.** Sin el `git init` del Paso 0 + backups, un error es irreversible. No te saltes el protocolo de seguridad.
2. **Romper el pipeline al instrumentar.** Las llamadas a `set_state()` son inserciones de 1 línea en puntos que ya existen; no cambies la lógica del pipeline alrededor. Si una llamada a `set_state()` lanza excepción, NO debe tumbar el worker — envuélvela defensivamente (try/except que loguee y siga).
3. **El `fsync` en `register_press()`** está en el camino caliente del pulso. Debe ser rapidísimo (una línea). No metas lógica pesada ahí.
4. **La migración de columnas del CSV**: filas viejas sin las columnas nuevas deben recibir defaults sin romper `_write_queue_rows()` ni la lectura. Pruébalo con el CSV real (3.6k filas).
5. **`reconcile_pulses_log()`** no debe duplicar jobs: si un pulso ya tiene fila en el CSV, no crear otra. La join key es `clip_id`.
6. **El watchdog** puede matarte la sesión (P11) — sigue el punto 4 del protocolo de seguridad.
7. **No romper la derivación de `status`**: hay código que lee `status` (PENDING/DONE/DISCARDED); debe seguir viendo valores correctos derivados de `state`.

## Validaciones

Con Isaac presente. El sistema arranca quitando `STOP.flag` (con OK de Isaac), igual que en la prueba de Fase 2.

1. **Backups + git**: `git log` muestra el commit baseline; existen `script.py.bak-*` y `watchdog.py.bak-*`.
2. **Migración del CSV**: tras el primer arranque, `puntazo_local_queue.csv` tiene las 5 columnas nuevas; las 3.6k filas viejas siguen legibles y con defaults sensatos; el sistema no crashea al leer/escribir la cola.
3. **`pulses.log` se escribe**: simular un pulso de teclado (tecla de una cancha vacía, confirmada por Isaac, fuera de horario de juego) → inmediatamente aparece una línea JSON en `queue\pulses.log` (ANTES de los 10s del timer). Verificar el `fsync` mostrando el archivo justo tras el pulso.
4. **Ciclo de estados completo**: dejar correr el pulso simulado del punto 3 (~7-10 min). En la fila del CSV, observar `state` avanzar: `pulso_registrado → en_cola → esperando_nvr → recuperando_video → procesando → subiendo → publicando_indice → visible`. Reportar los `state_updated_at` de cada transición.
5. **`reconcile_pulses_log()` (test seguro de P1)**: con el sistema detenido, agregar a mano una línea JSON a `pulses.log` con un `pulse_id` ficticio y `ts_pulso` de hace 1 hora (un "pulso huérfano" que simula un crash en la ventana de 10s). Arrancar el sistema → `reconcile` debe crear su fila-job en el CSV con `state=en_cola`. Confirmar que NO duplica si se reinicia otra vez.
6. **P2 — gate removido**: verificar por código que `handle_keypress()` y `manual_clip_prompt_and_enqueue()` ya no descartan el pulso por NVR. (Test en vivo del branch NVR-caído es OPCIONAL y requiere OK explícito de Isaac — ej. poner temporalmente una IP de NVR inválida en config, simular pulso, confirmar que el pulso queda como `pendiente_por_conexion` y NO se pierde, luego restaurar la IP. Solo si Isaac lo aprueba.)
7. **P2 — clasificación de fallos**: verificar por código (y por test si se hizo el punto 6) que un fallo de conexión va a `pendiente_por_conexion` sin consumir intentos, y un fallo real va a `error` tras N intentos.
8. **P11 — watchdog**: verificar por código el match exacto + la verificación de PID. Test seguro: confirmar que `find_window_contains()` ya NO matchea un título que contiene "puntazo" como subcadena pero no es exactamente "PUNTAZO" (sin disparar ningún `taskkill` real).
9. **P3 — poda**: tras la poda, el CSV vivo tiene solo filas no-terminales + últimas 48h; el resto está en `queue\archive\`. El conteo total (vivo + archivo) cuadra con el original.
10. **P4 — rotación de logs**: verificar la configuración de rotación (no hace falta esperar a que `watchdog.log` llegue al límite; basta confirmar que la rotación está cableada).
11. **No regresión**: el pulso simulado del punto 4 llegó a `visible` — clip subido a Dropbox e indexado en la web, igual que en Fase 2. El pipeline funciona idéntico.
12. **Sistema restaurado**: al terminar, dejar el sistema como Isaac lo indique (con `STOP.flag` o corriendo), watchdog relanzado.

## Definition of Done

- [ ] `git init` + `.gitignore` + commit baseline; backups `.bak` de script.py y watchdog.py.
- [ ] `pulses.log` append-only con `fsync` y rotación diaria.
- [ ] `reconcile_pulses_log()` en el arranque, sin duplicar jobs.
- [ ] CSV con las 5 columnas nuevas; `status` derivado de `state`; migración suave OK.
- [ ] `set_state()` (solo CSV en R1, con seam comentado para Worker B).
- [ ] Los ~9 puntos de instrumentación llamando `set_state()`, defensivos.
- [ ] P1 cerrado (pulso persiste en ms, no en 10s).
- [ ] P2 cerrado (gate de NVR removido + clasificación conexión/real).
- [ ] P11 cerrado (watchdog: match exacto + verificación de PID).
- [ ] P3 (poda del CSV) y P4 (rotación de logs) implementados.
- [ ] Las 12 validaciones ejecutadas y reportadas.
- [ ] Commits limpios en el repo git local nuevo. Sistema restaurado.
- [ ] Cero cambios al pipeline (RTSP, FFmpeg, rclone, dispatch, encadenado).

## Formato del reporte de regreso

Texto plano, copiable, para el chat maestro:

```
## REPORTE WORKER LOCAL A — fixes + estados (R1)

### Resumen ejecutivo
### Archivos modificados / nuevos
### Decisiones técnicas tomadas (con justificación)
### Cómo quedó cada fix (P1, P2, P11)
### Bugs encontrados
### Riesgos detectados
### Qué quedó pendiente
### Validaciones (las 12, con status ✅/❌/⏭️ + output observado)
### Estado en que quedó el sistema
### Recomendación al arquitecto maestro
```
