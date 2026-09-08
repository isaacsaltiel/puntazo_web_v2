# Worker Local IP — Onboarding Interpadel al stack Firestore (paridad BreakPoint)

## objetivo

Dejar la NUC de **Interpadel** al nivel operativo de BreakPoint para lo que el
**usuario ve en la web**, sin romper su pipeline propio (modular `core/`+`vision/`):

1. **Heartbeat** `nuc_heartbeat/Interpadel` → habilita el pill verde "sistema en
   línea" y el banner "cámaras fuera de línea" en la web.
2. **Listener `pending_pulses` (Firestore)** filtrado por club → hace que el
   **botón** (`boton.html`) funcione en Interpadel igual que en BP.
3. **Publisher `clip_states/`** → progreso por-clip.
4. Prerequisito: **saneamiento de secretos (HP-IP)** + cerrar el cruce de colas
   (`forms_csv`/`button_csv` = `""`).

NO reescribir su arquitectura modular. NO tocar visión/dashboard/watchdog (eso es
Worker J/K/N, fuera de alcance). NO migrar Forms→POST (eso es Worker M).

## contexto (lo que sabemos del audit 2026-06-03)

- IP corre arquitectura **modular divergente** (`core/` + `vision/` + `runner/`,
  ~10.7k LOC, **sin `script.py`, sin git**). NO replicar el `script.py` de BP.
- Hoy ingiere pulsos por **Forms CSV / `button_csv`** (legacy). **No tiene
  Firestore** (ni listener, ni heartbeat, ni clip_states). Solo `heartbeat.txt`
  local.
- NVR: **Hikvision DS-7604NI-Q1/4P @ 192.168.100.2**, firmware V4.83.100 b250626,
  retención **14d**. Canchas reales: **3,4,5,6** (no hay 1 ni 2).
  Mapeo cancha→canal: **3→201, 4→301, 5→101, 6→401**.
- Dropbox dest: `dropbox:/Puntazo/Locaciones/{club}/{court}/{lado}`.
- Estados internos propios PENDING/DONE/DISCARDED (no esquema R2), sin `pulses.log`.
- **Secretos en `config.json` en claro** (NVR pwd, SA JSON, tokens). Hay que
  sanear antes de exponer más.
- `BUTTON_QUEUE_CSV` apunta por error a `BP_Puntazo` (copy-paste) → cerrar.
- `LISTENER_CLUB` para IP = **`Interpadel`** (club id canónico en Firestore).

El **club id canónico es `Interpadel`** (igual que en `data/config_locations.json`
del web). Úsalo idéntico en heartbeat, listener y clip_states — case-sensitive.

---

## CONTRATOS FIRESTORE EXACTOS (lo que la web ya lee/escribe — respétalos al pie)

> Estos esquemas los define el front. Si IP escribe distinto, la web no lo ve.
> El service account de IP ya tiene permisos admin (bypassa rules).

### 1) Heartbeat — colección `nuc_heartbeat`, doc id = `Interpadel`

Escribir/actualizar **cada ~30s** mientras el runner viva:

```
nuc_heartbeat/Interpadel = {
  status:        "online",                  // string libre; BP usa "online"
  lastSeenAt:    <serverTimestamp>,         // CLAVE — la web mide staleness con esto
  pendingQueue:  <int>,                     // # de pulsos en cola sin procesar
  nvrConnected:  <bool>,                    // ping/login NVR OK
  version:       "IP-1.0.0"                 // string de versión del runner IP
}
```

- La web (`assets/heartbeat-watcher.js`) marca **offline si `lastSeenAt` > 5 min**.
  Con escribir cada 30s sobra. Lee `lastSeenAt` (o `updatedAt` como fallback).
- En el primer boot, crear el doc (`set` con merge). No requiere índice.

### 2) Pulsos — colección `pending_pulses` (la web CREA, la NUC CONSUME)

Doc que crea el web cuando alguien aprieta el botón:

```
pending_pulses/{autoId} = {
  club:           "Interpadel",
  cancha:         "Cancha3",        // o el id que mande el front
  lado:           "LadoA",
  source:         "web_boton",      // o "web_mi_partido", "upload_resumen"
  client_pulse_id:"<uuid>",
  uid_creator:    "<uid|null>",     // NO lo borres ni lo sobreescribas
  created_at:     <serverTimestamp>,
  match_id:       "<id|null>",      // presente si fue dentro de un partido
  payload_base64: "<...>"           // opcional (foto resumen, etc.)
}
```

La NUC debe:

- **Suscribirse con filtro ESTRICTO `where club == "Interpadel"`** (evita
  doble-ingesta de pulsos de otro club — riesgo real, ver audit).
- Procesar SOLO los que tengan `consumed_at == null`.
- **Replay-on-boot:** al arrancar, procesar los pendientes existentes en orden
  **FIFO por `created_at`** (no perder los que entraron mientras estaba caída).
- Al terminar OK: setear `consumed_at: <serverTimestamp>`, `consumed_by:
  "Interpadel-NUC"`. **No tocar `uid_creator`** (la web lo usa para "Mis clips").
- **NVR-window check ANTES de cortar:** si el timestamp del pulso cae fuera de la
  ventana retenida del NVR (14d), NO intentar 5 veces — marcar
  `error_reason` y `consumed_at`.
- En error, setear `error_reason` con uno de los valores que la web ya mapea a
  copy amigable (`assets/heartbeat-watcher.js` → `errorReasonText`):
  `nvr_window_exceeded`, `already_processed`, `match_not_found`,
  `base64_decode_failed`, `dropbox_upload_failed`, `match_update_failed`,
  `payload_too_large`. Otro string → la web muestra genérico (aceptable).
- Subida del clip: misma convención que hoy →
  `dropbox:/Puntazo/Locaciones/{club}/{court}/{lado}`, nombre
  `Club_Cancha_Lado_DDMMYYYY_HHMMSS.mp4`.

### 3) clip_states — colección `clip_states` (mirror del publisher de BP)

BP ya escribe aquí (297 docs, `state=visible`). Replica su esquema tal cual lo
emite BP (al menos `{ club, state }`; conserva los campos que BP ya pone —
inspecciona un doc de BP antes de escribir para no divergir). Filtra por
`club == "Interpadel"`. Esta parte es **fase 2** (no bloquea botón ni pill).

---

## alcance (en fases, cada una validada antes de la siguiente)

> Secuencia aprobada por el maestro: HP-IP → A → B+D+E0 → G → I → H.
> Las fases 1-3 son el núcleo "rechula" (botón + pill). G/I/H son fase 2.

**Fase 0 — Discovery + secretos (HP-IP)**
1. Reportar estructura real (`core/`, módulos, cómo ingiere hoy, dónde están los
   secretos). NO imprimir valores de secretos — solo nombres de archivo y si
   están en claro.
2. Sacar secretos de archivos versionables; si no hay git, al menos centralizarlos
   en un `.env`/`secrets/` fuera de cualquier cosa que se sincronice. Asegurar que
   el SA JSON NO esté en una carpeta que se suba.
3. Setear `forms_csv` y `button_csv` a `""` en el config de IP (cierra el cruce
   `BP_Puntazo`). IP no tiene flujo Forms operativo.

**Fase 1 — Firestore client + Heartbeat**
4. Integrar el SDK admin de Firestore (service account de IP) como **módulo nuevo**
   en `core/` (no tocar el pipeline existente). Conexión read/write verificada.
5. Thread daemon que escribe `nuc_heartbeat/Interpadel` cada 30s con el contrato
   de arriba. Validar en consola que el doc aparece y `lastSeenAt` avanza.

**Fase 2 — Listener `pending_pulses` (núcleo del botón)**
6. Implementar el listener con filtro `club == "Interpadel"`, replay-on-boot FIFO,
   NVR-window check, `consumed_at`/`consumed_by`/`error_reason`, sin tocar
   `uid_creator`. Puente hacia el pipeline de corte existente de IP (reusar su
   `core/` de NVR/ffmpeg; NO reimplementar el encode).
7. `pendingQueue` del heartbeat = # real de pulsos sin consumir.

**Fase 3 (opcional, fase 2 del plan) — clip_states / I / H**
8. `clip_states` publisher (mirror BP).
9. `classify_download_error` (RTSP 404 vs timeout) → `error_reason` fino.
10. `source=upload_resumen` (foto resumen) — solo si se decide activar en IP.

`F` (match_full `_PARTIDO_<id>`) queda fuera salvo que el cliente IP lo pida.

---

## fuera de alcance

- Visión-pose / `vision/` — no tocar.
- Dashboard Flask, watchdog Python, Telegram, NVR discovery → Workers K/J/N.
- Forms→POST `/trigger` (Cloudflare Tunnel) → Worker M.
- match_full (F) salvo pedido explícito del cliente.
- Cambiar el encoder/QSV de IP.
- Web (HTML/CSS/JS) — nada. Los contratos web ya existen.
- Rotar el PAT (ya hecho) o el password NVR (decisión: no se cambia).

## seguridad (no negociable)

- **NUNCA imprimir secretos** en el reporte ni en logs nuevos. Solo nombre de
  archivo + si está en claro + longitud/prefijo si hace falta.
- No publicar nada a Firestore que no sean las 3 colecciones del contrato.
- **Restart del runner SOLO con OK explícito de Isaac.** Detener por método seguro,
  levantar por el método normal de producción.
- **Pulso real de prueba SOLO con OK de Isaac.**

## validaciones

**Antes:** reportar si hay `.git`; archivos modificados; cómo ingiere pulsos hoy;
NVR alcanzable (ping/login) sin imprimir pwd; club id exacto en uso.

**Heartbeat:** confirmar doc `nuc_heartbeat/Interpadel` creado y `lastSeenAt`
avanzando cada ~30s. Verificar en la web (lado.html de Interpadel) que el pill
sale **verde** ("sistema en línea").

**Listener (dry-run primero):** con un pulso de prueba en `pending_pulses`
(club=Interpadel), confirmar: lo toma, corta del NVR, sube a Dropbox, setea
`consumed_at`/`consumed_by`, NO toca `uid_creator`. Replay-on-boot: dejar 1 pulso
sin consumir, reiniciar, confirmar que lo procesa en orden.

**Error paths:** forzar un pulso fuera de ventana NVR → confirmar
`error_reason=nvr_window_exceeded` + `consumed_at` (sin 5 reintentos).

**Restart / pulso real:** solo con OK de Isaac. Confirmar runner vivo + heartbeat
vivo + listener vivo + sin errores en el pipeline de visión existente.

## definition of done

- `nuc_heartbeat/Interpadel` latiendo (<5 min) → pill verde en web.
- `pending_pulses` (club=Interpadel) consumido end-to-end, `uid_creator` intacto,
  replay-on-boot OK, NVR-window check OK.
- Secretos saneados; `forms_csv`/`button_csv` = `""`.
- Pipeline de visión/encode de IP **intacto** (cero regresión).
- (Fase 2) clip_states reflejando BP si se llega a ello.
- El reporte deja claro qué quedó vivo y qué falta para paridad total.

## formato del reporte de regreso

```
## REPORTE IP — Onboarding Firestore

### Resumen ejecutivo
3-5 bullets.

### Discovery
- arquitectura / ingestión actual / club id / NVR alcanzable.

### Secretos (HP-IP)
- qué se saneó (sin valores). forms_csv/button_csv = "".

### Heartbeat
- doc creado / intervalo / verificado en web (pill verde sí/no).

### Listener pending_pulses
- filtro club / replay-on-boot / consumed_at/by / uid_creator intacto /
  NVR-window / error_reason.

### Fase 2 (si se tocó)
- clip_states / I / H.

### Validaciones
- dry-run / error paths / restart / pulso real.

### Riesgos / pendientes
Lista breve.

### Confirmación final
- No imprimí secretos. No toqué visión/dashboard/web. No publiqué fuera de las
  3 colecciones del contrato. Restart/pulso real solo con OK de Isaac.
```
