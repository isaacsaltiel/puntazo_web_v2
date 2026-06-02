# Worker Local G — Emitir clip_states en WellStreet (igual que BreakPoint)

> Worker en la NUC de WellStreet (runner Python). NO toca el repo web. **PRIORIDAD ALTA**:
> en BreakPoint el "estado del clip" aparece en la web (resumen.html / mi-partido);
> en WellStreet NO aparece porque la NUC de WellStreet **no escribe los docs
> `clip_states/`**. El web ya los lee bien (agnóstico al club) — solo faltan los docs.

## Causa raíz
La web (`assets/clip-states.js`) consulta `clip_states/` filtrando por
`club / cancha / lado / ts_pulso` y resuelve el `video_url` cruzando con el índice.
BreakPoint los publica (Worker B / R2, `set_state`). El onboarding Firestore de
WellStreet (Worker E/F) dejó clip_states "fuera de scope" → los pulsos de WellStreet
se procesan y suben, pero **sin** ciclo de estado → la web no muestra nada.

## Objetivo
Que el pipeline de WellStreet (AMBOS clubes: WellStreet-Pickleball y WellStreet-Padel)
publique `clip_states/` con EXACTAMENTE el mismo esquema y ciclo de vida que BreakPoint.
Reusa el `set_state`/módulo de clip_states que ya existe en el runner de BreakPoint
(la base de código es compartida) — el trabajo es **wirearlo** al path que procesa los
pulsos Firestore de WellStreet (y a los match_full), no inventar uno nuevo.

## Esquema EXACTO del doc (lo que la web espera — no cambiar nombres)
Colección `clip_states/{clip_id}`:
```
{
  clip_id:           string,          // id estable del clip (mismo criterio que BreakPoint)
  state:             "en_cola" | "visible" | "error" | "pendiente_por_conexion",
  state_detail:      string,          // texto opcional de detalle
  state_updated_at:  serverTimestamp,
  ts_pulso:          "YYYY-MM-DD HH:MM:SS",   // hora LOCAL naïve del pulso (string, separador ESPACIO)
  club:              "WellStreet-Pickleball" | "WellStreet-Padel",
  cancha:            "Cancha1".."Cancha6",    // ⚠️ el COURT id, NO el dígito. Debe matchear
                                              //    match.can de la web (que es "CanchaN").
  lado:              "LadoA",
  source:            "web_boton" | "web" | "recovery" | ... ,
  job_id:            string,
  video_url:         null,            // null hasta READY; la web igual resuelve por índice
  published_at:      serverTimestamp | null
}
```
**Detalle crítico** (causa de bugs silenciosos): `cancha` debe ser el court id
("Cancha1"), no el dígito "1" que manda la web en el pulso. El runner tiene el mapeo
camera_key→court en config.json; úsalo para escribir el court id. Si lo escribes como
"1", la web NO hace match (compara contra match.can = "Cancha1") y no muestra nada.

## Ciclo de vida (igual que BreakPoint)
1. Pulso encolado → `state="en_cola"`.
2. Si NVR/conexión no disponible aún → `pendiente_por_conexion`.
3. Subido + indexado OK → `state="visible"`, `published_at` set (video_url puede
   quedar null; la web lo resuelve cruzando ts_pulso con el índice).
4. Falla irrecuperable (p.ej. nvr_window_exceeded, error de encode) → `state="error"`
   con `state_detail`.
Actualiza `state_updated_at` en cada transición.

## Alcance
- Pulsos normales (web_boton/web/recovery) de AMBOS clubes WellStreet.
- match_full (partido completo): también emite clip_states (el usuario debe ver su
  estado). source puede ser "match_full".
- NO toques el repo web ni las reglas (clip_states ya tiene regla: read público,
  write solo admin SDK — el runner ya usa admin SDK).

## Validación
- Pide un Puntazo en WellStreet (pickleball y pádel) desde la web → en resumen.html
  del partido / mi-partido aparece el estado del clip evolucionando (en_cola → visible),
  IGUAL que en BreakPoint.
- Confirma en consola Firestore que el doc clip_states tiene `cancha="CanchaN"` (no "N")
  y `club` correcto.
- match_full: el partido completo también muestra su estado.

## Definition of done
clip_states publicándose para ambos clubes WellStreet (pulsos + match_full), con el
esquema exacto de arriba, y la web mostrando el estado igual que BreakPoint. Reporte
estándar (docs/workers/README.md).
