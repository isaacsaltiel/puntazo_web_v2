# Worker Local O — Onboarding Firestore de Interpadel: listener + resiliencia + clip_states (parity con BP/WS)

> Worker de **implementación** corriendo DENTRO de la NUC de **Interpadel**
> (`c:\Users\BreakPoint\Desktop\PUNTAZO_NEW_F1`). NO trabaja sobre el repo web.
> Coordinado por el chat maestro.
>
> **Branch base**: `master` local del repo NUC. **Depende de HP-IP**
> (`worker-local-HP-IP-secrets-saneamiento.md`) ya aplicado — IP debe estar
> versionado con `.gitignore` que proteja secretos + service account, ANTES de
> meter credenciales Firebase.
>
> Equivale a **E0 + D + G** de WellStreet, **adaptado a la arquitectura modular
> de Interpadel** (`core/`+`vision/`+`runner/`, NO el `script.py` monolítico de
> BP/WS). Deja a Interpadel a la par de BreakPoint/WellStreet: la web escribe el
> pulso directo a Firestore, la NUC lo consume, y la web ve el estado del clip.

## Objetivo

Que Interpadel **ingiera pulsos desde Firestore `pending_pulses/`** (filtrado por
`club == "Interpadel"`) y **publique `clip_states/` + heartbeat**, eliminando la
dependencia de Apps Script + CSV de Drive para los pulsos web.

Tres capas, en este orden:

1. **E0-IP (listener)**: `onSnapshot` a `pending_pulses` → encola al
   `queue_manager` de IP (aditivo; el CSV sigue vivo hasta validar).
2. **D-IP (resiliencia)**: replay-on-boot FIFO, NVR-window check pre-tx con
   `error_reason`, heartbeat `nuc_heartbeat/Interpadel` cada 30s,
   `_listener_close_with_error`.
3. **G-IP (clip_states)**: publicar el ciclo de estado del clip con el esquema
   EXACTO que la web espera (mismo que BP/WS).

Cuando esté vivo y testeado, el **maestro web** agrega `"Interpadel"` a
`FIRESTORE_CLUBS` en `assets/pulses.js` y se apaga el polling CSV.

## Contexto que ya sabemos (del audit IP 2026-06-03)

### Arquitectura real de IP (divergente — NO asumir BP/WS)

- Modular: `core/` (10 módulos) + `vision/` + `runner/`. Entry `main.py` →
  `core/main.py` (orquestador). **No hay `script.py`.**
- Ingesta hoy: Arduino serial (BTN:0..3 → cam 3..6), Forms CSV (Drive cada 60s),
  Button CSV (cada 2s), teclado, visión-pose. **Cero Firestore.**
- Cola: `core/queue_manager.py`. ⚠️ Usa estados propios PENDING/DONE/DISCARDED con
  `attempts`, `last_error`, `next_retry_at_iso` (`core/queue_manager.py:361`) —
  **NO es el esquema R2 de BP/WS.** El listener debe entregar al contrato que
  esta cola espera, NO inventar uno nuevo (replica el patrón de
  `core/sources/chain.py` / `forms_csv.py` / `button_csv.py`).
- Dispatch inmediato: `_persist_and_enqueue` despacha al worker vía
  `dispatch_pending_job_now` tras persistir (`core/sources/chain.py:88`).
- NVR: Hikvision DS-7604NI-Q1/4P, fw V4.83.100, IP 192.168.100.2.
- Mapeo cancha→canal: **3→201, 4→301, 5→101, 6→401** (IP no tiene canchas 1/2).
- Dropbox vía rclone (remote `dropbox:` — confirmar nombre).
- NO tiene firebase-admin instalado, NO tiene service account, NO tiene `.env`.

### Lado web (sin cambios hasta que O cierre)

`assets/pulses.js → requestPulse()` escribe a `pending_pulses` con este shape
cuando el club está en `FIRESTORE_CLUBS` (hoy IP NO está):

```js
{
  club: "Interpadel",              // ⚠️ confirmar el id EXACTO que manda la web
  cancha: "3",                     // dígito SOLO (no "Cancha3")
  lado: "LadoA" | null,
  source: "web_mi_partido" | "web_boton" | "web_torneo5" | "recovery" | "web",
  client_pulse_id: "PLS_W_...",
  match_id: string | null,
  uid_creator: string | null,
  created_at: serverTimestamp,
  event_at?: Timestamp,            // SOLO para source="recovery"
  consumed_at: null,
  consumed_by: null,
}
```

> ⚠️ **El id del club es crítico.** Si la web manda `"Interpadel"` y el listener
> filtra por otro string (o viceversa), los pulsos se pierden silenciosamente.
> El worker DEBE confirmar el id exacto: míralo en un match doc real de IP en
> Firestore Console (`matches/*.loc`) o en la config del Apps Script actual de IP,
> y reportarlo. NO adivinar.

### Reglas Firestore — NO hace falta tocar ninguna

- `pending_pulses` create: ya acepta cualquier `source is string` (hotfix
  2026-06-04, ruleset `d053bb2c`). El listener marca `consumed_at` vía admin SDK
  (bypasea rules).
- `clip_states/`: read público, write solo admin SDK. Ya deployada.
- `nuc_heartbeat/{clubId}`: read público, write solo admin SDK. Ya deployada.

**Cero cambios de reglas en este worker.** Si algo da `permission-denied`, es el
service account sin permisos, no la regla — reportar.

## Arquitectura relevante

- **Lenguaje**: Python modular. Replicar el patrón de `core/sources/` (cómo una
  fuente entrega a `queue_manager`), NO portar el monolito de BP/WS.
- **firebase-admin**: instalar en el venv de IP (offline-friendly — confirmar
  conectividad/pip; si no, reportar qué falta). Alternativa: `google-cloud-firestore`
  directo (que IP ya tiene parcialmente, según el audit la lib base está).
- **Service account**: usar el del proyecto `puntazo-clips` (mismo que BP/WS).
  Si no hay uno en la máquina de IP, instalarlo en `secrets/service_account.json`
  (ya gitignored por HP-IP). Verificar permisos read+update en `pending_pulses` y
  write en `clip_states`/`nuc_heartbeat` con un write de prueba ANTES de seguir.
- **Heartbeat**: doc `nuc_heartbeat/Interpadel` con `status`, `lastSeenAt`,
  `pendingQueue`, `nvrConnected`, `version`. La web muestra "sistema offline" si
  `lastSeenAt > 5min`.
- **clip_states**: la web (`assets/clip-states.js`) cruza `club/cancha/lado/ts_pulso`
  con el índice de videos. `cancha` DEBE ser el court id `"CanchaN"`, NO el dígito.

## Archivos importantes a revisar (en la NUC IP)

- `core/sources/chain.py`, `core/sources/forms_csv.py`, `core/sources/button_csv.py`
  — patrón de fuente → cola. Replicar para el source Firestore.
- `core/queue_manager.py` — contrato exacto de la cola (qué objeto/campos espera).
- `core/main.py` — dónde se registran las fuentes en el arranque.
- `core/nvr_utils.py` / `core/pipeline.py` — corte por canal (NVR-window check usa
  esto). Mapeo cancha→canal en `CONTEXTO/config.json`.
- `core/maintenance.py` — heartbeat local existente (`heartbeat.txt`); el heartbeat
  Firestore es nuevo, no reemplaza al local.

## Alcance

### Fase 0 — Prerrequisitos
- Confirmar HP-IP aplicado (git + `.gitignore` protegiendo `secrets/`).
- Instalar firebase-admin (o usar `google-cloud-firestore`). Service account en
  `secrets/service_account.json`. Write de prueba a `clip_states` para validar permisos.
- **Confirmar el id del club** que la web manda (ver ⚠️ arriba) y reportarlo.

### Fase 1 — E0-IP: listener (aditivo)
- Nuevo `core/sources/firestore_pulses.py`: `onSnapshot` a `pending_pulses`
  `where club=="Interpadel"` + `where consumed_at==null`.
- Por doc nuevo: traducir al contrato de `queue_manager` (mismo que las fuentes CSV)
  y encolar. **Filtro estricto por club** (test de aislamiento obligatorio).
- Al consumir OK: `consumed_at=serverTimestamp`, `consumed_by="Interpadel-NUC"`.
- `source=="recovery"`: usar `event_at` como anchor temporal del corte NVR.
- Registrar el source junto a los CSV existentes **sin apagarlos todavía**.

### Fase 2 — D-IP: resiliencia
- **Replay-on-boot**: al arrancar, re-leer `pending_pulses` con `consumed_at==null`
  del club, FIFO por `created_at`, y encolar (cubre pulsos llegados mientras la NUC
  estuvo caída).
- **NVR-window check pre-tx**: si `event_at` (o `created_at`) < `NOW - NVR_RETENTION_DAYS`,
  cerrar el doc con `error_reason="nvr_window_exceeded"` SIN procesar. Usar el
  retention real de IP (config — el audit reportó 14d ventana; confirmar).
- **`_listener_close_with_error(doc, reason)`**: helper para cerrar docs con error.
- **Heartbeat** `nuc_heartbeat/Interpadel` cada 30s (admin SDK).

### Fase 3 — G-IP: clip_states
- Publicar `clip_states/{clip_id}` con el esquema EXACTO de
  `worker-local-G-wellstreet-clip-states.md` (no cambiar nombres):
  `state ∈ {en_cola, visible, error, pendiente_por_conexion}`, `ts_pulso` string
  hora local naïve, `cancha="CanchaN"` (court id, NO dígito — usar el mapeo
  cancha→court de la config), `club="Interpadel"`, `lado`, `source`, `job_id`,
  `video_url=null`, `published_at`.
- Ciclo de vida: encolado→`en_cola`; sin NVR/conexión→`pendiente_por_conexion`;
  subido+indexado→`visible` (+`published_at`); falla irrecuperable→`error` (+detalle).
- Actualizar `state_updated_at` en cada transición.

### Fase 4 — Apagar CSV (solo tras validar Fases 1-3)
- Una vez confirmado que el listener procesa y publica estado correctamente,
  **desregistrar** Forms CSV + Button CSV del arranque. (Coordinar con Worker M si
  se prefiere migrar Forms→/trigger en vez de apagarlo del todo — pero para los
  **pulsos web** el listener Firestore ya los cubre.)

## Fuera de alcance

- **Cambios al repo web** (`FIRESTORE_CLUBS += Interpadel`). Lo hace el maestro
  DESPUÉS de confirmar listener vivo y testeado. NO tocar el repo web.
- **Cambios de reglas Firestore.** Ninguno hace falta (ver arriba).
- **Worker A (`pulses.log`), Worker I (`classify_download_error`), Worker H
  (`upload_resumen`)** — follow-ups separados, NO en este brief.
- **Visión-pose, dashboard, watchdog** — otros workers (K/J) / en espera.
- **Tocar el swap de canales o el pipeline FFmpeg.**
- **Apagar Arduino / teclado / visión** — siguen como fuentes válidas.

## Riesgos

- **Doble proceso entre NUCs**: si el `where` por club está mal filtrado, BP/WS e IP
  podrían procesar el mismo doc. **Filtro estricto + test de aislamiento obligatorio.**
- **Id de club equivocado**: pulsos perdidos silenciosamente. Confirmar el id real
  ANTES de Fase 1.
- **Service account ausente/sin permisos**: sin SA con write, el listener no puede
  marcar `consumed_at` ni publicar clip_states. Write de prueba antes de seguir.
- **Esquema de cola incompatible**: la cola de IP usa estados propios. Si el listener
  entrega un objeto con campos que la cola no espera, rompe el dispatch. Documentar el
  contrato exacto y respetarlo.
- **`cancha` en clip_states como dígito**: la web compara contra `match.can="CanchaN"`;
  si se escribe "3" en vez de "Cancha3", la web no hace match y no muestra estado.
- **Apagar CSV antes de validar**: ventana sin ingesta. Apagar SOLO en Fase 4, tras
  confirmar el listener.
- **Doble ingesta durante la transición**: mientras el CSV y el listener corren
  juntos, un mismo pulso podría entrar dos veces si la web ya estuviera en
  FIRESTORE_CLUBS. Por eso el flip web es lo ÚLTIMO y el CSV se apaga en Fase 4.

## Validaciones

Cada item ✅ ❌ o ⏭️ con razón:

1. **SA + permisos**: write de prueba a `clip_states` OK con el service account.
2. **Id de club confirmado**: reportar el string exacto (de un match doc real).
3. **Listener arranca**: log "Listener Interpadel arrancado".
4. **Consumo E2E**: crear doc manual en Console (`club:"Interpadel"`, `cancha:"3"`,
   `source:"web_mi_partido"`, `consumed_at:null`) → IP lo consume en ≤60s, sale el
   clip en Dropbox, doc queda con `consumed_at`+`consumed_by:"Interpadel-NUC"`.
5. **Aislamiento**: un doc con `club:"BreakPoint"` NO es tocado por IP.
6. **Replay-on-boot**: crear doc, matar la NUC antes de que consuma, reiniciar →
   el pulso se procesa al arrancar.
7. **NVR-window**: doc con `event_at = NOW-30d` → cerrado con
   `error_reason="nvr_window_exceeded"` sin intentar descargar.
8. **Heartbeat**: `nuc_heartbeat/Interpadel` se actualiza cada ~30s con `pendingQueue`.
9. **clip_states**: el doc tiene `cancha="CanchaN"` (no dígito) y `club="Interpadel"`;
   la web (resumen.html/mi-partido) muestra el estado evolucionando en_cola→visible.
10. **No regresión**: con el CSV todavía vivo (pre-Fase 4), un pulso por Forms/Arduino
    sigue procesando normal.

## Definition of done

- firebase-admin + service account operativos en IP (permisos verificados).
- Id de club confirmado y reportado.
- Listener `pending_pulses` vivo, aditivo, filtrado estricto por club.
- Resiliencia: replay-on-boot + NVR-window + heartbeat + `_listener_close_with_error`.
- `clip_states/` publicándose con el esquema exacto (cancha="CanchaN").
- CSV/Forms desregistrados (Fase 4) tras validar.
- Validaciones 1-10 documentadas.
- Branch `worker-local-O-interpadel-firestore-onboarding` con commit SHA.
- Reporte en formato `docs/workers/README.md`, con bloque **"Cambios coordinados
  que pide a la web"**: `FIRESTORE_CLUBS += "Interpadel"` en `assets/pulses.js` +
  timing (DESPUÉS del listener vivo, NUNCA antes).

## Formato del reporte de regreso

Ver `docs/workers/README.md`. Sí o sí incluir:

- **Id exacto del club** que usa IP (confirmado contra match doc real).
- **Estado del service account** (existía / se instaló / permisos verificados).
- **Contrato exacto de la cola** de IP (`file:line`).
- **Confirmación del esquema clip_states** (cancha como court id).
- Bloque "Cambios coordinados que pide a la web" con el diff de `FIRESTORE_CLUBS`
  y la condición de timing.

---

**Referencias rápidas**:
- Hermanos (origen del patrón): `worker-local-E0-wellstreet-csv-to-firestore.md`
  (listener), `worker-local-D-pulse-resilience.md` (resiliencia),
  `worker-local-G-wellstreet-clip-states.md` (clip_states, esquema exacto).
- Prerrequisito: `worker-local-HP-IP-secrets-saneamiento.md`.
- Estado consolidado: `docs/plans/nuc-state-2026-06-03.md`.
- Convención: `docs/workers/README.md`.
