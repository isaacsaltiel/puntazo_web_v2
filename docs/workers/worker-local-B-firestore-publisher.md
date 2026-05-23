# Worker Local B — Publisher de estados a Firestore (R2)

> Worker de **implementación** corriendo vía Claude Code DENTRO de la PC del
> club (NUC, BreakPoint), sobre el sistema local de Puntazo en
> `C:\Puntazo\runner\`. NO trabaja sobre el repositorio web. Es la implementación
> de R2: enganchar las transiciones de estado del sistema local con Firestore
> para que la web pueda mostrar el ciclo de vida del clip en tiempo real.
> Coordinado por el chat maestro.

## Objetivo

Enganchar `set_state()` (ya implementado por Worker A en R1) con **Firebase
Firestore** para publicar las transiciones de estado del clip. La web (etapa
web futura R3) leerá esa colección y mostrará al jugador "Puntazo registrado",
"Clip listo", "Pendiente por conexión", etc.

R2 es el puente entre lo que el sistema local YA SABE (el ciclo de vida del
clip en disco) y lo que la web TIENE QUE MOSTRAR. Sin R2 los estados existen
pero solo viven en el CSV local de la NUC.

**No reescribas la lógica de estados.** Worker A ya definió el enum, las
transiciones, el seam (`set_state()` con un comentario explícito
`# Worker B engancha AQUI...`), y la durabilidad anti-crash (`pulses.log`).
Tu trabajo es **agregar la publicación a Firestore** sobre ese seam, sin
romper nada de R1.

## Contexto post-R1 (lo que Worker A dejó listo)

- **Repo git local** en `C:\Puntazo\runner\.git\` (3 commits, sin remoto).
  Empieza haciendo `git log --oneline -5` para confirmar que ves los commits
  de Worker A. Tu trabajo va encima.
- **`set_state(clip_id, new_state, detail="")`** existe en `script.py`. Actualiza
  el CSV bajo `QUEUE_CSV_LOCK`. Es defensiva (try/except interno). Tiene un
  comentario `# Worker B engancha AQUI la publicación a Firestore` JUSTO
  después del `_write_queue_rows` bajo el lock. **Ese es tu punto de inserción.**
- **`clip_id`** es estable y único por clip (= `pulse_id` del primer pulso de
  la cadena). Sirve como **doc id** en Firestore.
- **CSV vivo** tiene 22 columnas. Las 5 nuevas de R1: `clip_id`, `state`,
  `state_updated_at`, `state_detail`, `published_at`. La columna `published_at`
  es TUYA — déjala vacía hasta confirmar el write a Firestore, luego rellénala
  con ISO de cuando Firestore confirmó.
- **10 estados** definidos: `pulso_registrado → en_cola → esperando_nvr →
  recuperando_video → procesando → publicando_indice → visible`, más `error`
  y `pendiente_por_conexion`.
- **`pulses.log`** (append-only ledger) existe y es la red durable. NO la
  toques. Tu publicación es ortogonal.
- **STOP.flag presente** ahora. Sistema detenido a propósito. Edita con el
  sistema parado.
- **`secrets/`** existe en `C:\Puntazo\runner\secrets\` con el service account
  JSON de Firebase que Isaac descargó. Está en `.gitignore` del repo local.
- **Pipeline midió ~4 min punta a punta** post-R1. La publicación a Firestore
  NO debe agregar latencia perceptible al camino caliente del pulso.

## Decisiones macro ya tomadas (no las cuestiones, impleméntalas)

### 1. Granularidad de publicación: 4 estados terminales/intermedio

De los 10 estados del enum, **solo se publican estos 4** a Firestore:

- `en_cola` — "tu puntazo se registró, está en cola"
- `visible` — "tu clip está listo"
- `error` — "hubo un problema procesando tu clip"
- `pendiente_por_conexion` — "se reintentará cuando vuelva la conexión"

Los estados intermedios (`esperando_nvr`, `recuperando_video`, `procesando`,
`publicando_indice`, `pulso_registrado`) NO publican. Razón: minimizar writes
a Firestore (costo + latencia) y mantener la UX honesta sin spam. El
jugador ve "registrado" → "listo" (o "error"/"pendiente").

**Implementación**: define `PUBLISHED_STATES = {"en_cola", "visible", "error",
"pendiente_por_conexion"}` como constante en script.py. El hook después de
`_write_queue_rows` filtra por este set ANTES de encolar en la cola de
publicación.

### 2. Doc id = `clip_id`, colección = `clip_states`

```
clip_states/{clip_id}
```

`clip_id` es el id estable que Worker A definió. Una sola entrada por clip,
**update sobre el mismo doc** en transiciones posteriores (no doc nuevo cada
vez). Firestore `.set(merge=True)` o `.set()` con el doc completo — tú decides
basándote en simplicidad. Recomendado: `set()` con doc completo, es atómico
y el doc es pequeño (~12 campos).

### 3. Schema del doc (campos obligatorios)

```python
{
  "clip_id":          str,          # = doc id, también dentro
  "state":            str,          # ∈ PUBLISHED_STATES
  "state_detail":     str,          # libre, ej "MAX intentos", "NVR caído"
  "state_updated_at": SERVER_TS,    # firestore.SERVER_TIMESTAMP
  "ts_pulso":         str,          # ISO del pulso original (ej "2026-05-22T16:49:54")
  "club":             str,          # ej "BreakPoint"
  "cancha":           str,          # ej "Cancha1"
  "lado":             str,          # ej "LadoA"
  "source":           str,          # ∈ {"pulse","button","form","manual"}
  "job_id":           str,          # el job_id del CSV (no es doc id, pero útil para debug)
  "video_url":        str | None,   # poblado SOLO cuando state == "visible"
  "published_at":     SERVER_TS,    # cuando Firestore confirmó este write
}
```

**`video_url`**: cuando `state == "visible"`, debe contener la URL pública del
clip (la misma que aparece en el índice JSON que la web consume hoy). El CSV
ya tiene esa info en algún campo (Worker A debe haber escrito algo cuando
`queue_mark_done` corre — revisa). Si no está, derívala de las constantes:
`https://www.dropbox.com/...` o el path del workflow dispatch — usa lo que
`script.py` ya conoce. Si no se puede derivar trivialmente, déjalo `None` y
documenta el gap (la web puede fallback al índice JSON).

**Para `club`/`cancha`/`lado`**: vienen de la fila del CSV (mapeo
`camera_key → club/cancha/lado` que `script.py` ya hace).

### 4. Asincronía: cola in-memory + thread daemon

**El call a `set_state()` NUNCA debe esperar a Firestore.** Si la red está
lenta o caída, `set_state` debe completar en milisegundos.

Patrón:

- `STATE_PUBLISH_QUEUE = queue.Queue()` global.
- En el seam después de `_write_queue_rows`: si `new_state in PUBLISHED_STATES`,
  construye el payload (leyendo la fila ACTUALIZADA del CSV — el write ya
  ocurrió, las 22 columnas están con los valores nuevos) y haz
  `STATE_PUBLISH_QUEUE.put_nowait(payload)`. Si la cola está llena (define
  maxsize=1000), log warning y descarta (el estado SÍ vive en CSV; lo
  perdido es solo la publicación en tiempo real — el republish del arranque
  lo recoge).
- `state_publisher_thread()`: daemon thread arrancado en `main()`. Loop:
  `payload = STATE_PUBLISH_QUEUE.get()` → intenta `db.collection("clip_states").
  document(clip_id).set(payload)` → si éxito, escribe `published_at` ISO en
  el CSV (set_state ya escribió la transición; este write es solo la marca de
  "Firestore confirmó"). Si falla, backoff exponencial (1s → 2s → 4s → 8s → 16s,
  cap a 60s) y reencolar. **Nunca descartar un payload por error de red.**

**Por qué cola + thread y no `asyncio`**: el resto del sistema es threads
sincrónicos. Mantener consistencia. Es ~50 líneas total.

### 5. Republish al arranque (cubre la pérdida de cola in-memory en crash)

En `main()`, después de `reconcile_pulses_log()` (de Worker A), llama
`republish_state_on_startup()`:

- Escanea el CSV vivo.
- Para cada fila cuyo `state ∈ PUBLISHED_STATES` Y (`state` no-terminal,
  o `state_updated_at` dentro de las últimas 24 h): construye el payload y
  encólalo. Eso re-sincroniza Firestore con la realidad local después de
  cualquier downtime.
- Log: `📤 republish_state_on_startup: N publicaciones encoladas`.

Esto es cheap porque el CSV vivo post-poda tiene ~69 filas en operación normal.

### 6. Credenciales (service account)

Isaac dejó el JSON del service account en `C:\Puntazo\runner\secrets\`.

- Al arrancar, escanea el directorio `secrets\` por archivos `*.json`.
- Para cada uno, intenta parsearlo y verifica que `type == "service_account"`
  y `project_id == "puntazo-clips"`.
- Si encuentras **exactamente uno** válido: úsalo, log
  `🔑 Service account: <filename> (project=puntazo-clips, sa=<client_email>)`.
- Si encuentras **cero**: log error claro, NO arranques el thread publisher,
  el resto del sistema sigue corriendo normal (set_state local sigue
  funcionando, los estados se quedan en CSV — degradación graceful).
- Si encuentras **más de uno** válido: log error pidiendo a Isaac que aclare
  cuál, mismo comportamiento (no arrancar publisher).
- **NO imprimas el contenido del JSON** ni el `private_key`. Solo `client_email`.

Usa `google.cloud.firestore.Client.from_service_account_json(path)` o el
equivalente con `google.oauth2.service_account.Credentials.from_service_account_file`.
Lo más simple. **No** uses Firebase Admin SDK — solo necesitas Firestore.

### 7. Dependencias

`google-cloud-firestore` no está instalado en Python 3.14 de la NUC.

- Identifica el `python.exe` que el runner usa (el de `%LOCALAPPDATA%\Python\`
  según la auditoría — confírmalo con `where.exe python` o leyendo el `.bat`).
- Pídele OK a Isaac antes de instalar.
- Instala con `<python.exe> -m pip install google-cloud-firestore`.
- Después de instalar, prueba `<python.exe> -c "from google.cloud import
  firestore; print(firestore.__version__)"` para confirmar.

Si la instalación falla por compatibilidad con Python 3.14 (es muy nuevo),
reporta el error EXACTO a Isaac y para. NO improvises con versiones
alternativas.

## PROTOCOLO DE SEGURIDAD (igual que Worker A — inviolable)

1. **El repo git local ya existe.** Empieza con `git status` para confirmar
   que el árbol está limpio en `C:\Puntazo\runner\` y que ves los commits
   de Worker A. Tu trabajo agrega commits encima.
2. **Backups adicionales antes de editar**: `script.py.bak-publisher-AAAAMMDD`
   (el suffix `-publisher` lo distingue del backup de Worker A).
3. **Sistema detenido durante las ediciones**: `STOP.flag` debe seguir
   presente. NO edites con el runner corriendo.
4. **Watchdog**: ya tiene P11 cerrado de Worker A, pero igual: si tu ventana
   tiene "PUNTAZO" como título exacto, podría ser candidata. Confirma con
   Isaac si necesitas detener el watchdog mientras trabajas.
5. **Trabajo incremental**: instalación de la dependencia → cliente Firestore
   conectado y autenticado (test mínimo) → un publish manual de prueba →
   thread publisher → republish al arranque → integración con `set_state()`.
   Valida cada pieza antes de la siguiente.
6. **Isaac está físicamente en la NUC contigo.** Cualquier acción con efecto:
   explícala y pide OK antes. En particular: arrancar el runner es una acción
   con efecto (ahora que tu código hace writes a Firestore).
7. **Si algo se rompe**: revierte desde git o desde el `.bak`. No improvises
   sobre un sistema roto.
8. **No `git push`**: el repo local sigue siendo solo local. No le agregues
   remoto.
9. **NO imprimas secretos**: ni el contenido del service account JSON, ni
   `private_key`, ni `private_key_id`. `client_email` SÍ se puede loguear.
10. **No toques** las credenciales del NVR ni el PAT de GitHub. Fuera de
    scope.

## Alcance R2 — qué implementar

### 1. Módulo nuevo (recomendado) o función nueva en script.py

Decisión tuya — lo más simple. Si haces módulo aparte (`firestore_publisher.py`
en `C:\Puntazo\runner\`), expónlo como `init_publisher()`, `publish_state(payload)`,
`republish_state_on_startup()`. Si lo metes inline en `script.py`, agrupa
todas las funciones del publisher juntas con un banner `# === FIRESTORE PUBLISHER (R2) ===`.

### 2. Constantes nuevas en script.py

```python
PUBLISHED_STATES = {"en_cola", "visible", "error", "pendiente_por_conexion"}
PUBLISHER_QUEUE_MAXSIZE = 1000
PUBLISHER_BACKOFF_INITIAL_SEC = 1
PUBLISHER_BACKOFF_CAP_SEC = 60
PUBLISHER_REPUBLISH_RECENT_HOURS = 24
SECRETS_DIR = os.path.join(BASE_DIR, "secrets")
FIRESTORE_COLLECTION = "clip_states"
FIRESTORE_PROJECT_ID = "puntazo-clips"
```

### 3. Inicialización (`init_publisher()` o equivalente)

- Carga el service account de `secrets/`.
- Crea `firestore.Client(credentials=..., project=FIRESTORE_PROJECT_ID)`.
- Hace un read de prueba muy barato (ej. `client.collection("clip_states").
  limit(1).get()`) para confirmar conectividad y permisos. Si falla, log
  detallado y NO arranca el thread (degradación graceful).
- Arranca el thread daemon `state_publisher_thread`.
- Programa `republish_state_on_startup()`.

### 4. Hook en `set_state()`

JUSTO DESPUÉS del `_write_queue_rows` (bajo el lock — leer la fila actualizada
ahí ES seguro porque ya está escrita), construye el payload si
`new_state in PUBLISHED_STATES` y haz `STATE_PUBLISH_QUEUE.put_nowait(...)`.
**Fuera del bloque del lock** preferiblemente, pero `put_nowait` es no-bloqueante,
así que dentro del lock también es seguro — usa lo que sea más legible.

### 5. `published_at` write-back

Cuando el thread publisher confirme un write a Firestore, debe escribir
`published_at = ISO now()` en la fila del CSV correspondiente. Reutiliza
`_write_queue_rows` bajo `QUEUE_CSV_LOCK`. Idempotente — si ya tiene valor,
sobreescribe (el último write a Firestore es el que vale).

Si el publisher falla `published_at` queda vacío → próximo arranque, el
republish lo detecta y reintenta. Self-healing.

### 6. Reglas de Firestore (las pega Isaac, no tú)

En tu reporte, **propón** las reglas para `clip_states/` que el chat maestro
le pasará a Isaac para que las pegue en Firebase Console. El estilo del
proyecto es "analytics" (catch-all denegado al final). Tu propuesta debe
ir ANTES del catch-all. Sugerencia:

```
match /clip_states/{clipId} {
  // Read público: la web (estática + clientes anónimos) lee estados.
  // La granularidad fina (mostrar solo a "tu usuario") se hace en la web
  // cruzando contra matches/ por timestamp.
  allow read: if true;
  // Write: solo desde service account (Firestore SDK con SA bypassa rules).
  allow write: if false;
}
```

Si tienes una razón para proponer algo más estricto (ej. read autenticado
solamente), justifícalo en el reporte — el maestro decide.

## Tests de validación (mínimo lo que debes correr y reportar evidencia)

Numerados y observables. Marca cada uno PASS/FAIL en el reporte.

1. **Repo git limpio + backup**: `git status` clean al arrancar. `script.py.bak-publisher-AAAAMMDD`
   creado antes de la primera edición.

2. **Dependencia instalada**: `<python.exe> -c "from google.cloud import
   firestore; print(firestore.__version__)"` imprime versión sin error.

3. **Service account detectado**: arranque del módulo (puedes hacer un
   pequeño script de test sin tocar `script.py`): log
   `🔑 Service account: <filename> (sa=<client_email>)` con `client_email`
   reconocible (algo como `*@puntazo-clips.iam.gserviceaccount.com`).

4. **Conectividad Firestore**: el read de prueba en `init_publisher()` retorna
   sin error. Si las reglas todavía no permiten read (porque Isaac no las ha
   pegado), espera que falle con un permission_denied específico — repórtalo,
   no es bug tuyo.

5. **Publish manual de prueba**: script de un solo uso (`test_publish.py` en
   un dir temporal, NO en runner/) que cargue el SA y publique un doc de
   prueba `clip_states/TEST_WORKER_B_AAAAMMDD` con state=`error`,
   state_detail="prueba worker B, ignorar". Confirma con Isaac que se puede
   ver en Firebase Console. Después bórralo (`db.collection("clip_states").
   document("TEST_WORKER_B_AAAAMMDD").delete()`).

6. **Hook integrado**: con `STOP.flag` presente, dispara `set_state("PLS_TEST_HOOK_AAAAMMDD",
   "en_cola", "test integrado")` desde un script one-off que importe el módulo.
   Verifica: (a) el doc aparece en Firestore. (b) la cola in-memory quedó vacía
   tras el publish. (c) el log dice algo como `📤 publish OK clip=PLS_TEST_HOOK
   state=en_cola`. Después bórralo de Firestore.

7. **Backoff con red simulada**: ESTO ES OPCIONAL — solo si tienes manera segura
   de simular "Firestore no alcanzable" sin tirar la red del club. Una forma
   barata: monkey-patch temporal del cliente para que lance `Exception("fake
   net fail")` 3 veces y luego pase. Observa que: (a) la cola NO descarta
   el payload, (b) backoff escala 1s→2s→4s, (c) al 4º intento el publish
   triunfa. Si no es fácil de simular, omítelo y reporta "no probado, lógica
   inspeccionable en código".

8. **Republish al arranque**: con el sistema detenido y unas pocas filas en
   estados publicables en el CSV vivo, arranca el publisher de prueba (NO el
   runner completo). Verifica que `republish_state_on_startup` log dice
   `📤 republish: N publicaciones encoladas` y N coincide con lo esperado.
   Borra los docs de prueba después si fueron de prueba.

9. **Pipeline completo en vivo (CON OK DE ISAAC)**: si Isaac aprueba, quita
   `STOP.flag`, dispara un pulso real (tecla 1, Cancha 1 vacía) y observa
   en Firebase Console: el doc `clip_states/<clip_id>` aparece con
   `state=en_cola` casi al instante del pulso, luego se actualiza a
   `state=visible` cuando el clip llega a Dropbox. Mide latencia
   pulso→Firestore-en_cola (debería ser <500ms en buena red). Pon
   `STOP.flag` de vuelta al terminar.

10. **`published_at` write-back**: después del test 9, verifica que la fila
    del CSV correspondiente tiene `published_at` poblado con un ISO
    posterior a `state_updated_at`.

11. **No regresión P1**: dispara un pulso simulado (NO en vivo, con el sistema
    detenido — puedes invocar `register_press` desde un script) y verifica
    que `pulses.log` sigue recibiendo la línea ANTES de cualquier intento
    de publish. (Es decir: P1 sigue cerrado independiente de tu trabajo.)

12. **No regresión performance**: corre el pipeline completo en vivo del test
    9 y compara el tiempo punta a punta vs los ~4 min reportados por
    Worker A en R1. Esperado: igual o muy similar. Si subió >30s
    significativamente, investiga (la publicación NO debería estar en el
    camino caliente).

## Formato del reporte (igual estructura que Worker A)

```
## REPORTE WORKER LOCAL B — Firestore publisher (R2)

### Resumen ejecutivo
…

### Archivos modificados / nuevos
…

### Decisiones técnicas tomadas (con justificación)
…

### Bugs encontrados
…

### Riesgos detectados
…

### Qué quedó pendiente
…

### Validaciones (las 12, con status + output observado)
1) … 2) … etc.

### Estado en que quedó el sistema
…

### Reglas de Firestore propuestas (para que el chat maestro las pase a Isaac)
…

### Recomendación al arquitecto maestro
…
```

## Cómo empezar

1. `git log --oneline -5` en `C:\Puntazo\runner\` para confirmar que estás
   sobre el trabajo de Worker A.
2. Lee el seam: localiza `set_state()` en `script.py` y el comentario
   `# Worker B engancha AQUI...`. Léelo en contexto.
3. Confirma con Isaac: (a) que el JSON del service account está en
   `C:\Puntazo\runner\secrets\`, (b) que puedes instalar
   `google-cloud-firestore` con el python del runner.
4. Implementa incremental — instalación → conexión → publish manual →
   thread → republish → hook → tests.
5. Para CADA cambio: crea/usa un commit. Mantén commits pequeños y descriptivos
   ("R2: dependencias firestore", "R2: init_publisher + load SA", "R2: thread
   publisher", "R2: hook en set_state", "R2: republish startup", etc.).
6. Cualquier action con efecto (instalar pip, arrancar el runner, hacer un
   pulso en vivo): pídele OK a Isaac.
7. Detente al terminar las 12 validaciones. Pon `STOP.flag` antes de devolver
   el reporte.

**No expongas el rediseño web a más estados de los 4 publicados.** Si te das
cuenta de que sería bonito publicar `subiendo` o `procesando` también, NO lo
hagas en R2. El maestro decidió 4 estados a propósito para minimizar writes y
mantener la UX simple. Si tienes una razón fuerte, anótala en "Recomendación
al arquitecto maestro" y deja que el master lo decida en R3 o R2.1.
