# NUC assets — deploy log

Registro de publicaciones a `nuc_assets` (Dropbox + Firestore) vía
`tools/nuc_assets/push_asset.py`. Cada entrada = una versión nueva activada.
Rollback: apuntar el doc a la versión/ruta anterior (los archivos viejos siguen
vivos en Dropbox). Ver `tools/nuc_assets/README.md`.

| Fecha | Doc | v | target_filename | size | hash (corto) | por |
|------|-----|---|-----------------|------|--------------|-----|
| 2026-06-06 | `club__BreakPoint__logo_club` | 3 | `BreakPoint.webm` | 1,324,144 | `e33349fc…e6bd` | claude-code |
| 2026-06-06 | `global__anuncio` | 4 | `ANUNCIO.webm` | 820,151 | `6a8a535f…e44e` | claude-code |
| 2026-06-07 | `global__logo_puntazo` | 3 | `puntazo_anim.webm` | 2,870,736 | `b1fbb67f…0a62` | claude-code |

## Detalle de cambios

### `club__BreakPoint__logo_club` v3 (2026-06-06)
Logo BreakPoint con **pelota girando** (antes era estático). Movimiento tipo
inercia: gira ~1.5 vueltas hacia un lado con aceleración/desaceleración suave
(smootherstep), pausa estática, gira al otro lado, pausa, repite. Ciclo 10s.
Solo gira la pelota; el resto del logo idéntico. Relleno blanco puro detrás de la
pelota para que no se vea transparente sobre el video. WebM VP9 + alpha, 30fps,
loop seamless. Fuente: `breakpoint_ball_spin.webm`.

### `global__anuncio` v4 (2026-06-06)
Anuncio "¿Tu marca aquí?" **re-estilizado** al look web (card oscuro neón + P coin
glossy + pill WhatsApp con logo oficial). **Ritmo nuevo**: ~5s solo la P en su
monedita centrada + ~5s banner desplegado (la P se desliza a la izquierda y nace
la tarjeta), con glow que late, destello y pill que pulsa. Ciclo 10s, loop
seamless, WebM VP9 + alpha. Compatibilidad: BP lo usa; WellStreet sigue con
fallback `ANUNCIO.png` (aún no soporta el webm). Fuente: `anuncio_animado.webm`.

### `global__logo_puntazo` v3 (2026-06-07)
Cara de la "P" del combo simplificada: **se quitó el wordmark PUNTAZO**, queda
**P + @puntazoclips**; la P quedó más grande y el @ más grande/grueso/legible.
Lo demás del combo intacto (alterna con el logo completo de raqueta, guiño,
cambio de color blanco↔azul, destello, pelota que gira/rebota, morph con flash
azul). Ciclo 12s, loop seamless, WebM VP9 + alpha. Fuente: `puntazo_combo.webm`.

## Compatibilidad por NUC (estado conocido)
- **BreakPoint**: soporta animados `puntazo_anim.webm`, `ANUNCIO.webm`,
  `BreakPoint.webm`. Recibe todo lo de arriba.
- **WellStreet**: aún usa PNG (`puntazo.png`, `wellstreet.png`, `ANUNCIO.png`);
  skippea los webm globales hasta adaptar pipeline (ver
  `docs/workers/worker-local-L2-wellstreet-animated-assets-qsv.md`).

## Notas operativas
- Las fuentes de los assets viven en `C:\Users\Isaac\Desktop\puntazo_banner_animado\`.
- Cómo se construyen/animan: skill global `puntazo-logo-animation`
  (`~/.claude/skills/puntazo-logo-animation/`).
- El `asset_sync` de cada NUC toma la versión nueva en su próximo ciclo (≤5 min);
  si llega durante un encode, entra al siguiente clip.
