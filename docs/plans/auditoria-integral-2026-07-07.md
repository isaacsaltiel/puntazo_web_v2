# Auditoría integral Puntazo — 7-jul-2026

> Auditoría multi-agente (workflow `puntazo-mega-audit`, run `wf_2cec6042-7ba`) sobre 6 áreas,
> cada hallazgo P1 pasado por un verificador adversarial escéptico. **COMPLETA (6/6).**
> Solo lectura — no se modificó ningún archivo. Secretos nunca transcritos (solo tipo/prefijo).

---

## TL;DR — qué atacar primero

**Los P1 CONFIRMADOS por verificación adversarial (reales al 7-jul, contra el código de hoy):**

| # | Área | Problema | Fix | Verificación |
|---|------|----------|-----|--------------|
| 1 | Visión | `_enabled` default **True** en `core/main.py:465` — visión se auto-enciende si alguien instala ultralytics en una NUC, con el detector OBSOLETO, publicando clips falsos al feed | **minutos** | CONFIRMED P1 |
| 2 | Runner | Clip descargado **nunca se valida**: un MP4 vacío/truncado (hueco del NVR, disco lleno) se publica como bueno con ✅ DONE | **minutos** | CONFIRMED P1 |
| 3 | Firmware | OTA = WebServer en `:80` **sin auth** en la WiFi general del club → cualquiera flashea firmware arbitrario o brickea el botón | **minutos** | CONFIRMED P1 |
| 4 | Firmware | basic-2.0 (producción) **carece de las 3 curas WiFi** de 2led-1.0 → una unidad marginal queda offline permanente sin auto-cura ni acceso OTA | **horas** | CONFIRMED P1 |
| 5 | Streaming | Sin **heartbeat/ACK**: la web no distingue "NUC apagada" de "arrancando"; una pill "🔴 EN VIVO" queda congelada si la NUC muere | **horas** | CONFIRMED P1 |
| 6 | Fleet | El listener `on_snapshot` **no tiene watchdog**: ante error terminal de Firestore el daemon queda sordo para siempre (proceso vivo, no escucha) — la falla silenciosa que la flota quiere combatir | **horas** | CONFIRMED P1 |
| 7 | Seguridad | **PAT classic VIVO** (scope amplio de toda la cuenta) en `.env` de la NUC — verificado HTTP 200 | **minutos** | verificado en vivo |

**P1 adicionales de alta confianza (no pasaron por verificador por límite de sesión, pero sólidos):**
- Fleet: **IP y BreakPoint corren el agente VIEJO** (ruta de claude fija que muere al actualizar VS Code + replay de backlog al reiniciar). Redesplegar el autocontenido = mayor retorno del área.
- Runner: job **DISCARDED = pérdida silenciosa doble** (nada lo reporta + el pulso se ACK-ea al ENCOLAR, no al publicar; 42% DISCARDED en el CSV histórico de esta copia).
- Runner: errores del pipeline van a `print()`, **no al logger** → post-mortem imposible (el log dice que todo iba bien).
- Runner: resultado del dispatch a GitHub **ignorado** → clip sube a Dropbox pero puede quedar sin indexar (invisible en la web) sin reintento.
- Runner: heartbeat "alive" **no prueba entrega** (nvrConnected es solo TCP:80; zombie verde con `rclone_step_timeout_sec=10000` = 2.8h).

**Ajustados por el verificador (severidad corregida):**
- Streaming START sin TTL + replay-fantasma: **PARTIAL → P2** (hechos exactos, escenario más acotado de lo pintado, pero el barrido-a-STOP pre-rollout WS sigue siendo obligatorio).
- Límite YouTube: **PARTIAL → P2**, pero el límite se **confirmó en vivo**: `support.google.com/youtube/answer/2474026` dice textual "**10 active streams per channel and 3 per stream key**". IP(4)+WS(6)=10 justo en el borde.
- Seguridad "carpeta plantilla con secretos": **PARTIAL → P3** (la carpeta `- copia` es dev local, NO la que se zipea/distribuye).
- Visión `vision_multi.py` duplicado: **PARTIAL → P3** (producción importa la copia buena de `core/`).

### "Hazlo ya" — quick wins de minutos, alto retorno, bajo riesgo

1. **Visión off explícito** (mata la trampa #1): `_enabled` default `False` en `core/main.py:465` + `"_enabled": false` en el bloque `vision` de config.json de las 3 NUCs.
2. **Validar el clip** antes de publicar (`pipeline.py`, ~15 líneas con el `get_duration()` que ya existe): si `dur < 0.5×solicitado` o `size < 200KB` → ERROR + retry, no publicar.
3. **Rotar el PAT** del `.env` a un fine-grained acotado a `puntazo_web_v2` (Contents+Actions) y revocar el classic; borrar el PAT viejo (pre-rotación) que sigue en claro en `PUNTAZO_NEW_F1/CONTEXTO/config.json` y en un `.md` de análisis.
4. **Bajar `rclone_step_timeout_sec`** de 10000 a 600 en las 3 NUCs (hoy un rclone colgado bloquea el único worker 2.8h con pill verde).
5. **Poblar Telegram** (`TELEGRAM_BOT_TOKEN`/`CHAT_ID` en `.env`): revive gratis el notifier que ya existe (aviso de auto-reboot del watchdog hoy va a la nada).
6. **Verificar HOY** el OAuth de YouTube: publishing status debe ser **'In production'** (en Testing el refresh token muere a los 7 días y el token es COMPARTIDO → tumbaría IP y WS a la vez). La guía `streaming-youtube-activation.md:79-80` da un consejo INCORRECTO aquí.
7. **Barrido pre-rollout WS**: `action='STOP'` en todos los docs `stream_commands` de WellStreet antes de `enabled=true` (anti replay fantasma).
8. **Config del botón OTA**: incluir Basic-auth (`otaServer.authenticate`) en el próximo OTA — ~5 líneas.

---

## 📡 STREAMING YOUTUBE — bien diseñado en lo esencial, débil en semántica temporal

**Bien (verificado):** las reglas separan campos web vs NUC — un admin comprometido NO puede
falsear `status`/`youtube_url` (`keys().hasOnly` + `affectedKeys().hasOnly`, firestore.rules:532-541).
El panel patchea el DOM in-place y muestra deseado vs real.

**P1 CONFIRMED — Sin heartbeat ni ACK** (admin.html:1363/1368): `applyStreamState` pinta `d.status`
crudo; si la NUC muere con `status=LIVE`, la pill "🔴 EN VIVO" queda congelada para siempre;
`requested_at` se escribe pero jamás se lee para detectar "START pedido hace Xs sin respuesta".
→ (a) doc `stream_agents/{club}` con `agent_heartbeat_at` cada 60s + pill por club; (b) `command_id`
uuid + `acked_command_id` en el writeback; (c) quick win sin tocar NUC: warning ">60s sin respuesta".

**P2 (bajado de P1) — START sin TTL + replay-on-boot = arranque fantasma** (admin.html:1402): los
botones WS ya escriben a Firestore sin NUC detrás; un START viejo puede revivir como directo
público. → NUC ignora START con `requested_at`>15 min en replay; barrido pre-rollout a STOP.

**Otros:** canal compartido IP(4)+WS(6)=10 = tope de YouTube (10/canal, 3/key — confirmado en vivo)
→ `max_concurrent` por club (WS: 2) o brand channel propio; cuota API 10k/día por proyecto GCP
compartida (~50-60 partidos Nivel B/día). Reglas sin validar `docId==club_'_'cancha` ni `titulo`
(YouTube rechaza >100 chars y `<`/`>`). Panel ofrece START en 11 canchas sin NUC → allowlist
`STREAM_CLUBS`. Copy-paste de módulos sin `protocol_version` = drift. `_streamTitleEdits` nunca se
limpia. `allow read` abierto a cualquier logueado → `isAdminUser()`.

**Checklist GO/NO-GO rollout WS** (10 pasos medibles): [1] OAuth 'In production' (si Testing → NO-GO);
[2] upstream ≥ N×2.5×1.5 Mbps; [3] `ffmpeg -hwaccels` lista qsv + transcode 60s <30% CPU (si libx264 →
máx 1-2 canchas); [4] ffprobe del RTSP real (codec); [5] barrido a STOP; [6] 6 keys nuevas ≠ IP;
[7] logo WS o `enable_logos:false`; [8] E2E de 1 cancha antes de 6; [9] prueba de reinicio; [10]
concurrencia acotada + revisar consumo de cuota. Fuentes: support.google.com/youtube/answer/2474026,
developers.google.com/youtube/v3/determine_quota_cost, support.google.com/cloud/answer/15549945.

---

## 👁️ VISIÓN / IA — prototipos con núcleo rescatable; NADA en producción

`padel_analyze.py` (ByteTrack+homografía+GhostTracker+heatmaps) es sólido offline;
`Vision_WebCamX.py` v3 tiene el MEJOR detector de celebración (umbrales proporcionales+motion
gating). Pero `core/vision_multi.py` (lo cableado) nunca arrancó e integra el detector OBSOLETO
(T-pose píxeles fijos), no el v3. `vision/JETSON` está **VACÍA** — no hay proyecto Jetson. Sin
dataset ni métricas.

**P1 CONFIRMED — auto-encendido** (main.py:465, `_enabled` default True): fix de minutos arriba.

**P2/P3:** detector obsoleto cableado (trasplante de ~120 líneas del v3); presupuesto de CPU
inviable (30 inf/s serializadas sin motion gating ni métricas → OpenVINO en iGPU, `model.export`);
`nvr.password` en claro; duplicado con deriva de firma (PARTIAL→P3, producción usa la buena);
cámaras sin ROI analizan frame completo (espectadores); zonas de stats engañosas; ~1 GB de
artefactos sueltos (zip 346MB).

**Roadmap honesto:** **v0** (1-2 sem, cero riesgo) dataset+evaluador offline con clips reales de
Dropbox (cada pulso = etiqueta débil gratis) → precision/recall REALES; **v1** (3-6 sem) "clip sin
botón" en **shadow mode** con OpenVINO en iGPU, 1-2 canchas solo logueando, activar con badge 'AUTO'
si precision ≥90%; **v2** (2-3 meses) highlights automáticos del `_PARTIDO_` offline (rally + audio)
+ stats; **NO** marcador/tracking de pelota aún (TrackNetV3+ caro y frágil; el marcador ya existe
por botón/web). Migrar a yolo11n-pose al portar.

---

## 🔘 FIRMWARE ESP32-C3 — núcleo "nunca perder el pulso" sólido; 2 P1 corregibles por OTA

**Bien (verificado):** ISR FALLING + latch-hasta-soltar (sin pérdida ni doble-conteo), NVS diferida
(desgaste de flash irrelevante — décadas), reintento-hasta-ACK + dedupe, `event_id`
device-bootCount-seq único tras reinicios, `setTxTimeoutMs(0)`, WDT 60s, `setSocketTimeout(2)`,
`monitor.py` con puente HTTP atado a 127.0.0.1.

**P1 CONFIRMED — basic-2.0 sin las 3 curas WiFi de 2led-1.0** (verificado línea por línea: TX power
DESPUÉS de begin, `setSleep(false)` fijo, sin escalera TX ni `onWifiEvent`). → **CHANGELIST basic-2.1**
(portar de 2led-1.0, un solo OTA): (1) globals TX_LADDER+flags; (2) reescribir `wifiEnsureConnected`
(setSleep dinámico + TX power ANTES de begin + persistir txstep con guard); (3) `onWifiEvent`; (4)
setup: cargar txstep, quitar el `setSleep(false)`; (5) failsafe 5s en loop; (6) LED congelado en auth.
**OJO:** NO tocar `struct PendingEvent` (loadPending valida por tamaño → descartaría pendientes).
Config final: BENCH 0, DEVICE_ID "ip-cancha4", NUM_PIXELS 1, FW_VERSION "basic-2.1". Validar primero
en la placa 2led con BENCH 1.

**P1 CONFIRMED — OTA sin auth** (:80, verificado cero `authenticate()`): incluir Basic-auth en el
mismo OTA, o "armado" solo bajo demanda vía MQTT `{"ota":true}` que abre ventana 10 min.

**P2/P3:** Mosquitto anónimo permite forjar ACKs (suprimir puntos) e inyectar clips falsos →
password_file+ACL; `PENDING_MAX=16` descarta el más viejo en caída larga → subir a 48-64 (con
cuidado del sizeof); OTA sin rollback (un .bin mal configurado deja el botón huérfano) → checklist
pre-OTA + perfil WiFi de rescate; credenciales WiFi en claro en 4+ archivos → `secrets.h`; rollover
de `millis()` a 49.7 días (patrón `now<deadline`, borde benigno) → cambiar a resta; pulsos
recuperados de NVS sin NTP pierden hora real → flag `stale_ts`. **Estratégico:** botón genérico v3
(device_id por MAC + config en NVS + portal SoftAP — la semilla ya existe en test-1.7).

---

## 🛰️ FLEET (red de NUCs) — bus bien diseñado; el riesgo está en la resiliencia y la cuota

**Bien (verificado):** idempotencia `.create()` atómica (E2E), defaults seguros (`allow_shell=False`,
`claude_autonomous=False`), borra vars de API antes de claude (usa plan, no tokens), descubrimiento
que aborta ante ambigüedad, mutex único, `_seen` acotado, ancla anti-replay, resolución de claude.exe
re-evaluada por invocación. El snippet de reglas NO desplegado **no es hueco**: el catch-all deny
(firestore.rules:549) hace que los clientes web NO puedan tocar `fleet_commands` — estado más
restrictivo que con el snippet.

**P1 CONFIRMED — listener sin watchdog** (puntazo_fleet_agent.py:929): `on_snapshot` + `while True:
sleep(3600)`, el watch nunca se revisa; ante error terminal de Firestore el hilo muere sin excepción
al principal → NUC "viva" pero sorda. → watchdog en el loop: cada 5 min checar `watch._closed` +
lectura `limit(1)`; tras 3 fallos → `os._exit(1)` (el .bat relanza).

**P1 (alta confianza) — IP y BP corren el agente VIEJO** (ruta de claude fija que muere al actualizar
la extensión + replay de backlog + sin mutex/sesiones). Verificado que WS ya corre el nuevo. →
**redesplegar el autocontenido a IP y BP** (DEPLOY-NUC.md) = mayor retorno del área.

**P2:** cero frenos de cuota (las 3 NUCs + central comparten el tope del plan de Isaac; un loop mal
configurado lo vacía) → token bucket persistido en `quota.json` + confirmación para `target=all` +
dedupe; `kind=claude` es primitiva de lectura remota de archivos + la MISMA service account en las 4
máquinas → tools restringidas (`--disallowedTools`), SA por máquina, HMAC de comandos; resultado
atascado en 'running' si algo lanza tras el claim (`int(timeout_s)` fuera del try) → mover al try +
reintentos en `ref.update`; prompt por argv rompe la síntesis del Concejo con el límite de 32K de
Windows → pasar por stdin.

**P3:** ancla boot_ts usa reloj local (NUC adelantada >5 min queda sorda) → anclar con
SERVER_TIMESTAMP; sesiones/chats crecen sin poda.

**Estratégico — CAPA 4 (auto-update por Firestore):** colección `fleet_updates/{version}` con
{version, sha256, payload_b64 o URL, canary}; la NUC descarga → verifica sha256 (+ opcional firma
Ed25519 para que ni la SA robada baste) → `--selftest` en subproceso → `os.replace` con `.bak` →
reinicia (el .bat relanza). Rollback: contador de arranques; si 2 sin llegar a "boot OK", restaura
`.bak`. Staging: canary siempre primero (una NUC), verificar hash + humo, luego `target=all`. Sync
de versiones: `agent_sha256` en status + heartbeat + `fleet_push.py versions`. Concejo v2: ronda de
debate con `--debate` (cada NUC ve las opiniones ajenas y ajusta; coste acotado 2 turnos/NUC).

---

## 🩺 SALUD DE FLOTA (Capa 3) — toda la observabilidad mide "proceso vivo", nada mide "entrega"

El runner (WS/IP) está mejor construido de lo que sugiere su historia (threads aislados, cola CSV con
retry/idempotencia, watchdog con anti-flap). El problema de fondo: **nada mide clips entregados.**

**P1 CONFIRMED — clip no validado** (pipeline.py:464): fix de minutos arriba (el modo de falla #1).
**P1 (alta confianza):** DISCARDED = pérdida silenciosa doble (ACK al encolar, no al publicar; 42%
DISCARDED histórico) → escribir `error_reason` al doc pending_pulses; errores a `print()` no al
logger → usar `PUNTAZO.*`; dispatch a GitHub ignorado → estado `needs_dispatch` + reintento; heartbeat
"alive" no prueba entrega (nvrConnected solo TCP:80, `rclone_step_timeout=2.8h`).

**Advertencia dura:** esta copia central está DESFASADA vs las 3 NUCs (no tiene `resolved_video`) y el
runner de BP (script.py monolítico) NO está en esta PC → la Capa 3 debe ser un **módulo standalone
portable**, no un parche al runner.

**SPEC CAPA 3** (dos módulos que leen artefactos comunes, deploy vía fleet bus):
- **Fase A — heartbeat enriquecido** (`health_probe.py`, Task Scheduler cada 60s, namespace `health.`
  aditivo): `runner_alive`, `nvr{tcp80,isapi,rtsp554,clock_skew_s}`, `disk_free_gb`,
  `queue{pending,done_today,discarded_today,last_done_at,oldest_pending_age_s}`,
  **`last_clip_published_at`** (el campo estrella), `rclone_ok` (cada 10 min), `flags{stop,dev_mode}`,
  `versions`. Con `last_clip_published_at`+`discarded_today` el "zombie verde" es detectable.
- **Fase B — auditoría diaria de entrega** (`delivery_audit.py`, EN CADA NUC 23:30 local): query
  pending_pulses del día → total / with_resolved_video / with_error / **orphans** (consumed sin video
  ni error = la pérdida silenciosa) / unconsumed (listener muerto). Verdict: OK | NO_TRAFFIC |
  DEGRADED | SILENT_FAILURE. Escribe `fleet_health/{club}/daily/{fecha}`.
- **Fase C — alertado proporcional:** INFO → doc pintado en admin.html; WARN → `fleet_alerts` con
  dedupe; CRIT → Telegram (notifier ya existe, solo poblar token; NO WhatsApp). La NUC NO dispara
  claude automáticamente (cuota).
- **Fase D — qué NO construir:** probe RTSP activo por cancha, auto-remediación remota, TSDB/Grafana,
  SQLite, claude por alerta, unificación de runners (proyecto aparte; primero traer script.py de BP a
  un repo espejo vía fleet y versionar con hash).

**Orden de rollout:** quick-wins de confiabilidad → `health_probe.py` en WS → `delivery_audit.py` + tab
admin → replicar a IP/BP vía fleet → Telegram CRIT al final (tras una semana de datos que demuestren
que los verdicts no son ruidosos).

---

*Reporte generado por workflow multi-agente `wf_2cec6042-7ba` con verificación adversarial de los P1.*

---

## ADDENDUM — sesión 2 (8-jul 06:48, trabajo autónomo aplicado)

En la ventana de continuación (cuota reseteada) se aplicaron los quick-wins reversibles de bajo
riesgo y se construyeron los entregables de riesgo cero. **Nada se desplegó a las NUCs ni a
producción/master — todo vive en el copy de desarrollo local o en archivos nuevos.**

**APLICADO + VERIFICADO (en `sistema-club/Puntazo-release - copia/`, copy de desarrollo):**
- **P1 visión auto-encendido** — `core/main.py:465` default `True`→`False` + `"_enabled": false`
  explícito en `config.json` (bloque vision). Verificado: `py_compile` OK, `config.json` parsea,
  `vision._enabled = False`. **Falta desplegar a las 3 NUCs** (poner `"_enabled": false` en su
  config.json — o el default False ya las protege si se despliega el código).
- **P1 clip no validado** — `core/pipeline.py` (tras la descarga): valida `get_duration` y
  `os.path.getsize`; si `dur < 0.5×solicitado` o `size < 200KB` → ERROR + `return False` (entra al
  retry existente). Verificado: `py_compile` OK. **Falta desplegar a las 3 NUCs.**

**CREADO (archivos nuevos, cero riesgo — requieren revisión/compilación de Isaac):**
- **Firmware `basic-2.1`** — `esp-boton/firmware/puntazo_boton_basic_v21/puntazo_boton_basic_v21.ino`.
  Resuelve los 2 P1 de firmware en un solo OTA: porta las 3 curas WiFi ya probadas en 2led-1.0
  (escalera TX auto-curativa + sleep dinámico + `onWifiEvent` + LED congelado en auth) y añade
  **HTTP Basic Auth al OTA**. Conserva intactos el núcleo "nunca perder el pulso", la animación de
  1 LED y el `struct PendingEvent`/`PENDING_MAX=16` (cambiarlos invalida los pendientes en NVS).
  **Antes de flashear:** poner `OTA_PASS`, validar en la placa 2led con `BENCH 1` 30+ min, verificar
  `pending=0` en el heartbeat. El P3 de rollover de `millis()` se dejó documentado (benigno, cada
  49.7 días) para no meter un patrón nuevo sin compilar en un port que debe ser fiel.
- **Capa 3 salud-de-flota** — `sistema-club/fleet-health/health_probe.py` +
  `delivery_audit.py`. Módulos **standalone portables** a los 3 runners (no importan código del
  runner). `health_probe` escribe heartbeat enriquecido bajo `nuc_heartbeat/{club}.health.*`
  (aditivo, campo estrella `last_clip_published_at`); `delivery_audit` corre 23:30 y escribe
  `fleet_health/{club}/daily/{fecha}` con veredicto OK/NO_TRAFFIC/DEGRADED/SILENT_FAILURE.
  **Verificados en dry-run contra el CSV real**: health_probe leyó las 210 filas de la cola y
  extrajo `last_clip_published_at`; delivery_audit dio `NO_TRAFFIC`. Faltan: verificar nombres de
  columnas del CSV / campos de pending_pulses contra el schema real, y programar las Task Scheduler.
- **Dashboard visual** — artifact publicado (privado en claude.ai) con los 7 P1, estado por dominio,
  quick-wins y roadmap de visión.

**PENDIENTE (production-touching o decisión de Isaac — NO se tocó):**
- P1 streaming heartbeat/ACK (web + NUC), P1 fleet watchdog (redeploy del agente), P1 PAT rotación
  (irreversible). Quick-wins de web (allowlist STREAM_CLUBS, maxlength título, reglas) siguen como
  diffs a aplicar+pushear deliberadamente — el detalle exacto está en la sección de Streaming arriba.
- Desplegar los 2 fixes aplicados (visión, validación de clip) a las 3 NUCs.
- Los P2/P3 restantes de cada área.
