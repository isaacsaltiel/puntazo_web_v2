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
| 2026-09-08 | `global__anuncio` | 5 | `ANUNCIO.webm` | 1,548,761 | `b578e6e2…b176` | claude-code |
| 2026-09-08 | `club__BreakPoint__outro` | 1 | `outro.mp4` | 9,626,780 | `d1ee2068…1432` | claude-code |
| 2026-09-08 | `club__Interpadel__outro` | 1 | `outro.mp4` | 9,626,780 | `d1ee2068…1432` | claude-code |

## Detalle de cambios

### `club__BreakPoint__outro` v1 + `club__Interpadel__outro` v1 (2026-09-08)
Outro **Loka Healthy x Puntazo** (co-branded, 1920x1080, 10s, H.264 + AAC 44100, con
musica) SOLO en BreakPoint e Interpadel. **`global__outro` v3 se deja INTACTO a proposito**:
ese es el outro de Puntazo y es el que conserva WellStreet, por decision de Isaac.

Se usó el override por club del spec (Worker L, sección "Orden de aplicación"):
la NUC aplica `global__{slot}` y luego `club__{ClubId}__{slot}` ENCIMA si existe. Ambos
apuntan al mismo `target_filename` (`outro.mp4`), que es justo el mecanismo de override.
Esto es mas seguro que publicar `global__outro` v4 y confiar en que el asset_sync muerto
de WellStreet no lo baje: cuando ese sync se arregle, WS jalará `global__outro` v3 = el
outro de Puntazo, que es lo correcto.
**Rollback:** poner `enabled=false` en el doc del club (vuelve a mandar el global v3).

### `global__anuncio` v5 (2026-09-08) — PRIMER PATROCINADOR PAGADO
Reemplaza el banner de venta "¿Tu marca aquí?" por **Loka Healthy**, la primera marca que
paga por anunciarse en los videos. Moneda circular de Loka (su "Variación circular") que
**rueda** de su posición central hacia la izquierda; el banner nace detrás de ella, se
mantiene, se recoge y la moneda rueda de regreso. Tarjeta verde bosque, copy minimalista
sin teléfono (los pedidos van por Instagram/web, links debajo del video). 2280x560, 30fps,
300 frames = 10.0s, VP9+alpha, loop seamless. Fuente: `loka_anuncio.webm`.
**Rollback:** apuntar el doc a `/Puntazo/assets/global/v4__anuncio.webm` (sigue vivo).

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

## Estado real de sincronización por NUC (auditado 2026-09-08)
Ojo: aparecer en `applied` NO significa estar al día — hay que mirar la VERSIÓN.
- **BreakPoint**: al día. Tomó `anuncio` v5 en ~1 min (2026-09-08 19:47).
- **Interpadel**: iba en v4 al momento del push; su ciclo la levanta sola (≤5 min).
- **⚠️ WellStreet**: **CONGELADA EN v1 EN TODOS LOS ASSETS**, último apply
  2026-06-06 17:37. No tomó anuncio v2/v3/v4/v5, ni outro v2/v3, ni sus propios
  logos de club v2 (el `wellstreet.webm` animado). Su `asset_sync` no corre continuo
  — es el pendiente viejo de "restart controlado en la NUC de WS". Mientras no se
  arregle, WellStreet sigue mostrando los PNG estáticos y **no muestra a Loka**.

## Notas operativas
- Las fuentes de los assets viven en `C:\Users\Isaac\Desktop\puntazo_banner_animado\`.
- Cómo se construyen/animan: skill global `puntazo-logo-animation`
  (`~/.claude/skills/puntazo-logo-animation/`).
- El `asset_sync` de cada NUC toma la versión nueva en su próximo ciclo (≤5 min);
  si llega durante un encode, entra al siguiente clip.
