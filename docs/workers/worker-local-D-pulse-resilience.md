# Worker Local D — Resiliencia de pulsos y recovery cuando la NUC arranca apagada

> Worker de **implementación** corriendo vía Claude Code DENTRO de la PC del
> club (NUC, BreakPoint), sobre el sistema local de Puntazo
> (probablemente `C:\Puntazo\runner\` — verifica al arrancar). NO trabaja
> sobre el repositorio web. Coordinado por el chat maestro.

> **Branch base**: `master` (rama local del repo de la NUC). Esta etapa NO
> depende del rediseño del jugador.

## Objetivo

Que **ningún pulso se pierda** cuando la NUC está apagada o se reinicia,
y que el usuario sepa cuándo la NUC está offline en lugar de tener
expectativas falsas. Hoy, cuando un jugador toca "Pedir Puntazo" o pide
una recuperación en [/recuperar.html](https://puntazoclips.com/recuperar.html)
y la NUC está apagada:

- El doc se escribe en `pending_pulses/` y se queda con `consumed_at: null`.
- La web confirma "Puntazo registrado" → el usuario cree que se grabó.
- Cuando la NUC prende, **no está claro** si:
  - reanuda procesando los pulsos viejos (replay correcto),
  - los pulsos viejos quedan colgados para siempre,
  - los procesa pero el NVR ya rotó y el clip sale vacío / con error sin
    marcar el doc como consumed,
  - los procesa pero sin idempotencia y se duplican uploads en arranques
    sucesivos.

Esta etapa **audita**, **arregla** y **agrega un heartbeat** para que la
web (en un follow-up) pueda decir "NUC offline, tu puntazo se intentará
cuando vuelva" en lugar de mentir.

## Contexto que ya sabemos (verifica que aplique al código actual)

### Lado web (lo que escribe la web a Firestore)

El cliente web usa `assets/pulses.js → PuntazoPulses.requestPulse()` que
escribe en la colección **`pending_pulses/`** un doc con este shape:

```js
{
  club: "BreakPoint",         // string, club id
  cancha: "3",                // string, SOLO el dígito (no "Cancha3")
  lado: "LadoA" | "LadoB" | null,  // null cuando es recovery (NUC decide)
  source: "web_boton" | "web" | "recovery",
  client_pulse_id: "PLS_W_...",    // genérado client-side
  match_id: string | null,
  uid_creator: string | null,
  created_at: serverTimestamp,
  event_at?: Timestamp,            // SOLO para source="recovery"
                                   // (timestamp del puntazo a recuperar)
  consumed_at: null,
  consumed_by: null,
}
```

**Reglas Firestore** (resumen, ver `docs/plans/firestore-rules-v100-fase3.md`
del repo web):
- `pending_pulses/` permite **create** desde cualquier cliente (sin auth)
  validando campos. **Update/delete denegados** → la NUC tiene que usar
  service account / admin SDK para marcar `consumed_at`.

### Lado NUC (lo que asumimos hoy)

- Hay (o debería haber) un listener `onSnapshot` a
  `pending_pulses` con `where("club","==","BreakPoint")` y
  `where("consumed_at","==",null)`.
- Cuando llega un doc → se mete a la cola interna de la NUC que ya saca
  clips del NVR Hikvision RTSP (rolling buffer ±90s, el NVR sigue
  grabando aunque la NUC esté apagada).
- Para `source: "recovery"`: la NUC usa `event_at` en lugar de
  `created_at` como anchor temporal para el corte del NVR (la ventana
  NVR ±90s se aplica al `event_at`).
- Tras procesar exitosamente: se marca `consumed_at: serverTimestamp` +
  `consumed_by: "<nuc_id>"` o similar.

### Lo que NO sabemos y hay que descubrir

1. **¿El listener arranca y procesa los docs viejos al boot?** O sea: si
   3 pulsos quedaron pendientes durante el apagón, ¿`onSnapshot` los
   entrega como `added` apenas se suscribe (comportamiento default de
   Firestore)?
2. **¿Hay control de "demasiado viejo"?** Si un pulso quedó pendiente y
   ya pasó la ventana del NVR (Hikvision suele retener N días según
   config — verifica), ¿la NUC lo intenta y falla silenciosamente, o lo
   marca como `consumed_at` + un campo de error?
3. **¿Idempotencia?** Si la NUC se cayó a medio procesar un pulso
   (subió a Dropbox pero murió antes de marcar consumed), al reiniciar,
   ¿lo vuelve a subir y duplica el clip? Hay un seam para esto?
4. **¿Heartbeat?** ¿La NUC escribe a alguna doc de Firestore que la web
   pueda usar para saber si está viva? (Hoy creemos que no.)
5. **¿Throttle del lado web vs realidad?** [/recuperar.html](https://puntazoclips.com/recuperar.html)
   tiene un throttle de "1 recuperación / 24h" para usuarios anónimos.
   Si la NUC está off por 2 días, el user pidió 1 vez, le dijo "ok", y
   nunca llegó el video. Al volver la NUC, procesa el viejo. Pero el
   user no puede pedir otro hasta 24h después de su primer pedido.
   Considera si esto es problema (probablemente sí pero fuera de scope
   de esta etapa — solo flag en reporte).

## Arquitectura relevante

- Repo NUC: probablemente `C:\Puntazo\runner\` (verifica con `git log -1`
  y `dir` que veas el código). Si el path actual es otro, úsalo y
  reporta en el brief.
- Lenguaje: Python.
- Trigger de pulsos antes de R4: botón Arduino vía Serial USB + Apps
  Script. R4 agregó listener Firestore para Web. Ambos canales conviven.
- NVR: Hikvision RTSP, rolling buffer. **NO depende de la NUC** — sigue
  grabando aunque la NUC esté apagada. Su retención depende de la config
  del NVR (chequea en docs/config NUC qué días retiene).
- Storage final: Dropbox vía rclone.
- Tras upload: dispatch al workflow `gestion_indice.yml` (GitHub Actions)
  para que la web vea el clip.
- Estados clip → Firestore en colección `clip_states/{clipId}` (R2).
  Esto NO es lo mismo que `pending_pulses/`. clip_states es el ciclo de
  vida POST-pulso (CAPTURED → UPLOADED → PROCESSED → READY etc).

## Archivos importantes a revisar (esperados, verifica)

- `core/main.py` — orquestador. Donde vive el listener Firestore (si
  existe) y el loop de procesamiento.
- `core/firestore_listener.py` o similar — si existe módulo dedicado.
- `core/state_machine.py` o similar — set_state() que Worker B engachó.
- `config.json` — credenciales (read-only, no toques).
- `pulses.log` — registro durable anti-crash del Worker A.

Si los nombres difieren, reporta los reales en el bloque "Archivos
modificados" del reporte.

## Alcance

### 1. Auditoría (primero, SIN cambiar código)

Responde en el reporte, con `file:line` cuando aplique:

- ¿Existe el listener a `pending_pulses` con
  `where("club","==","BreakPoint")` + `where("consumed_at","==",null)`?
  ¿Dónde?
- Cuando arranca: ¿la suscripción `onSnapshot` recibe docs viejos?
  (En la mayoría de SDKs sí — el primer snapshot incluye TODOS los docs
  que matchean. Verifica si el código tiene algún filtro de tiempo que
  los excluya.)
- ¿Cómo maneja el caso `event_at` (recovery) vs `created_at` (pulse
  normal) para el anchor del NVR? ¿Está implementado?
- ¿Qué pasa si el NVR no tiene el rango pedido (porque la ventana ya
  pasó)? ¿Cómo se cierra el doc?
- ¿La NUC escribe `consumed_at` con qué timestamp? ¿`consumed_by` con
  qué identificador?
- ¿Hay alguna marca de heartbeat o doc de salud en Firestore?

### 2. Fixes a implementar

Basado en la auditoría, implementa lo que falte de esta lista (no
asumas que TODO falta — verifica primero):

#### 2.1 Replay de cola al boot

Al arrancar el listener: log cuántos docs viejos hay pendientes y
procesarlos en orden de `created_at` ASC (o `event_at` ASC si es
recovery). Si el listener ya hace esto por default del SDK, solo
agrega logging explícito para tener observabilidad.

#### 2.2 Manejo "out of NVR window"

Antes de intentar el corte del NVR, verifica si el `created_at`
(o `event_at` para recovery) está dentro del rango que el NVR retiene.
Si está fuera:
- Marca el doc como `consumed_at: serverTimestamp()`,
  `consumed_by: "nuc_<id>"`,
  `error_reason: "nvr_window_exceeded"`,
  `processed_video_url: null`.
- Logueá en `pulses.log` localmente.
- NO subas nada a Dropbox.

Esto permite que `recuperar.html` futuro pueda ver el `error_reason`
y decirle al user "tu video ya no está disponible" en lugar de quedar
en limbo.

#### 2.3 Idempotencia

Antes de procesar un doc, chequea localmente si ya lo procesaste antes
(p.ej. tabla local SQLite o el mismo `pulses.log` con
`client_pulse_id`). Si sí: marca `consumed_at` con `error_reason:
"already_processed"` y skip. Esto cubre el caso de cae-en-medio +
reinicio.

#### 2.4 Heartbeat de la NUC

Nueva colección `nuc_heartbeat/{clubId}` (1 doc por club).
La NUC escribe cada **30 segundos** (o configurable, default 30s):

```js
nuc_heartbeat/BreakPoint {
  status: "online",
  startedAt: serverTimestamp,    // boot time NUC (no cambia hasta reinicio)
  lastSeenAt: serverTimestamp,   // se actualiza cada 30s
  pendingQueue: number,           // cuántos pulses sin consumir hay
  nvrConnected: boolean,          // estado de conexión al NVR
  version: string,                // versión del software NUC
  clubId: "BreakPoint",
}
```

Si la NUC se apaga limpiamente (signal SIGTERM):
intenta hacer 1 update final con `status: "shutting_down"` y
`lastSeenAt: serverTimestamp()`.

**Reglas Firestore para esto** (DEPENDENCIA WEB, comunica al maestro
en el reporte, NO escribas en el lado web tú):

```firestore
match /nuc_heartbeat/{clubId} {
  allow read: if true;          // web pública lee
  allow write: if false;        // solo NUC via admin SDK
}
```

El maestro agregará esta regla cuando recibas el reporte.

### 3. Validaciones E2E

Antes de cerrar:

- [ ] Apaga la NUC. Desde el dispositivo de prueba, manda un pulso via
  [/boton.html](https://puntazoclips.com/boton.html) con BreakPoint
  Cancha 3 (o el club configurado). Espera 2 minutos. Prende la NUC.
  Confirma que en 30s aparece el clip en Dropbox y `consumed_at` se
  llenó.
- [ ] Repite con `recuperar.html` (recovery, event_at hace 1 hora).
  Mismo resultado.
- [ ] Manda un pulso con `event_at` hace 5 días (fuera de ventana NVR).
  Confirma que se marca `consumed_at` + `error_reason:
  nvr_window_exceeded` sin subir nada a Dropbox.
- [ ] Mata el proceso de la NUC en medio de procesar un pulso (kill
  brutal mientras está subiendo a Dropbox). Reinicia. Confirma que NO
  duplica (uno solo en Dropbox; doc con `consumed_at` y posible
  `error_reason: already_processed` si era el mismo).
- [ ] Verifica que `nuc_heartbeat/BreakPoint` se actualiza cada 30s
  (o el intervalo configurado).

## Fuera de alcance (NO toques)

- El sistema viejo de Apps Script + CSV de Drive (clubs no migrados a
  Firestore). Esta etapa es solo para BreakPoint via Firestore.
- Cambios al lado web (recuperar.html, boton.html, etc). Si tu fix
  requiere UI web nueva (mostrar status NUC), repórtalo y el maestro
  hace hot-patch al repo web.
- Las reglas Firestore reales. Tú solo propón el bloque; el maestro lo
  integra al doc del repo web y pide a Isaac re-publicar en consola.
- `clip_states/` (R2). Sigue funcionando como Worker B la dejó.
- Credenciales en `config.json`. Sigue siendo deuda, pero no es esta
  etapa.

## Riesgos

- **Botón Arduino en paralelo**: si el botón físico Arduino sigue
  escribiendo pulsos por otro canal, asegura que tu listener no
  procese pulsos Arduino (filtra por `source`).
- **Múltiples NUCs futuras**: hoy 1 NUC = 1 club, pero el día que haya
  2+ NUCs hay que ponerle un `nuc_id` único por instancia para el
  campo `consumed_by`. Para esta etapa: hard-coded el id (p.ej.
  `breakpoint-001` desde config) y reporta como deuda.
- **NVR pierde conexión transitoriamente**: heartbeat debería reflejar
  `nvrConnected: false`. La cola sigue acumulándose. No drop docs por
  esto.

## Definition of done

- Auditoría completa con `file:line` reportada.
- Replay de pulsos viejos verificado al boot (test E2E).
- Out-of-NVR-window cierra el doc con error_reason.
- Idempotencia testeada con kill brutal.
- Heartbeat escribe cada 30s y se ve en Firestore consola.
- Reporte con archivos modificados + decisiones + bugs encontrados +
  bloque de reglas Firestore propuestas para el maestro.

## Formato del reporte de regreso

Sigue el formato estándar de `docs/workers/README.md`. Adicionalmente
incluye:

### Bloque "Reglas Firestore propuestas"

Copy-pasteable, listo para que el maestro lo integre al repo web:

```firestore
// AGREGAR antes del catch-all `match /{document=**}`
match /nuc_heartbeat/{clubId} {
  allow read: if true;
  allow write: if false;
}
```

### Bloque "Cambios coordinados que pide a la web"

Lista de cosas que la web debería hacer aprovechando esto (no
obligatorias, son nice-to-have):

- En `recuperar.html`: leer `nuc_heartbeat/BreakPoint`, si
  `lastSeenAt > 5min` mostrar "NUC offline, tu pedido se procesará
  cuando vuelva (puede ser unos minutos o unas horas)".
- En `boton.html`: similar, banner pasivo cuando NUC offline.
- En `clip.html` / `lado.html`: cuando un doc tiene
  `error_reason: nvr_window_exceeded`, mostrar mensaje específico.
