# Worker Local E — Onboarding de WellStreet al pipeline Firestore (R4) + resiliencia (R6)

> Worker de **implementación** corriendo vía Claude Code DENTRO de la PC del
> club **WellStreet**, sobre el sistema local de Puntazo. NO trabaja sobre
> el repositorio web. Coordinado por el chat maestro.
>
> **Branch base**: `master` del repo local del runner NUC (mismo repo que
> el de BreakPoint, porque la base de código se comparte; verifica con
> `git log -1` cuál es el HEAD). Esta etapa NO depende del rediseño del
> jugador del repo web.
>
> **Path probable del runner**: `C:\Puntazo\runner\` (verifica con
> `dir C:\Puntazo` al arrancar). Si está en otro path, úsalo y reporta.

## Objetivo

Replicar en WellStreet **TODO** lo que la NUC de BreakPoint hace post-Worker D
(`docs/workers/worker-local-D-pulse-resilience.md`):

1. **Listener Firestore** de `pending_pulses/` escuchando `club == "WellStreet-Pickleball"`.
2. **Replay de pulsos pendientes al boot** (FIFO local por `created_at`).
3. **Check de NVR-window** pre-tx con `error_reason = "nvr_window_exceeded"` cuando el `event_at` es más viejo que la retención del NVR.
4. **Heartbeat** a `nuc_heartbeat/WellStreet-Pickleball` cada 30s con `status`, `lastSeenAt`, `pendingQueue`, `nvrConnected`, `version`.
5. **Reemplazar el flujo legacy Apps Script** para WellStreet (que HOY sigue activo vía `pulses.js` con `APPS_CLUB_MAP["WellStreet-Pickleball"] = "WellStreet - Pickleball"`).

Resultado: cuando este worker termine y el maestro web mergee el cambio a
`assets/pulses.js`, los pulsos de WellStreet dejarán de pasar por Google
Apps Script (CSV en Drive) y vivirán en el mismo pipeline robusto que
BreakPoint.

## Contexto que ya sabemos (verifica que aplique al código actual)

### Lado web (lo que escribe la web a Firestore — sin cambios vs BreakPoint)

El cliente web usa `assets/pulses.js → PuntazoPulses.requestPulse()` y, una
vez que `FIRESTORE_CLUBS` incluya `"WellStreet-Pickleball"`, escribirá en
`pending_pulses/` con este shape (idéntico a BreakPoint, solo cambia `club`):

```js
{
  club: "WellStreet-Pickleball",
  cancha: "3",                     // dígito SOLO (no "Cancha3")
  lado: "LadoA" | null,            // WellStreet hoy solo tiene LadoA por cancha
  source: "web_boton" | "web" | "recovery",
  client_pulse_id: "PLS_W_...",
  match_id: string | null,
  uid_creator: string | null,
  created_at: serverTimestamp,
  event_at?: Timestamp,            // SOLO para source="recovery"
  consumed_at: null,
  consumed_by: null,
}
```

**Reglas Firestore** (en repo web `docs/plans/firestore-rules-v100-fase3.md`):

- `pending_pulses/` create público con validación de campos; update/delete
  denegados (admin SDK bypasea, así es como la NUC marca `consumed_at`).
- `nuc_heartbeat/{clubId}`: read público, write false (admin SDK escribe).
  **CRÍTICO**: si esta regla no está deployada en la consola Firebase, el
  primer `init_nuc_heartbeat()` cae con PERMISSION_DENIED. Worker D ya
  reportó el bloque a deployar. Si arrancas y ves ese error, avisa al
  maestro web ANTES de seguir — el deploy de reglas es manual.

### Lado NUC (lo que la NUC de BreakPoint ya hace post-Worker D)

Referencia rápida al código de Worker D para saber qué replicar (líneas
aproximadas en `script.py` del runner BreakPoint, verifica con `git log`):

- `script.py:321-341` — bloque CONFIG R6 con constantes (`NVR_RETENTION_DAYS=7`, `LISTENER_CLUB`, `LISTENER_NUC_ID`, etc.)
- `script.py:2007-2049` — check NVR-window dentro de `_handle_pending_pulse` (decide consumir con `error_reason` si `event_at` está fuera de ventana).
- `script.py:2106-2130` — FIFO sort + log explícito del backlog en el REPLAY del boot.
- `script.py:2162-2181` — helper `_listener_close_with_error(doc_ref, reason)` que marca `consumed_at + error_reason` en una sola tx.
- `script.py:2353-2502` — módulo heartbeat NUC completo (init, write loop 30s con `merge=True`, `shutting_down` final).
- `script.py:4111-4117` — wire del heartbeat dentro de `main()` (start/stop).

**Idempotencia ya cubierta** por tres seams existentes (no agregues otra
capa): tx Firestore + `queue_has_external` + `reconcile_pulses_log`. El
rclone path es determinístico (`channel_id_HH-MM-SS__HH-MM-SS.mp4`), así
que un re-upload sobrescribe sin duplicar.

### Lo que NO sabemos y hay que descubrir EN SITIO

**Estas son las 5 decisiones que debes confirmar con Isaac ANTES de tocar
código.** No avances sin estas respuestas.

1. **¿NUC compartida o separada con BreakPoint?**
   - **SEPARADA** (recomendado, asumido): es una máquina física distinta,
     con su propio clone del repo runner y su propio `config.json`. Branch
     base = `master` local de esa máquina. Service account JSON puede ser
     el mismo (mismo proyecto Firebase) o uno nuevo.
   - **COMPARTIDA**: un solo runner corre 2 listeners (uno por club) como
     threads dentro del mismo `main.py`. Más simple en código pero acopla
     disponibilidad: si la NUC cae, los 2 clubs caen.
   - Pregunta a Isaac y reporta.

2. **Mapeo Cancha → Canal NVR (Hikvision) de WellStreet**:
   - WellStreet tiene Cancha1..Cancha6 (según `data/config_locations.json`
     del repo web).
   - ¿Cancha1 → canal 1? ¿O hay reorgs físicos (ej. Cancha4 → canal 7)?
   - Documenta el mapping completo en `config.json` (estructura análoga al
     de BreakPoint).

3. **NVR_RETENTION_DAYS real**: Worker D usó **7 días** para BreakPoint
   como conservador. Verifica en panel admin del Hikvision de WellStreet
   la retención real configurada. Si es ≠ 7, ajusta la constante.

4. **Credenciales NVR**: IP, puerto, usuario, password del Hikvision de
   WellStreet. Vienen del operador del club o de las notas de instalación
   que Isaac tenga.

5. **NUC ID para `consumed_by` y heartbeat doc**:
   - Worker D usa `LISTENER_NUC_ID = "BreakPoint-NUC"` (hardcoded en
     `script.py:317`). Reportado como deuda.
   - Para WellStreet sugerido: `LISTENER_NUC_ID = "WellStreet-NUC"`.
   - Si Isaac quiere UUIDs, mejor — pero hoy hardcoded es OK.

## Arquitectura relevante

- **Lenguaje**: Python.
- **Listener**: `onSnapshot` filtrado por club (igual que BreakPoint).
- **NVR**: Hikvision RTSP, rolling buffer ±90s. **NO depende de la NUC** —
  sigue grabando aunque la NUC esté apagada. Retención según config NVR.
- **Storage**: Dropbox vía rclone (path determinístico).
- **Tras upload**: dispatch al workflow `gestion_indice.yml` (GitHub Actions
  del repo web) para indexar el clip.
- **Estados clip → Firestore**: `clip_states/{clipId}` (R2). NO es lo mismo
  que `pending_pulses/`. **Fuera de scope** de esta etapa.
- **Heartbeat**: doc en `nuc_heartbeat/WellStreet-Pickleball` con
  `status ∈ {alive, shutting_down}`, `startedAt`, `lastSeenAt`,
  `pendingQueue` (count CSV vivo), `nvrConnected`, `version`.

## Archivos importantes a revisar (esperados, verifica)

- `core/main.py` o `script.py` — orquestador donde vive el listener Firestore.
  Aquí va el listener WellStreet y el setup del heartbeat.
- `config.json` — config local (NO vive en repo web). Asumida estructura:
  ```jsonc
  {
    "club": "WellStreet-Pickleball",
    "nuc_id": "WellStreet-NUC",
    "nvr": {
      "address": "192.168.x.x",
      "port": 554,
      "user": "...",
      "password": "...",
      "retention_days": 7,
      "channel_mapping": { "Cancha1": 1, "Cancha2": 2, ... }
    },
    "dropbox": { "dest_path": "/Puntazo/WellStreet/" },
    "firestore": {
      "listener_club": "WellStreet-Pickleball",
      "heartbeat_interval_s": 30
    }
  }
  ```
  Ajusta según lo que ya exista en BreakPoint y reporta diffs.
- `secrets/service_account.json` — credencial admin SDK Firebase. Si Isaac
  no tiene una nueva, usa la de BreakPoint (mismo proyecto Firebase).
- `pulses.log` — ledger append-only de la NUC. No tocar, solo verificar
  que existe y es escribible.

## Alcance

1. **Auditar el código actual del runner** en la máquina de WellStreet (si
   ya hay algo, qué tan parecido es al de BreakPoint post-D).
2. **Implementar el listener WellStreet** con TODAS las mejoras de Worker D:
   - Filtro `where("club","==","WellStreet-Pickleball")` + `consumed_at == null`.
   - Replay-on-boot con sort FIFO local por `created_at`.
   - NVR-window check pre-tx con `_listener_close_with_error`.
   - Idempotencia heredada (no agregar capa nueva).
3. **Implementar el heartbeat** a `nuc_heartbeat/WellStreet-Pickleball` con
   misma cadencia (30s) y campos que BreakPoint.
4. **Si NUC compartida**: agregar el segundo listener thread sin tocar el
   de BreakPoint. Documentar cómo aislas estado (variables, locks, etc.).
5. **Si NUC separada**: clone del repo, config nuevo, listener arrancando.
6. **Validar E2E** (lista abajo).

## Fuera de alcance

- **Cambios al repo web** — los hace el maestro web cuando reciba este
  reporte. En concreto: agregar `"WellStreet-Pickleball"` a `FIRESTORE_CLUBS`
  en `assets/pulses.js`. NO toques el repo web desde acá.
- **Migración de pulsos históricos** desde el CSV de Drive de WellStreet a
  Firestore. Fuera de scope (one-shot manual cuando el maestro decida).
- **Cambios al pipeline Apps Script**. Lo dejamos morir naturalmente
  cuando todos los clubs migren — no lo arranques de cero.
- **Cambios al flujo `clip_states/`**. Esa es la capa post-pulso, no se toca.
- **Hot-patch del bug "RTSP 404 vs TCP timeout"** que Worker D dejó como
  deuda residual en `procesar_puntazo`. Esa etapa va aparte cuando se
  programe el hot-patch.
- **Optimización de heartbeat write rate** o cambio del intervalo 30s. Si
  detectas que duplica costo (2 clubs × 30s = 5760 writes/día) anota como
  riesgo, no cambies.

## Riesgos

- **Doble procesamiento si dos NUCs escuchan el mismo club**: si por
  accidente el listener BreakPoint también acepta docs con
  `club == "WellStreet-Pickleball"` (bug en el `where`), las 2 NUCs
  procesan el mismo pulso. Asegurar filtros estrictos por club en cada
  listener. Validar con un pulso de prueba antes de prod.
- **NVR offline al primer boot del runner WellStreet**: si el listener
  arranca antes que el RTSP estabilice, los primeros pulsos pueden caer
  en el bug residual de `procesar_puntazo` (reintento eterno). El código
  Worker D ya maneja "connection" como recuperable; aceptable mientras
  no haya pulsos con event_at fuera de ventana NVR simultáneamente.
- **Service account permisos**: si Isaac descarga una credencial nueva
  para WellStreet, debe tener `read/write` a `pending_pulses/` y `write`
  a `nuc_heartbeat/{clubId}`. Verifica antes de prod tirando un write de
  prueba.
- **Heartbeat write rate**: con 2 clubs × 30s = 5760 writes/día. Dentro
  del free tier de Firestore (50k writes/día gratis) pero documentar.
- **Regla nuc_heartbeat NO deployada**: si Isaac no ha pegado la regla
  en consola Firebase desde Worker D, `init_nuc_heartbeat()` falla con
  PERMISSION_DENIED al arrancar el runner. Worker D dejó degradación
  graceful (warn + el resto sigue), pero el "DESACTIVADO" en logs es
  ruido. **Coordina con maestro ANTES del primer boot prod.**

## Validaciones

Cada item debe ser ✅ ❌ o ⏭️ (con razón) en el reporte:

1. **Listener WellStreet activo**: el runner publica en logs "Listener
   WellStreet-Pickleball arrancado escuchando pending_pulses".
2. **Replay-on-boot**: apagar runner, desde web tocar
   `/boton.html?loc=WellStreet-Pickleball&can=Cancha1` (con sesión
   logueada). Arrancar runner. → El doc viejo se consume en ≤60s y el
   clip aparece en Dropbox/`Puntazo/WellStreet/`.
3. **Recovery con NUC apagada**: desde `/recuperar.html` elegir WellStreet
   → cancha → tiempo "-1h". Apagar runner ANTES. Encender DESPUÉS. → Clip
   con anchor en `event_at` aparece en Dropbox.
4. **Pulso fuera de ventana NVR**: simular pulso con `event_at` hace 8
   días (manipula Firestore consola o helper de testing). Listener cierra
   doc con `consumed_at` + `error_reason = "nvr_window_exceeded"`. NO
   intenta download.
5. **Heartbeat publicando**: doc `nuc_heartbeat/WellStreet-Pickleball`
   aparece en consola Firestore con `lastSeenAt` actualizándose cada 30s
   (verifica con 3 lecturas espaciadas).
6. **Kill brutal mid-upload**: durante un upload activo, `kill -9` del
   proceso runner. Reiniciar. → El clip NO se duplica en Dropbox (rclone
   path determinístico + queue_has_external lo evitan).
7. **Aislamiento BreakPoint vs WellStreet**: enviar 1 pulso a BreakPoint
   y 1 a WellStreet casi simultáneos (separados ≤2s). Verificar que cada
   NUC procesa SOLO el suyo (los logs lo confirman; los docs consumidos
   tienen `consumed_by` correcto por club).

## Definition of done

- Listener vivo escuchando `WellStreet-Pickleball`.
- Heartbeat publicando a `nuc_heartbeat/WellStreet-Pickleball`.
- Validaciones 1-7 con status documentado.
- Branch `worker-local-E-wellstreet-onboarding` pusheada (o local si la
  máquina no tiene remote — el maestro pull-ea del filesystem).
- Reporte entregado en el formato del README, INCLUYENDO sección
  "Cambios coordinados que pide a la web" con:
  - Qué cambio exacto debe hacer el maestro web en `assets/pulses.js`
    (line + diff).
  - **Cuándo** debe hacerlo (recomendación con razón: ¿ANTES del primer
    arranque del runner WellStreet o DESPUÉS? Si ANTES, la web va a
    escribir a Firestore pulsos que nadie procesa hasta que el runner
    esté listo; si DESPUÉS, hay riesgo de window de docs que se quedan
    en Apps Script. Decide con criterio y justifica.)

## Formato del reporte de regreso

Ver `docs/workers/README.md` (sección "Formato del reporte de regreso").
Sí o sí incluir además de lo estándar:

- **Si NUC compartida o separada** (decisión final tomada con Isaac).
- **IP/puerto NVR confirmados** (en `config.json` real, NO inline en el
  reporte — solo confirma que están bien).
- **Channel mapping confirmado** (Cancha → canal NVR).
- **NVR retention real** (días que el Hikvision retiene en disco).
- **Estado de la regla `nuc_heartbeat/{clubId}` al momento de testear**:
  ya estaba deployada (✅) o falló con PERMISSION_DENIED (❌). Si falló,
  qué tan graceful fue la degradación observada.
- **Bloque "Cambios coordinados que pide a la web"** con el diff exacto
  + recomendación de timing (ANTES o DESPUÉS del primer arranque del
  runner WellStreet).

---

**Referencias rápidas para el worker**:

- Brief de la etapa hermana (BreakPoint): `docs/workers/worker-local-D-pulse-resilience.md` (mismo repo).
- Reglas Firestore propuestas: `docs/plans/firestore-rules-v100-fase3.md` (mismo repo).
- Convención workers: `docs/workers/README.md` (mismo repo).
- Repo web (solo lectura desde la NUC):
  https://github.com/isaacsaltiel/puntazo_web_v2
