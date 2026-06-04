# Worker Local J — Portar el watchdog Python + disk-monitor + Telegram de Interpadel a BreakPoint y WellStreet

> Worker de **implementación** corriendo dentro de la NUC (se ejecuta **dos
> veces**: una en BreakPoint `c:\Puntazo\runner\`, otra en WellStreet
> `C:\Users\WellStreet\Desktop\Puntazo-release`). NO trabaja sobre el repo web.
> Coordinado por el chat maestro.
>
> **Branch base**: `master` local del repo NUC (BP tiene git; WS no — ver Riesgos).
> **Cosecha la innovación #4** del audit de Interpadel (2026-06-03).

## Objetivo

Reemplazar el watchdog ad-hoc (PowerShell / script disperso) de BreakPoint y
WellStreet por el **watchdog Python** que ya corre en Interpadel
(`runner/watchdog.py`, 397 LOC), sumando:

- Detección de freeze por **edad de `heartbeat.txt`** (>120s) y kill **por PID**
  (no por ventana).
- **Single-instance lock** del propio watchdog (`watchdog.lock`).
- **Circuit-breaker**: `MAX_RESTARTS_IN_WINDOW=5` en 10 min → crea `STOP.flag`
  + notifica Telegram (NO reboot automático).
- **Boot-ID detection**: resetea el contador de reinicios al detectar reboot del
  SO (vía `GetTickCount64`).
- **Disk-monitor** (de `core/maintenance.py`): alerta Telegram cuando hay
  <250 MB libres, warn cuando hay <1 GB.

## Contexto que ya sabemos

### Fuente (Interpadel, referencia de lectura)

- `runner/watchdog.py` (397 LOC) — el watchdog completo.
- `core/maintenance.py:74` `_check_disk_space` — el monitor de disco con alerta
  Telegram. Portar **solo** esa parte (no todo maintenance.py).
- `core/notifier.py` (124 LOC) — notifier centralizado con anti-spam. Necesario
  para que las alertas Telegram no inunden. Portar junto.
- ⚠️ El watchdog de IP **NO** honra `DEV_MODE.flag` (IP no lo tiene). BP **SÍ**
  lo tiene (Worker C): `focus_and_maximize` deshabilitado en dev para no robar
  foco. **El port DEBE preservar el comportamiento de Worker C en BP**: el
  `focus_and_maximize` de IP existe pero NO se llama en loop — eso es justo lo
  que queremos. Mantenerlo desactivado y honrar `DEV_MODE.flag` si está presente.

### Destino

- **BreakPoint**: ya tiene `watchdog.py` (23 KB) + Worker C (DEV_MODE.flag).
  Constantes inline en `script.py` (no hay `config.json`). El watchdog nuevo
  debe leer las constantes de donde ya viven.
- **WellStreet**: arquitectura modular `core/`, `config.json` real. Confirmar si
  ya tiene watchdog o corre desnudo.

## Arquitectura relevante

- **Lenguaje**: Python puro + WinAPI (`ctypes`), sin PowerShell.
- **Heartbeat**: ambos runners ya escriben `heartbeat.txt` (BP cada 30s). El
  watchdog lee su mtime; si supera 120s → freeze → kill PID + restart.
- **Telegram**: requiere `bot_token` + `chat_id`. Hoy IP los tiene en
  `config.json` (placeholder). En BP/WS hay que decidir EN SITIO de dónde salen
  (config inline BP vs config.json WS). **Si no hay token configurado, el
  watchdog debe degradar graceful** (loguea local, no crashea).

## Archivos importantes a revisar

- En IP (lectura): `runner/watchdog.py`, `core/maintenance.py:74+`, `core/notifier.py`.
- En BP: `watchdog.py` actual, `run_forever.bat`, `AUTO_START_PUNTAZO.bat`,
  `script.py` (constantes + escritura de heartbeat + manejo de `DEV_MODE.flag`).
- En WS: `runner/` o equivalente, `run_forever.bat`, `config.json` (solo lectura
  para token/chat_id; NO tocar secretos — eso es HP).

## Alcance

1. **Auditar** el watchdog actual de la NUC destino: qué supervisa, cómo mata,
   cómo arranca el runner, dónde se configura. Documentar con `file:line`.
2. **Portar** `watchdog.py` (Python) adaptando rutas y constantes a la NUC destino.
3. **Portar** `_check_disk_space` + `notifier.py` (anti-spam).
4. **Preservar Worker C en BP**: honrar `DEV_MODE.flag`, NO robar foco.
5. **Wirear** `run_forever.bat` / `AUTO_START_PUNTAZO.bat` para lanzar el nuevo
   watchdog en vez del viejo. Conservar el viejo como `.bak`.
6. **Degradación graceful** sin Telegram token (no crashear).

## Fuera de alcance

- **Rotar / sanear secretos** (Telegram token, etc.) — eso es HP-IP / HP-BP.
- **Tocar el pipeline de captura, FFmpeg, cola o Firestore.** Solo supervisión.
- **El dashboard Flask** — es Worker K, va después.
- **NVR discovery** — es Worker N.
- **Reescribir BP/WS a arquitectura modular.** Solo se porta el watchdog como
  módulo standalone.

## Riesgos

- **WS no es repo git** (`.git` ausente, confirmado en E0). Si Isaac quiere
  versionar: `git init` + commit inicial + branch. Si no: trabajar sin branch
  y reportar (maestro pull-ea del filesystem). NO versionar `config.json`/`secrets/`.
- **Robo de foco**: si el port reactiva `focus_and_maximize` en loop, rompe
  Worker C en BP (el watchdog robaría el foco en dev). Test obligatorio con
  `DEV_MODE.flag` presente.
- **Doble watchdog**: si el viejo watchdog queda registrado en Startup/.bat y el
  nuevo también, dos procesos compiten. Desregistrar el viejo explícitamente.
- **Kill por PID equivocado**: confirmar que el PID que mata es el del runner y
  no el del propio watchdog (el `watchdog.lock` previene auto-kill).

## Validaciones

Cada item ✅ ❌ o ⏭️ con razón:

1. **Freeze simulado**: congelar el runner (o no actualizar `heartbeat.txt` >120s)
   → el watchdog lo mata por PID y lo relanza. Verificar en log.
2. **Circuit-breaker**: forzar 5 reinicios en <10 min → se crea `STOP.flag` y
   llega alerta Telegram (o se loguea si no hay token). NO reboot.
3. **Boot-ID reset**: simular/forzar el reset del contador al detectar reboot
   (o documentar cómo se probó vía `GetTickCount64`).
4. **Disk-monitor**: bajar el umbral a un valor alcanzable (o llenar disco de
   prueba) → alerta a <250 MB, warn a <1 GB.
5. **Worker C intacto (solo BP)**: con `DEV_MODE.flag` presente, el watchdog NO
   roba foco ni maximiza ventana.
6. **Single-instance**: lanzar dos watchdogs → el segundo aborta por `watchdog.lock`.
7. **Degradación sin Telegram**: sin token configurado, el watchdog corre y
   loguea local sin crashear.
8. **No regresión runner**: el runner arranca y procesa un pulso normal con el
   watchdog nuevo supervisando.

## Definition of done

- `watchdog.py` (Python) portado y activo en la NUC destino, viejo watchdog en `.bak`.
- Disk-monitor + notifier anti-spam funcionando.
- Worker C preservado en BP (no roba foco).
- Validaciones 1-8 documentadas.
- Branch `worker-local-J-watchdog-python-port` (BP) / equivalente WS, con commit SHA
  (o reporte sin branch si WS no se versiona).
- Reporte en formato `docs/workers/README.md`.

## Formato del reporte de regreso

Ver `docs/workers/README.md`. Sí o sí incluir:

- Qué watchdog viejo se reemplazó (PowerShell / script) y dónde estaba registrado.
- Confirmación de que Worker C (no robar foco) quedó intacto en BP.
- De dónde sale el Telegram token en cada NUC (sin transcribir el valor).
- Si WS se versionó o no.

---

**Referencias rápidas**:
- Fuente IP: `runner/watchdog.py`, `core/maintenance.py`, `core/notifier.py`.
- Estado consolidado: `docs/plans/nuc-state-2026-06-03.md`.
- Worker C (no robar foco): `docs/workers/worker-local-C-dev-mode-cleanup.md`.
- Convención: `docs/workers/README.md`.
