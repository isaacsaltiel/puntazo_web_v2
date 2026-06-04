# Worker Local K — Portar el dashboard Flask de Interpadel a BreakPoint y WellStreet

> Worker de **implementación** corriendo dentro de la NUC (se ejecuta en
> BreakPoint y WellStreet). NO trabaja sobre el repo web. Coordinado por el
> chat maestro.
>
> **Branch base**: `master` local del repo NUC. **Depende de Worker J**
> (watchdog) ya aplicado. **Cosecha la innovación #3** del audit de Interpadel.

## Objetivo

Portar el **dashboard Flask** que corre en Interpadel (`core/dashboard.py`,
872 LOC, puerto 5050) a BreakPoint y WellStreet, para dar visibilidad operativa
a operadores no-técnicos del club y un endpoint `POST /trigger` que destense la
dependencia de `cmd.exe` / teclado.

Features a portar (del audit IP):

- Panel fullscreen con **grid 2×2 de cámaras** (clips hoy, último clip, badge
  "ACTIVO" cuando hay cadena en curso).
- **Pill bar** de estado: NVR / Dropbox / GitHub / Arduino.
- **Cola**: pending / in_flight (desde `INFLIGHT_JOB_IDS`) / done_today / failed_today.
- **MJPEG proxy** `/stream/<cam_key>` (vivo desde RTSP, sin VPN).
- **`POST /trigger`** para Forms/Jetson con auth `X-Puntazo-Token`, rate-limit
  20s por cámara.
- **`POST /api/stop`** y **`/api/clear_stop`** para manejar `STOP.flag` desde el browser.
- **Browser watchdog**: reabre el tab si se cierra (45s sin polling).
- **Auto-fullscreen** + "Modo Config" (pausa fullscreen N minutos).
- **Atajos de teclado** (3-6 trigger cámara, `s` STOP, `f` fullscreen).
- JS **ES5 estricto** (browsers viejos del NUC).

## Contexto que ya sabemos

- El dashboard de IP lee estado interno (`INFLIGHT_JOB_IDS`, contadores de cola,
  estado de NVR/Dropbox/GitHub/Arduino). En IP eso vive en módulos `core/`.
  En BP/WS la cola y el estado viven distinto (BP monolítico `script.py`; WS
  modular `core/queue_manager.py`). **El trabajo central del port es wirear el
  dashboard al estado de cada runner destino**, no reescribir el dashboard.
- El `POST /trigger` debe llamar al mismo seam de encolado que ya usan las
  fuentes existentes (botón / listener), igual que en IP
  (`register_press(cam, ts)`). NO inventar un encolado nuevo.
- Auth: `PUNTAZO_DASH_TOKEN` como env var. En IP hoy **no está seteado** →
  dashboard sin auth en LAN. **En BP/WS debe quedar seteado** (sin token, el
  `/trigger` y `/api/stop` quedan abiertos a cualquiera en la LAN).

## Arquitectura relevante

- **Lenguaje**: Python (Flask) + frontend JS ES5.
- **Puerto**: 5050 (confirmar que no choca en BP/WS).
- **MJPEG**: proxy que lee RTSP del NVR y reemite como multipart/x-mixed-replace.
  Reusa el mapeo cámara→canal de cada NUC (BP: 1-8→101..801; WS: con swap 5↔6).
- **Arduino pill**: BP/WS pueden no tener Arduino. Si no hay, la pill debe
  mostrar "N/A" sin romper.

## Archivos importantes a revisar

- En IP (lectura): `core/dashboard.py` (872 LOC), el seam `register_press` y
  los contadores de cola / `INFLIGHT_JOB_IDS`.
- En BP: `script.py` — dónde vive el estado de la cola, el mapeo de cámaras, el
  manejo de `STOP.flag`, y el seam de encolado del botón.
- En WS: `core/queue_manager.py`, `core/sources/`, mapeo de canales en `config.json`.

## Alcance

1. **Auditar** el estado interno expuesto por el runner destino: contadores de
   cola, in-flight, estado NVR/Dropbox/GitHub, seam de encolado. `file:line`.
2. **Portar** `dashboard.py` como módulo Flask standalone, adaptando los reads de
   estado al runner destino.
3. **Wirear `POST /trigger`** al seam de encolado existente (mismo path que el
   botón/listener), con auth `X-Puntazo-Token` + rate-limit 20s/cam.
4. **MJPEG `/stream/<cam_key>`** con el mapeo cámara→canal de la NUC.
5. **`/api/stop` + `/api/clear_stop`** manejando el `STOP.flag` real del runner.
6. **Setear `PUNTAZO_DASH_TOKEN`** (env) — coordinar con Isaac el valor, NO
   hardcodear en código versionado.
7. **Lanzar el dashboard** junto al runner (thread o proceso aparte) sin bloquear
   el pipeline.

## Fuera de alcance

- **Visión-pose** (innovación #2 IP) — NO se porta, está en espera de validación.
- **Migración Forms→/trigger** en IP — es Worker M.
- **Sanear secretos / token en claro** — HP-IP / HP-BP.
- **Cambios al repo web.**
- **Exponer el dashboard a internet** (Cloudflare Tunnel) — eso es Worker M para IP;
  en BP/WS el dashboard es LAN-only por ahora.

## Riesgos

- **`/trigger` o `/api/stop` sin token** = cualquiera en la LAN dispara clips o
  para el runner. `PUNTAZO_DASH_TOKEN` obligatorio antes de declarar done.
- **MJPEG satura CPU/NVR**: cada stream abre una conexión RTSP. Limitar streams
  concurrentes o resolución si el NUC sufre.
- **Puerto 5050 ocupado** en BP/WS: verificar antes.
- **Bloqueo del pipeline**: si el dashboard corre en el mismo thread que el
  procesamiento, lo frena. Debe correr aislado.
- **Diferencia de estado BP monolítico vs IP modular**: el wiring puede requerir
  exponer contadores que hoy son locales a funciones. No romper el pipeline al
  exponerlos.

## Validaciones

Cada item ✅ ❌ o ⏭️ con razón:

1. **Dashboard levanta**: abrir `http://localhost:5050` en la NUC → grid 2×2 +
   pill bar renderizan con estado real.
2. **MJPEG**: `/stream/<cam_key>` muestra video en vivo de la cámara correcta
   (mapeo cancha→canal correcto, especialmente el swap 5↔6 en WS).
3. **`POST /trigger` con token válido**: dispara un clip de la cámara indicada
   (entra al mismo flujo que el botón). Con token inválido → 401/403.
4. **Rate-limit**: dos `/trigger` a la misma cámara en <20s → el segundo se rechaza.
5. **`/api/stop`**: crea `STOP.flag`, el runner para. `/api/clear_stop` lo borra.
6. **Contadores de cola**: pending / in_flight / done_today / failed_today
   reflejan el estado real durante una sesión de pulsos.
7. **Browser watchdog**: cerrar el tab → se reabre solo (≤45s).
8. **No bloquea pipeline**: con el dashboard arriba, un pulso normal se procesa
   y sube a Dropbox sin degradación.

## Definition of done

- Dashboard Flask en :5050 activo en la NUC destino, wireado al estado real.
- `POST /trigger` con auth + rate-limit funcionando contra el seam de encolado.
- MJPEG, `/api/stop`, `/api/clear_stop` operativos.
- `PUNTAZO_DASH_TOKEN` seteado (no en código versionado).
- Validaciones 1-8 documentadas.
- Branch `worker-local-K-dashboard-flask-port` con commit SHA (o reporte sin
  branch si WS no se versiona).
- Reporte en formato `docs/workers/README.md`.

## Formato del reporte de regreso

Ver `docs/workers/README.md`. Sí o sí incluir:

- Cómo se wireó el estado de cola al dashboard en cada NUC (`file:line`).
- Confirmación de que `POST /trigger` usa el seam de encolado existente.
- Dónde quedó `PUNTAZO_DASH_TOKEN` (env / archivo, sin transcribir el valor).
- Si hubo que limitar MJPEG por carga.

---

**Referencias rápidas**:
- Fuente IP: `core/dashboard.py`.
- Worker J (prerequisito): `docs/workers/worker-local-J-watchdog-python-port.md`.
- Worker M (Forms→/trigger en IP, usa este endpoint): `docs/workers/worker-local-M-ip-forms-to-trigger.md`.
- Estado consolidado: `docs/plans/nuc-state-2026-06-03.md`.
- Convención: `docs/workers/README.md`.
