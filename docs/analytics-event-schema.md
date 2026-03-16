# Analytics event schema (GA4 via gtag)

Este documento lista los eventos y parámetros que el frontend dispara (usando `trackEvent()` y `gtag`). Se usa para alinear equipo comercial/técnico.

Eventos principales:

- `view_side`:
  - loc: string
  - can: string
  - lado: string
  - filtro: string
  - has_target_video: boolean

- `play_video`:
  - video_name: string (videoId / nombre archivo)
  - loc/can/lado: según contexto (si aplica)

- `click_share`:
  - video_name: string

- `share_success`:
  - video_name: string
  - mode: string (ej. "native")

- `share_copy`:
  - video_name: string

- `save_video` / `unsave_video`:
  - video_name: string

- `click_preview_to_play`:
  - video_name: string

- `open_locacion`, `open_cancha`, `open_lado`:
  - loc/can/lado ids y nombres

- `promo_click`, `promo_modal_open`, `promo_action`:
  - promo_id, promo_label, action_type, video_name

- filtros y navegación:
  - `filter_hour` (hour), `filter_remove` (prev_hour)
  - `paginate` (from, to, total_items, page_size)
  - `scroll_to_top`

Notas:
- Los nombres deben mantenerse tal cual para no romper los informes existentes en GA4.
- Eventos de negocio (vistas, shares, saves, comentarios, claims) se replican también en Firestore bajo `reactions/{videoId}` para métricas comerciales y persistencia por video.

Firestore: campos escritos por frontend (aditivo)
- total: number (reacciones total)
- fuego/risa/enojo/diversion/sorpresa: number
- views: number (incremental)
- shares: number (incremental)
- saves: number (incremental)
- comments_count: number (incremental)
- claims_count: number (incremental)
- immortal: boolean
- immortal_reasons: object (ej. { best_threshold: 3 } o { saved_by_user: { uid, at } })
- immortal_markedAt: timestamp
- saved_by_user: boolean

Este esquema es una guía: los cambios deben ser coordinados con el equipo de backend si se agregan índices o reglas de seguridad.
