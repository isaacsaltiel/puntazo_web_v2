# Worker Local C — Dev mode + limpieza Firestore + tune republish (R2.1)

> Worker de **implementación** corriendo vía Claude Code DENTRO de la NUC del
> club, sobre `C:\Puntazo\runner\`. Bundle pequeño post-R2 con 3 cambios
> ortogonales. Coordinado por el chat maestro.

## Objetivo

Tres cambios independientes que el chat maestro decidió juntar en un solo
worker corto:

1. **`DEV_MODE.flag`** — el watchdog NO debe robar focus ni traer ventanas
   al frente cuando este archivo existe. Permite a Isaac dejar el sistema
   corriendo mientras trabaja en otra ventana (VS Code, navegador, etc.).
2. **Script de limpieza puntual de `clip_states/` en Firestore** — borra TODO
   el contenido actual de la colección. El sistema lo va a re-publicar
   limpio al próximo arranque vía republish.
3. **Bajar `PUBLISHER_REPUBLISH_RECENT_HOURS` de 24 a 1** (1 línea en
   `script.py`). Razón: el republish actual con 24h trae al primer arranque
   todas las filas histórico-migradas del CSV (cuyo `state_updated_at` quedó
   reciente por la migración R1 de Worker A). Con 1h solo trae lo realmente
   reciente. Cleanup es duradero.

**No reescribas nada de R1/R2.** Tu trabajo es 3 cambios quirúrgicos +
1 script standalone.

## Contexto

- Repo git local en `C:\Puntazo\runner\.git\` (4 commits — baseline +
  R1×2 + R2). Verifica con `git log --oneline -5`.
- Sistema actualmente **DETENIDO con STOP.flag presente**. Mantenlo así
  mientras editas.
- Service account en `C:\Puntazo\runner\secrets\puntazo-clips-firebase-adminsdk-fbsvc-f61a0541cc.json`.
- `google-cloud-firestore 2.27.0` ya instalado en el python del runner
  (Worker B lo dejó listo).
- Watchdog hace `SetForegroundWindow` cada ~10s sobre la ventana del runner.
  Eso es lo que roba focus a Isaac. (Worker A confirmó el comportamiento
  pero no lo tocó; era fuera de scope.)
- `PUBLISHER_REPUBLISH_RECENT_HOURS = 24` es constante definida en
  `script.py` por Worker B en el bloque `# === FIRESTORE PUBLISHER (R2) ===`.

## PROTOCOLO DE SEGURIDAD (igual que A y B — inviolable)

1. `git status` clean + `git log --oneline -5` muestra commits de A y B
   antes de empezar.
2. Backup: `watchdog.py.bak-devmode-AAAAMMDD` y `script.py.bak-republish-AAAAMMDD`
   antes de tocar cada uno.
3. STOP.flag presente durante las ediciones.
4. Isaac está en la NUC contigo. Cualquier acción con efecto (correr el
   script de limpieza Firestore, arrancar el sistema con DEV_MODE.flag para
   probar): pide OK.
5. Si algo se rompe, revierte desde git o desde .bak.
6. **NO `git push`**. Repo sigue siendo solo local.
7. **NO imprimas** el contenido del SA JSON ni `private_key`.

## Alcance — qué implementar

### 1. `DEV_MODE.flag` en watchdog.py

- Define constante `DEV_MODE_FLAG = os.path.join(BASE_DIR, "DEV_MODE.flag")`
  cerca del top del módulo (junto a `STOP_FLAG`).
- Localiza la función que hace `SetForegroundWindow(hwnd)` y/o cualquier
  intento de poner la ventana del runner en foreground. Probable nombre:
  algo tipo `bring_to_front`, `focus_runner_window`, o llamadas inline
  dentro del loop principal.
- Antes de cada llamada a `SetForegroundWindow` (o equivalente), agrega un
  check:
  ```python
  if os.path.exists(DEV_MODE_FLAG):
      # DEV_MODE: no robar focus al usuario.
      return  # o continue, según el contexto
  ```
- Si hay un loop que invoca `bring_to_front` periódicamente, mueve el
  check al inicio del cuerpo del loop tick para que no haga ni el work
  preparatorio.
- Log al detectar DEV_MODE.flag por primera vez en el ciclo:
  `log("DEV_MODE.flag detectado — no robo focus al usuario.")`. NO logear
  cada 10s (sería spam); logea una vez por transición (de no-existe a
  existe). Usa una variable módulo `_last_dev_mode_state` para detectar
  flanco.
- **NO cambies** ninguna otra lógica del watchdog. Heartbeat, kill por
  freeze, restart del runner, P11 (confirm_runner_process), P4 (rotación):
  todo sigue igual. El watchdog DEBE seguir vigilando y matando el runner
  si freezea, incluso en DEV_MODE.

**Validación dev_mode (offline + live):**
- Offline: importar el módulo y verificar que `DEV_MODE_FLAG` apunta a
  `C:\Puntazo\runner\DEV_MODE.flag`.
- Live: con STOP.flag puesto, arrancar el watchdog manualmente
  (`python watchdog.py` o como sea que se levanta — verifica con Isaac
  el comando exacto). Confirmar que arranca normal. Crear DEV_MODE.flag.
  Quitar STOP.flag. Observar que: (a) el runner arranca, (b) la ventana
  del runner NO viene al frente, (c) el watchdog logea
  "DEV_MODE.flag detectado". Después poner STOP.flag de vuelta, borrar
  DEV_MODE.flag.

### 2. Script de limpieza Firestore (standalone, NO en script.py)

- Ubicación: `C:\Puntazo\runner\tools\cleanup_clip_states.py` (crea el
  dir `tools/` si no existe; agrégalo al `.gitignore` SI quieres tenerlo
  fuera de git, o NO si quieres versionar la herramienta — recomendado
  versionarla, es útil a futuro).
- Carga el SA con `firestore.Client.from_service_account_json(SA_PATH)`.
- Borra TODOS los docs de `clip_states/` con `batch.delete()` en chunks
  de 500.
- Imprime conteo antes y después: `clip_states/ tiene N docs → borrando…
  → 0 docs (M batches)`.
- **Requiere argumento explícito `--yes-i-am-sure`** para correr (sin
  argumento, imprime el conteo actual y sale sin borrar). Esto previene
  un `python tools/cleanup_clip_states.py` accidental.
- Test seguro: corre `python tools/cleanup_clip_states.py` (sin
  --yes-i-am-sure) primero, verifica que reporta los 145 docs esperados,
  sale sin borrar. Después, con OK de Isaac, corre con --yes-i-am-sure.
- **Confirma con Isaac antes de la corrida real.**

### 3. Bajar `PUBLISHER_REPUBLISH_RECENT_HOURS` de 24 a 1

- 1 línea en `script.py`, en el bloque de constantes del publisher (banner
  `# === FIRESTORE PUBLISHER (R2) ===`).
- Cambia:
  ```python
  PUBLISHER_REPUBLISH_RECENT_HOURS = 24
  ```
  a:
  ```python
  PUBLISHER_REPUBLISH_RECENT_HOURS = 1
  ```
- Razón: tras la limpieza Firestore, el primer arranque va a hacer
  `republish_state_on_startup()`. Con 24h trae todo el histórico migrado
  de vuelta (anula la limpieza). Con 1h solo trae lo de la última hora —
  para operación normal es suficiente porque las filas nuevas se publican
  vía hooks, no por republish.

### 4. (Opcional, solo si Isaac lo pide explícitamente) Reclaim del job huérfano

- Hay un job en `state=procesando` en el CSV vivo: `533f2116341bb5ca`
  (artefacto del `taskkill /F` final de Worker B).
- **Solo si Isaac lo pide explícitamente**, escribe un mini-script
  `tools/reclaim_orphan_processing.py` que:
  - Lee el CSV vivo bajo `QUEUE_CSV_LOCK`.
  - Para filas con `state=procesando` y `last_attempt_at_iso > 30 min`:
    setea `state=en_cola`, log el cambio.
  - Requiere `--yes-i-am-sure` también.
- Si Isaac NO lo pide, OMITE este punto. El sistema sobrevive al job
  huérfano (lo dijo Worker B).

## Orden de ejecución

1. Verifica git status + git log limpio.
2. Backup de watchdog.py y script.py.
3. Cambio 3 (1 línea en script.py): commit `R2.1: PUBLISHER_REPUBLISH_RECENT_HOURS=1`.
4. Cambio 1 (watchdog DEV_MODE): commit `R2.1: DEV_MODE.flag en watchdog (no foreground)`.
5. Crea script de limpieza (cambio 2): commit `R2.1: tools/cleanup_clip_states.py`.
6. Test offline del watchdog (módulo importa, constante existe).
7. Test offline del script de cleanup (sin --yes-i-am-sure, solo conteo).
8. Test live del watchdog en DEV_MODE (con OK de Isaac).
9. Corrida real del cleanup (con --yes-i-am-sure + OK de Isaac).
10. Reporte.

## Tests de validación (numera y reporta status)

1. **Git status limpio + 4 commits de A/B visibles al arrancar.** PASS/FAIL.
2. **Backups creados** (`watchdog.py.bak-devmode-AAAAMMDD`,
   `script.py.bak-republish-AAAAMMDD`). PASS/FAIL.
3. **Cambio en script.py**: `grep "PUBLISHER_REPUBLISH_RECENT_HOURS"
   script.py` muestra `= 1`. PASS/FAIL.
4. **Cambio en watchdog.py**: la función de foreground tiene check
   `if os.path.exists(DEV_MODE_FLAG): return`. PASS/FAIL.
5. **Script cleanup existe y arranca sin error sin --yes-i-am-sure**.
   Reporta conteo actual de `clip_states/`. PASS/FAIL.
6. **Test live DEV_MODE**: con OK de Isaac, crear DEV_MODE.flag, arrancar
   sistema, observar que no roba focus durante ≥2 min. PASS/FAIL.
   Después: STOP.flag + borrar DEV_MODE.flag para limpiar.
7. **Cleanup real** (con OK de Isaac y --yes-i-am-sure): conteo antes
   N, después 0. PASS/FAIL.
8. **No regresión P11**: leer el código del watchdog, confirmar que
   `confirm_runner_process` y `find_runner_window` siguen exactos a
   lo que Worker A dejó. PASS/FAIL.
9. **No regresión publisher**: arrancar el sistema con DEV_MODE.flag,
   esperar que procese el pulso pendiente PLS_20260523_091044, verificar
   que aparece `state=visible` en Firestore para ese clip. PASS/FAIL.
   (Es opcional si Isaac no quiere arrancar todavía — en ese caso reporta
   "no probado en este turno, queda al arranque siguiente".)

## Formato del reporte (igual que A y B)

```
## REPORTE WORKER LOCAL C — DEV_MODE + cleanup + tune republish (R2.1)

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
### Validaciones (las 9, con status + output)
…
### Estado en que quedó el sistema
…
### Recomendación al arquitecto maestro
…
```

## Cómo empezar

1. `git log --oneline -5` en `C:\Puntazo\runner\` — confirma los 4 commits.
2. Lee `watchdog.py` completo. Identifica dónde se hace SetForegroundWindow.
3. Lee el bloque `# === FIRESTORE PUBLISHER (R2) ===` en `script.py`.
   Localiza `PUBLISHER_REPUBLISH_RECENT_HOURS`.
4. Procede en el orden indicado. Para CADA cambio: explícale a Isaac qué
   vas a hacer, pídele OK, ejecuta, valida, commit.
5. NO arranques el sistema hasta el test 6 (con DEV_MODE.flag activo).
6. Reporta al terminar.
