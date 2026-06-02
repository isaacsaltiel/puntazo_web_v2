# Worker Local F — Render extensions en la NUC: match_full + clip_edit (+ multi-club)

> Worker de implementación en la PC del club (NUC), sobre el runner Python.
> NO toca el repo web. Coordinado por el chat maestro. La web YA está deployada
> con estos contratos; faltan los handlers en la NUC para que "encajen".

## Contexto
El listener Firestore (`firestore_pulses.py`) ya consume `pending_pulses/`. La web
empezó a escribir DOS tipos nuevos de doc (además del pulso normal):

### 1. `source == "match_full"` — subir partido completo (R7)
Campos extra del doc: `start_at`, `end_at` (Timestamps), `match_id`.
Handler: cortar el NVR del canal de la cancha desde `start_at` a `end_at` (hora
local), clamp a **MAX 20 min anclando al FINAL** (si dura más, graba los últimos
20). Mín 20s (`match_too_short`). Subir a la carpeta del club/cancha con marcador
**`_PARTIDO_`** en el nombre. ACK consumed_at/consumed_by. Idempotencia por
`client_pulse_id` (determinístico `PLS_M_<matchId>`). Config:
`firestore.match_recording = { enabled, max_minutes:20, allowed_clubs, tail_seconds:3 }`.

### 2. ~~`source == "clip_edit"`~~ — MOVIDO A LA NUBE (NO lo hagas en la NUC)

> **CAMBIO**: la edición de clips (recorte + encuadre dinámico + sacar puntazo de un
> partido largo) ya NO se renderiza en la NUC. Se hace en **GitHub Actions**
> (`.github/workflows/clip_edit.yml` + `clip_edit_ci.py`), leyendo la colección
> Firestore **`clip_edits/`** (no `pending_pulses`). La NUC **NO debe** procesar
> `clip_edit` ni escuchar `clip_edits/`. Ignora esta sección. (Se conserva abajo solo
> como referencia histórica del contrato.)

<details><summary>(histórico) contrato clip_edit cuando se pensaba en NUC</summary>
Campos extra:
```
source_video_id : nombre del .mp4 original (ej WellStreet-Pickleball_Cancha1_LadoA_..._..mp4)
source_url      : URL Dropbox del clip original
trim            : { in: segFloat, out: segFloat }          // recorte (out>in, ≤600s)
reframe : {
  enabled  : bool,
  aspect   : "free" | "9:16" | "1:1" | "16:9",
  keyframes: [ { t: segAbsolutoDelClip, x, y, w, h }, ... ] // x,y,w,h NORMALIZADOS 0..1 del frame
}
```
Handler (ffmpeg):
- **Trim**: `-ss trim.in -to trim.out` sobre el clip original. El insumo puede ser
  el .mp4 ya en Dropbox (descárgalo con rclone) o re-cortar del NVR si prefieres
  calidad (el original ya está procesado con logos; recortar el .mp4 existente es
  lo más fiel a lo que vio el usuario → recomendado descargar `source_url`/rclone).
- **Reframe** (si `enabled` y hay keyframes):
  - Las coords son fracciones [0..1] del frame. Convierte a px con W,H reales.
  - 1 keyframe → crop estático: `crop=w*W:h*H:x*W:y*H`.
  - 2+ keyframes → crop animado entre tiempos (los `t` son ABSOLUTOS del clip
    original; réstale `trim.in` para el tiempo dentro del recorte). Implementa con
    expresiones de tiempo en el filtro crop (`crop=...:x='lerp(...)'` usando `t`) o
    con `sendcmd`/`zoompan`. Interpola lineal entre keyframes (igual que el preview web).
  - Tras el crop, escala/encuadra al `aspect` pedido (para 9:16 etc., `scale` +
    `pad` o `crop` final a la relación exacta).
- Subir a la MISMA carpeta del club/cancha con marcador **`_EDIT_`** en el nombre
  (la web lo podrá distinguir). Dispara `gestion_indice.yml` para reindexar.
- Idempotencia por `client_pulse_id` (`EDIT_...`). ACK consumed_at/consumed_by.
- Allowlist de clubes (config). Errores → consumed con `error_reason`
  (`edit_source_unavailable`, `invalid_trim`, `reframe_failed`, etc.).

</details>

### 3. Multi-club (recordatorio, ya pedido)
El listener debe escuchar AMBOS clubes (`WellStreet-Pickleball` + `WellStreet-Padel`)
y resolver cámara club-aware. 4 cámaras de pádel en canales 701/801/901/1001 (ya
confirmado). Heartbeat un doc por club.

## Validaciones
- match_full: partido de prueba pickleball → `_PARTIDO_*.mp4` en la carpeta correcta, indexado.
- clip_edit recorte simple: enviar desde editor.html (recorte 5s) → `_EDIT_*.mp4`
  con esos 5s.
- clip_edit reframe estático 9:16 → clip vertical recortado al recuadro.
- clip_edit reframe 2 keyframes → el encuadre se mueve/zoom como en el preview web.
- Idempotencia: reenviar el mismo edit no duplica.

## Reglas
- NO toques el repo web. Sin cambios de reglas Firestore (pending_pulses admite los
  campos extra; el render lo hace el admin SDK/ffmpeg local).
- Reporta formato estándar (docs/workers/README.md). Cuando TODO esté probado,
  lanza el runner en prod.
