# Worker Local L2 - WellStreet animated assets + QSV

# objetivo

Dejar WellStreet al nivel operativo de BreakPoint para assets gestionados desde
la PC central:

- `asset_sync` activo tras restart controlado.
- `global__outro` ya aplicado y estable.
- soporte de `ANUNCIO.webm` animado con fallback a `ANUNCIO.png`.
- soporte de logo Puntazo animado `puntazo_anim.webm` con fallback a `puntazo.png`.
- soporte futuro para logo club animado con fallback a `wellstreet.png`.
- benchmark/activacion de QSV si el hardware de la NUC lo soporta.

No cambiar la logica de clubes, pulsos, match_full ni subida de clips.

# contexto

WellStreet corre una NUC compartida para dos clubs:

```text
WellStreet-Pickleball
WellStreet-Padel
```

Runner:

```text
C:\Users\WellStreet\Desktop\Puntazo-release
```

Estructura:

```text
main.py
core/
core/pipeline.py
core/sources/firestore_pulses.py
media/Prod/
config.json
secrets/service_account.json
```

Assets locales actuales:

```text
media/Prod/puntazo.png
media/Prod/wellstreet.png
media/Prod/ANUNCIO.png
media/Prod/outro.mp4
```

WellStreet ya tiene Worker L instalado:

```text
asset_sync.py
main.py -> start_background_sync(stop_event=STOP_EVENT)
media/Prod/.assets_state.json
media/Prod/.tmp/
```

WellStreet usa rclone remote local:

```text
nombre:
```

No usar `dropbox:` dentro de WellStreet para assets: en discovery no vio el
path exacto; `nombre:` si lo vio.

Docs Firestore relevantes:

```text
global__logo_puntazo      -> target puntazo_anim.webm, version 2
global__anuncio           -> target ANUNCIO.webm, version 3
global__outro             -> target outro.mp4, version 1
club__WellStreet-Pickleball__logo_club -> target wellstreet.png, version 1
club__WellStreet-Padel__logo_club      -> target wellstreet.png, version 1
```

Notas:

- **Verificado contra Firestore + Dropbox en vivo (2026-06-06):** los 5 docs y
  versiones de arriba son correctos y vigentes, y los 5 archivos existen en
  Dropbox. Ambos `logo_club` de WS comparten el mismo `content_hash`
  (`sha256:3fe9065…`), lo que confirma el dedupe por `target_filename`.
- **Referencia probada = BreakPoint.** BP ya corre el stack animado completo en
  prod: `global__logo_puntazo` (puntazo_anim.webm v2), `global__anuncio`
  (ANUNCIO.webm v3) y su propio `logo_club` animado (`BreakPoint.webm`, hoy v3).
  Para el patch de FFmpeg, COPIAR el manejo `.webm` de `core/pipeline.py` de BP
  (overlay con `-stream_loop -1`, alpha VP9 preservado, cuerpo acotado) en vez de
  inventarlo — ese camino ya está validado en producción.
- `global__outro` ya fue aplicado manualmente en WS.
- `global__anuncio` v3 es animado `.webm`; WS debe soportarlo antes de usarlo.
- `global__logo_puntazo` v2 es animado `.webm`; WS hoy lo skippea porque su
  pipeline lee `puntazo.png`.
- Ambos docs `logo_club` de WS apuntan al mismo `wellstreet.png` y mismo hash.
  Esto es intencional hoy; si algun dia hay logos distintos por club, habra que
  cambiar target filenames o logica por club.

# arquitectura relevante

## Asset sync

`asset_sync.py` debe seguir siendo un modulo separado:

- lee `nuc_assets`
- resuelve global + clubs WS
- deduplica por `target_filename`
- descarga por `nombre:{dropbox_path}`
- verifica `sha256`
- reemplaza con `os.replace`
- conserva archivo viejo si algo falla
- no tumba runner

## FFmpeg / pipeline

El pipeline modular vive en:

```text
core/pipeline.py
```

Debe quedar con fallback exacto:

- si existe `puntazo_anim.webm`, usar animado; si no, `puntazo.png`.
- si existe `ANUNCIO.webm`, usar animado; si no, `ANUNCIO.png`.
- si algun dia existe `wellstreet.webm`, usar animado; si no, `wellstreet.png`.

Para `.webm`:

- usar `-stream_loop -1`
- preservar alpha VP9
- acotar duracion del cuerpo para evitar cola infinita
- mantener posiciones actuales
- no cambiar filtros visuales salvo lo minimo tecnico

## QSV

BreakPoint obtuvo mejora de velocidad con QSV, PERO con costo de peso: con
`global_quality 23` un clip de mucho movimiento quedó ~267 MB vs ~170 MB de
libx264 (+57%) -> descargas web/Dropbox mas lentas. Por eso el valor inicial
recomendado aca es `26` (no 23), midiendo para aterrizar en/bajo el baseline de
x264. En WS no asumir hardware igual al de BP.

Primero detectar:

```powershell
ffmpeg -hide_banner -encoders | findstr /i "qsv nvenc amf"
ffmpeg -hide_banner -hwaccels
wmic path win32_VideoController get name
```

Si hay Intel iGPU/QSV funcional:

- agregar flag `USE_QSV_ENCODER = False` por defecto al inicio.
- agregar `QSV_GLOBAL_QUALITY = "26"` como valor inicial recomendado.
- implementar fallback a libx264 si QSV falla.
- benchmark manual antes de activar.
- activar `USE_QSV_ENCODER=True` solo si el test real en WS pasa.

Si no hay QSV funcional:

- no forzar nada.
- dejar x264 igual.
- reportar.

# archivos importantes

```text
C:\Users\WellStreet\Desktop\Puntazo-release\main.py
C:\Users\WellStreet\Desktop\Puntazo-release\asset_sync.py
C:\Users\WellStreet\Desktop\Puntazo-release\core\pipeline.py
C:\Users\WellStreet\Desktop\Puntazo-release\config.json
C:\Users\WellStreet\Desktop\Puntazo-release\media\Prod\
C:\Users\WellStreet\Desktop\Puntazo-release\media\Prod\.assets_state.json
C:\Users\WellStreet\Desktop\Puntazo-release\media\Prod\.tmp\
```

# alcance

1. Confirmar estado inicial.
2. Confirmar que `asset_sync.py` arranca o queda listo para arrancar.
3. Confirmar que `global__outro` sigue aplicado.
4. Adaptar `core/pipeline.py` para `puntazo_anim.webm` y `ANUNCIO.webm`.
5. Mantener fallbacks PNG actuales.
6. Deduplicar logos club compartidos en `asset_sync.py` si aun no esta robusto.
7. Descargar assets animados por `asset_sync` o sync manual controlado:
   - `puntazo_anim.webm`
   - `ANUNCIO.webm`
8. Benchmark QSV si hay hardware.
9. Si QSV pasa, dejar flag listo y decidir con Isaac si se activa.
10. Restart controlado solo despues de validaciones manuales.

# fuera de alcance

- No cambiar match_full.
- No cambiar listener `pending_pulses`.
- No cambiar `allowed_clubs`.
- No cambiar mapeo cancha/canal.
- No tocar secretos.
- No cambiar nombres remotos salvo usar `nombre:` para assets.
- No publicar Firestore desde la NUC.
- No subir assets desde la NUC.
- No tocar web HTML/assets.
- No implementar posiciones normalizadas `render` todavia.
- No resolver logos distintos por club todavia; hoy ambos usan `wellstreet.png`.

# riesgos

- WS hoy no soporta `puntazo_anim.webm`; activar sin patch haria skip o no-op.
- Si `ANUNCIO.webm` entra sin soporte FFmpeg, no se vera o puede romper render.
- Dos docs de club escriben al mismo `wellstreet.png`; hoy es seguro porque hash
  y contenido son identicos.
- QSV puede no existir o tener comportamiento distinto al de BP.
- Cambiar encoder sin pulso real puede ocultar fallas de reproduccion/subida.
- `asset_sync` puede aplicar un asset nuevo durante una ventana entre clips; si
  llega durante encode, debe entrar al siguiente clip. Esto es aceptable.

# validaciones

## Antes

- Reportar si existe `.git`; si no, decirlo.
- Reportar archivos modificados/untracked.
- Confirmar hashes actuales:
  - `puntazo.png`
  - `wellstreet.png`
  - `ANUNCIO.png`
  - `outro.mp4`
- Confirmar `.assets_state.json`.
- Confirmar remote `nombre:` ve:
  - `/Puntazo/assets/global/v2__logo_puntazo.webm`
  - `/Puntazo/assets/global/v3__anuncio.webm`
  - `/Puntazo/assets/global/v1__outro.mp4`

## Asset sync

- Dry-run:
  - `global__outro` noop.
  - `global__anuncio` replace/apply a `ANUNCIO.webm`.
  - `global__logo_puntazo` replace/apply a `puntazo_anim.webm`.
  - logos club dedupe/noop.
- Sync real controlado:
  - aplica assets compatibles.
  - no borra PNG fallback.
  - `.tmp` queda limpio.
  - `.assets_state.json` actualizado.

## FFmpeg

- Con solo PNG fallback, render sigue funcionando.
- Con `puntazo_anim.webm`, `ANUNCIO.webm` y `wellstreet.png`, render funciona.
- Si se prueba `wellstreet.webm` mock, fallback/deteccion no rompe.
- Alpha se ve correcto.
- Output reproduce local.

## QSV

- Si hay QSV:
  - benchmark x264 vs QSV gq26: comparar PESO y CALIDAD, no solo velocidad.
  - criterio de calidad: juzgar en rallies rapidos (la pelota chica/rapida y la
    red son lo PRIMERO que se rompe con compresion, no el frame estatico). Elegir
    el gq mas alto donde la pelota siga limpia (probable 26-27).
  - output H.264, faststart, 30fps, audio OK.
  - fallback a x264 probado con error inducido o flag falso.
- Si no hay QSV:
  - reportar no disponible y dejar x264.

## Restart

- Solo con OK de Isaac.
- Detener runner por metodo seguro local.
- Levantar con metodo normal de produccion.
- Confirmar logs:
  - runner vivo
  - asset_sync vivo
  - Firestore OK
  - rclone `nombre:` OK
  - heartbeat/listener vivos
  - sin errores FFmpeg

## Pulso real

- Solo con OK de Isaac.
- Generar pulso controlado.
- Confirmar clip subido.
- Confirmar output visual con assets animados compatibles.
- Reportar tiempo y size.

# definition of done

- WS tiene `asset_sync` automatico activo tras restart.
- WS descarga y usa `ANUNCIO.webm` global v3.
- WS descarga y usa `puntazo_anim.webm` global v2, o reporta bloqueo tecnico claro.
- WS conserva PNG fallbacks.
- WS conserva `wellstreet.png` para ambos clubs.
- `global__outro` sigue aplicado.
- Si QSV existe, queda validado y activado solo con OK.
- Runner queda vivo, heartbeat/listener OK.
- No se tocaron secretos/config de clubs/pipeline de pulses.
- El reporte deja claro que WellStreet queda o no queda al nivel BP y por que.

# formato del reporte de regreso

```text
## REPORTE L2 - WellStreet animated assets + QSV

### Resumen ejecutivo
3-5 bullets.

### Archivos modificados
- path - descripcion.

### Estado asset sync
- remote:
- clubs:
- estado/tmp:
- docs aplicados:

### Compatibilidad animados
| Slot | Target | Accion | Resultado |

### QSV
- hardware:
- benchmark:
- flag:
- fallback:

### Validaciones
- hashes antes/despues:
- dry-run:
- sync real:
- render FFmpeg:
- restart:
- pulso real:

### Riesgos / pendientes
Lista breve.

### Resultado
- branch/commit si aplica:
- runner activo:
- que quedo funcionando:

### Confirmacion final
- No toque secrets/config de clubs.
- No toque listener/pulses.
- No borre fallbacks PNG.
- No publique Firestore desde la NUC.
```

