# Worker Local L — Sync de assets compartidos (logo animado + outro + fuentes) entre las 3 NUCs vía Dropbox

> Worker de **implementación** corriendo dentro de cada NUC (BreakPoint,
> WellStreet, Interpadel). NO trabaja sobre el repo web. Coordinado por el chat
> maestro.
>
> **Branch base**: `master` local del repo NUC. **Resuelve la deuda "assets
> management"** del análisis 2026-06-03 (sección 5) + unifica el logo animado.

## Objetivo

Que las 3 NUCs compartan los **assets comunes del pipeline** (logo izquierdo
animado, outro, fuentes, ANUNCIO) desde una única fuente en Dropbox, de modo que
un cambio al asset se propague a las 3 sin tocar cada máquina a mano.

**Asset unificado de referencia**: el logo animado de BreakPoint
`puntazo_anim.webm` (VP9 con alpha, integrado el 2026-06-03 11:32). WellStreet e
Interpadel pasan de **PNG estático → logo animado** vía este sync.

## Contexto que ya sabemos

### Estado actual (del audit 2026-06-03)

- **BP**: logo izquierdo **animado** `media/Prod/puntazo_anim.webm` (VP9 alpha),
  ya conectado al pipeline (`ffmpeg_amplify_and_logos`, `LOGO_LEFT_ANIMATED=True`,
  fallback a `puntazo.png`). Logo derecho `BreakPoint.png`, `ANUNCIO.png`, outro.
- **WS**: logo izquierdo **estático** `media/Prod/puntazo.png` (pendiente confirmar).
- **IP**: logo izquierdo **estático** `media/Prod/puntazo.png` (700px), derecho
  `interpadel.png` (320px), `ANUNCIO.png` (1200px), outro `outro.mp4`.
- `media/` está en `.gitignore` en las 3 → los assets NO se versionan; viven
  solo en cada máquina. Por eso hace falta un canal de sync.

### Approach aprobado por el maestro

- **Storage**: Dropbox `/Puntazo/Assets/` (carpeta nueva, compartida).
- **Distribución**: `rclone copy` de `/Puntazo/Assets/` → `media/Prod/` **al boot**
  del runner + un **cron cada 1h** para refrescar en caliente.
- **Cero infra nueva**: las 3 NUCs ya tienen rclone autenticado a Dropbox (lo
  usan para subir clips).
- **Assets comunes vs específicos**: el logo izquierdo (Puntazo animado), outro y
  fuentes son **comunes**. El logo derecho (`BreakPoint.png` vs `interpadel.png`)
  es **específico por club** → NO se sincroniza desde la carpeta común, o se
  sincroniza desde una subcarpeta por club `/Puntazo/Assets/{club}/`.

## Arquitectura relevante

- **rclone**: remote ya configurado (`dropbox:` en IP, confirmar nombre en BP/WS —
  el audit notó que IP usa `dropbox:` y el CLAUDE.md general menciona `nombre:`).
  **Verificar el nombre del remote en cada NUC antes de codear.**
- **Pipeline FFmpeg**: el cambio de PNG→webm animado en WS/IP toca la función de
  overlay de logos (`ffmpeg_amplify_and_logos` o equivalente). El logo animado
  VP9-alpha se aplica distinto a un PNG: hay que portar el patrón de BP
  (loop infinito acotado a la duración del cuerpo, overlay con alpha).
- **Boot hook**: cada runner tiene un arranque (`run_forever.bat` /
  `AUTO_START_PUNTAZO.bat` / `main.py`). El `rclone copy` va ahí, antes de
  procesar el primer clip.
- **Cron 1h**: Windows Task Scheduler o un thread interno del runner.

## Archivos importantes a revisar

- En cada NUC: la función de overlay de logos en el pipeline (BP `script.py`,
  WS/IP `core/pipeline.py`), `media/Prod/`, el script de arranque, el config de rclone.
- En BP (referencia): cómo aplica `puntazo_anim.webm` el logo animado
  (`LOGO_LEFT_ANIMATED`, posición x=20 y=5 ancho 420, fallback a PNG).

## Alcance

1. **Auditar** en cada NUC: nombre del remote rclone, ruta de `media/Prod/`, la
   función de overlay de logo, el hook de arranque. `file:line`.
2. **Estructura Dropbox**: crear `/Puntazo/Assets/` con los assets comunes
   (subir `puntazo_anim.webm`, outro, fuentes) + subcarpeta por club para el logo
   derecho si se decide. **Subir desde BP** (que tiene el asset bueno).
3. **Boot sync**: agregar `rclone copy dropbox:/Puntazo/Assets/ <media/Prod/>` al
   arranque de cada runner, antes del primer procesamiento. Idempotente.
4. **Cron 1h**: refresco periódico (Task Scheduler o thread). No debe interrumpir
   un encode en curso.
5. **Migrar WS + IP a logo animado**: portar el patrón de overlay VP9-alpha de BP
   a WS/IP, con fallback a PNG si el webm no está presente.
6. **Verificar** que un cambio al asset en Dropbox se refleja en el siguiente
   boot/cron de las 3 NUCs.

## Fuera de alcance

- **Versionar `media/` en git.** Sigue gitignored; la fuente de verdad es Dropbox.
- **Sincronizar el logo derecho específico de club como asset común** (queda por
  club).
- **Rediseñar el logo / outro.** Solo distribución de los assets existentes.
- **Cambios al repo web.**
- **Tocar la cola, Firestore, NVR.**

## Riesgos

- **Sync corrompe un asset en uso**: si el `rclone copy` sobrescribe el webm
  mientras un encode lo está leyendo, el clip sale roto. El cron NO debe copiar
  durante un encode en curso (chequear flag de in-flight o usar copy atómico a
  temp + rename).
- **Nombre del remote distinto por NUC**: `dropbox:` vs `nombre:`. Hardcodear el
  equivocado rompe el sync. Verificar en sitio.
- **Logo animado pesa más**: `puntazo_anim.webm` (2.5 MB, 12s) vs PNG. Cada encode
  con logo animado es más caro que con PNG estático. Confirmar que WS/IP aguantan
  el costo extra (el audit de BP ya lo absorbió).
- **Fallback roto**: si el webm no se descarga (Dropbox caído al boot) y el
  fallback a PNG no existe, el pipeline falla. Garantizar fallback presente.
- **Regresión visual**: el logo animado debe quedar en la misma posición/tamaño
  que el estático para no descuadrar el frame.

## Validaciones

Cada item ✅ ❌ o ⏭️ con razón:

1. **Estructura Dropbox**: `/Puntazo/Assets/` existe con `puntazo_anim.webm` +
   outro + fuentes. Listable por rclone desde las 3 NUCs.
2. **Boot sync**: arrancar el runner → `media/Prod/` queda con los assets de
   Dropbox (verificar mtime/hash).
3. **Cron 1h**: cambiar un asset en Dropbox → tras el cron, la NUC lo tiene
   actualizado.
4. **Logo animado en WS**: pedir un Puntazo en WS → el clip sale con el logo
   izquierdo **animado** (no PNG), misma posición que BP.
5. **Logo animado en IP**: idem en IP.
6. **Fallback**: renombrar el webm local y procesar → cae al PNG sin crashear.
7. **No corrupción**: forzar un cron durante un encode → el clip en curso sale
   íntegro (copy atómico / skip durante in-flight).
8. **No regresión BP**: BP sigue procesando con su logo animado igual que hoy.

## Definition of done

- `/Puntazo/Assets/` en Dropbox como fuente de verdad de assets comunes.
- Boot sync + cron 1h activos en las 3 NUCs, con copy atómico (no corrompe in-flight).
- WS e IP renderizando con el **logo animado** unificado (fallback PNG presente).
- Validaciones 1-8 documentadas.
- Branch `worker-local-L-assets-sync-dropbox` con commit SHA por NUC (o reporte
  sin branch donde no haya git).
- Reporte en formato `docs/workers/README.md`.

## Formato del reporte de regreso

Ver `docs/workers/README.md`. Sí o sí incluir:

- Nombre del remote rclone en cada NUC.
- Estructura final de `/Puntazo/Assets/` (común vs por-club).
- Cómo se evita la corrupción de asset durante un encode (mecanismo elegido).
- Confirmación visual de que WS/IP quedaron con el logo animado en la posición correcta.
- Costo extra de encode con logo animado en WS/IP (si es perceptible).

---

**Referencias rápidas**:
- Referencia del logo animado: pipeline de BP (`ffmpeg_amplify_and_logos`, `LOGO_LEFT_ANIMATED`).
- Deuda original: `docs/plans/nuc-architecture-analysis-2026-06-03.md` sección 5.
- Estado consolidado: `docs/plans/nuc-state-2026-06-03.md`.
- Convención: `docs/workers/README.md`.
