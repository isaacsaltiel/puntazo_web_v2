# Worker Local E-0 — Migrar el runner de WellStreet de CSV/Forms a Firestore (pre-requisito de E)

> Worker de **implementación** corriendo vía Claude Code DENTRO de la PC del
> club **WellStreet**, sobre el sistema local de Puntazo. NO trabaja sobre el
> repositorio web. Coordinado por el chat maestro.
>
> **Por qué existe esta etapa**: el brief E
> (`docs/workers/worker-local-E-wellstreet-onboarding.md`) asumía que WellStreet
> ya tenía base Firestore para "portar Worker D". El reporte E demostró que NO:
> el runner de WellStreet ingiere por **CSV/Forms + Arduino serial**, cero
> referencias a Firestore. E quedó **bloqueada**. E-0 construye la base que E
> necesita. Cuando E-0 cierre, se ejecuta E (resiliencia) sobre esta base.
>
> **Path real del runner** (confirmado por reporte E): no es `C:\Puntazo\runner\`.
> Es `C:\Users\WellStreet\Desktop\Puntazo-release`. **NO es repo git** (`.git`
> ausente). Verifica al arrancar con `dir`.
>
> **Branch base**: el repo NO está versionado. **Primera tarea: `git init` +
> commit inicial del estado actual** (ver Alcance 0), luego branch
> `worker-local-E0-wellstreet-csv-to-firestore`. Si Isaac prefiere no versionar
> la máquina, reporta y trabaja sin branch (maestro pull-ea del filesystem).

## Objetivo

Que el runner de WellStreet **ingiera pulsos desde Firestore `pending_pulses/`**
(filtrado por `club == "WellStreet-Pickleball"`) **en paralelo** a su ingesta
CSV actual, sin romper el path CSV mientras la web siga enrutando por él.

Resultado: una vez que este worker confirme listener Firestore vivo y procesando,
el maestro web podrá agregar `"WellStreet-Pickleball"` a `FIRESTORE_CLUBS` en
`assets/pulses.js` y los pulsos web dejarán de ir a Apps Script. **El listener
nuevo es aditivo** — el Arduino/Forms CSV sigue funcionando hasta que se decida
apagarlo (fuera de scope).

E-0 **NO** implementa resiliencia (replay-on-boot, NVR-window, heartbeat). Eso
es Worker E, que corre después. E-0 solo construye el canal de ingesta Firestore.

## Contexto que ya sabemos (del reporte E, verifica que siga aplicando)

### Arquitectura real del runner WellStreet (confirmada)

- Ingesta hoy: `core/sources/forms_csv.py` + `core/sources/button_csv.py`
  (CSV/Forms) + Arduino serial. **Cero** Firestore/firebase/pending_pulses.
- Cola interna: `core/queue_manager.py`.
- NVR: Hikvision @ `192.168.33.4`, rtsp_port 554, ISAPI. Acceso vía
  `core/nvr_utils.py` (`/Streaming/tracks/`).
- Mapeo Cancha→canal en `config.json`: Cancha1→101, Cancha2→201, Cancha3→301,
  Cancha4→401, **Cancha5→601, Cancha6→501** (los dos últimos invertidos respecto
  a la secuencia; ver Riesgos — confirmar antes de prod, NO lo cambies sin OK).
- Storage: Dropbox vía rclone (path determinístico).
- `config.json` contiene secretos en claro (PAT + password). **NO lo toques en
  esta etapa** — hay un hot-patch separado
  (`worker-local-HP-wellstreet-config-secrets.md`) para eso. Solo léelo para los
  campos que necesites (mapeo de canales, IP NVR).

### Lado web (sin cambios hasta que E-0 cierre)

El cliente web (`assets/pulses.js → requestPulse()`) escribe a `pending_pulses/`
con este shape cuando el club está en `FIRESTORE_CLUBS` (hoy solo BreakPoint):

```js
{
  club: "WellStreet-Pickleball",
  cancha: "3",                     // dígito SOLO (no "Cancha3")
  lado: "LadoA" | null,
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

**Reglas Firestore**: `pending_pulses/` create público con validación; update/delete
denegados (admin SDK bypasea). El listener marca `consumed_at` vía service account.

## Referencia obligatoria: cómo lo hizo BreakPoint

`docs/workers/worker-local-D-pulse-resilience.md` describe el sistema BreakPoint
post-Worker D. **BreakPoint ya tenía base Firestore** (R4), por eso D solo agregó
resiliencia. WellStreet NO la tiene, así que E-0 = la parte R4 que BreakPoint ya
había hecho antes de D. Mira en el runner de BreakPoint (si tienes acceso al
código compartido) el módulo que hace `onSnapshot` a `pending_pulses` y el seam
que mete el doc a la cola — eso es lo que replicas aquí. Si NO tienes acceso al
código de BreakPoint desde la máquina de WellStreet, repórtalo: el maestro te
pasará el snippet relevante.

## Archivos importantes a revisar (verifica nombres reales)

- `core/sources/forms_csv.py`, `core/sources/button_csv.py` — patrón de cómo una
  fuente mete pulsos a la cola. **Replica este patrón** para el source Firestore;
  NO inventes un mecanismo nuevo de encolado.
- `core/queue_manager.py` — la cola a la que tu listener debe entregar.
- `core/nvr_utils.py` — NO lo toques (E lo usará). Solo confirma que el corte por
  canal funciona con el mapeo del config.
- `config.json` — solo lectura (mapeo canales, IP NVR). Secretos = hot-patch aparte.
- `secrets/service_account.json` (o equivalente) — credencial admin SDK Firebase.
  Si WellStreet no tiene una, usa la de BreakPoint (mismo proyecto Firebase). Si
  no hay ninguna en la máquina, **bloquea y pide a Isaac** — sin SA no hay listener.

## Alcance

### 0. Versionado (primero)

- `git init` en `C:\Users\WellStreet\Desktop\Puntazo-release`, `.gitignore` que
  excluya `config.json`, `secrets/`, logs y artefactos. Commit inicial "estado
  pre-E0". Luego branch `worker-local-E0-wellstreet-csv-to-firestore`.
- Si Isaac NO quiere versionar la máquina: reporta y trabaja sin branch.

### 1. Auditoría (SIN cambiar código)

- ¿Dónde y cómo `forms_csv.py`/`button_csv.py` entregan a `queue_manager`? Doc el
  contrato exacto (qué objeto/campos espera la cola) con `file:line`.
- ¿Hay alguna dependencia de Firebase admin SDK ya instalada (`firebase-admin` en
  el venv/requirements)? Si no, qué falta para instalarla offline-friendly.
- ¿Existe service account accesible? ¿Con permisos a `pending_pulses` read +
  update?
- ¿Cómo arranca el runner (`main.py`? servicio? tarea programada)? Dónde se
  registran las fuentes de ingesta.

### 2. Implementar el source Firestore (aditivo)

- Nuevo módulo `core/sources/firestore_pulses.py` (o el nombre que case con la
  convención de `sources/`): `onSnapshot` a `pending_pulses` con
  `where("club","==","WellStreet-Pickleball")` + `where("consumed_at","==",null)`.
- Por cada doc nuevo: traducir al objeto que `queue_manager` espera (mismo
  contrato que las fuentes CSV) y encolar. **Filtra estrictamente por club** — no
  proceses docs de otros clubs (riesgo de doble proceso).
- Al consumir con éxito: marcar `consumed_at: serverTimestamp()`,
  `consumed_by: "WellStreet-NUC"` (hardcoded por ahora, consistente con la deuda
  de Worker D `LISTENER_NUC_ID`).
- Manejo de `source: "recovery"`: usar `event_at` como anchor temporal del corte
  NVR (en lugar de `created_at`), igual que BreakPoint.
- Registrar el source nuevo junto a los CSV existentes en el arranque del runner,
  **sin tocar ni desactivar los CSV**.

### 3. Validación E2E (mínima — la resiliencia completa la valida E)

- Listener arranca y loguea "Listener WellStreet-Pickleball arrancado".
- Con el runner corriendo: manipular Firestore (consola) para crear un doc
  `pending_pulses` con `club:"WellStreet-Pickleball"`, `cancha:"1"`,
  `source:"web_boton"`, `consumed_at:null`. → El runner lo consume en ≤60s, sale
  el clip en `Puntazo/WellStreet/` de Dropbox, y el doc queda con `consumed_at` +
  `consumed_by:"WellStreet-NUC"`.
- Aislamiento: un doc con `club:"BreakPoint"` NO debe ser tocado por este runner.

## Fuera de alcance (NO toques)

- **Resiliencia**: replay-on-boot, NVR-window check, heartbeat, idempotencia
  avanzada. Todo eso es **Worker E**, corre después de E-0.
- **Apagar el path CSV/Arduino**. Sigue vivo. Migración de doble-ingesta a
  single-ingesta es decisión futura del maestro.
- **Cambios al repo web** (`assets/pulses.js`). Los hace el maestro web DESPUÉS de
  que confirmes listener vivo. NO toques el repo web.
- **Secretos en `config.json`**. Hot-patch aparte
  (`worker-local-HP-wellstreet-config-secrets.md`).
- **Swap de canales Cancha5/Cancha6**. Solo confirmar/reportar, no cambiar.
- **`clip_states/` (R2)** y **migración de CSV histórico** a Firestore.

## Riesgos

- **Doble ingesta web**: mientras la web NO esté en `FIRESTORE_CLUBS` para
  WellStreet, los pulsos web siguen yendo por Apps Script. Tu listener solo verá
  docs creados manualmente en consola (para testear) o cuando el maestro flipee la
  web. Es esperado: E-0 prepara el canal; la web se conecta al final.
- **Doble proceso entre NUCs**: si el código compartido hace que el runner de
  BreakPoint también escuche WellStreet (o viceversa) por un `where` mal filtrado,
  dos máquinas procesan el mismo doc. Filtro estricto por club + test de
  aislamiento obligatorio.
- **Service account ausente o sin permisos**: sin SA con write a `pending_pulses`,
  el listener no puede marcar `consumed_at`. Verifica con un write de prueba antes
  de declarar done.
- **Swap de canales 601/501**: si Cancha5/Cancha6 están invertidos por error (no
  por cableado), un clip saldría de la cancha equivocada. Confirmar con quien
  cableó ANTES de prod. No lo cambies tú.

## Definition of done

- Runner versionado (o reportado por qué no).
- Auditoría con `file:line` del contrato cola + estado del service account.
- `core/sources/firestore_pulses.py` (o equivalente) vivo, escuchando
  `WellStreet-Pickleball`, aditivo al CSV.
- Test E2E: doc manual en consola → clip en Dropbox + `consumed_at`/`consumed_by`.
- Test de aislamiento BreakPoint vs WellStreet.
- Reporte en formato README, incluyendo bloque "Cambios coordinados que pide a la
  web" con el diff de `FIRESTORE_CLUBS` y la condición de timing (ver abajo).

## Formato del reporte de regreso

Ver `docs/workers/README.md`. Además, sí o sí:

- **Estado del service account**: existe / faltaba / se reusó el de BreakPoint.
- **Contrato exacto de la cola** (qué espera `queue_manager`).
- **Confirmación del mapeo de canales** (y si el swap 601/501 es intencional).
- **Bloque "Cambios coordinados que pide a la web"**: diff exacto en
  `assets/pulses.js` (`FIRESTORE_CLUBS += "WellStreet-Pickleball"`) + recomendación
  de timing. Recomendación esperada: **DESPUÉS** de que el listener esté vivo y
  testeado, NUNCA antes (si no, pulsos web a Firestore sin consumidor = pérdida).
- **Si quedó listo para Worker E**: confirma que la base R4 está completa para que
  E agregue resiliencia encima.

---

**Referencias rápidas**:
- Etapa hermana (resiliencia, corre después): `docs/workers/worker-local-E-wellstreet-onboarding.md`.
- Base BreakPoint (qué se replica): `docs/workers/worker-local-D-pulse-resilience.md`.
- Reglas Firestore: `docs/plans/firestore-rules-v100-fase3.md`.
- Hot-patch de secretos (paralelo, otro worker): `docs/workers/worker-local-HP-wellstreet-config-secrets.md`.
- Convención: `docs/workers/README.md`.
- Repo web (solo lectura): https://github.com/isaacsaltiel/puntazo_web_v2
