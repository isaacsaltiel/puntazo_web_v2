# Worker L assets sync - estado operativo 2026-06-05

> Memoria operativa del nuevo sistema de assets NUC. Este doc registra el
> rollout real en BreakPoint y el contrato para replicarlo en WellStreet e
> Interpadel.

## Resumen ejecutivo

- **BreakPoint ya esta activo y funcionando con Worker L.**
- La PC central publica assets con `tools/nuc_assets/push_asset.py`.
- Firestore `nuc_assets` es el manifiesto de verdad.
- Dropbox guarda los bytes versionados e inmutables.
- Cada NUC sincroniza a su carpeta local de FFmpeg sin cambiar el pipeline.
- En BP, `asset_sync` ya corre como thread daemon tras restart controlado.

## Que problema resuelve

Antes, cambiar logo/anuncio/outro implicaba tocar cada NUC manualmente o
depender de copias locales no documentadas.

Ahora:

1. Se publica un asset desde la PC central.
2. El archivo queda versionado en Dropbox.
3. Firestore apunta a la version activa.
4. La NUC descarga, verifica hash y reemplaza su archivo local.
5. FFmpeg sigue leyendo el mismo filename de siempre.

## Contrato de arquitectura

### Firestore

Coleccion:

```text
nuc_assets
```

Docs globales:

```text
global__logo_puntazo
global__intro
global__outro
global__anuncio
```

Docs por club:

```text
club__BreakPoint__logo_club
club__WellStreet__logo_club
club__Interpadel__logo_club
```

Regla de scopes:

- `logo_club` **siempre** es por club. No existe `global__logo_club`.
- `logo_puntazo`, `intro`, `outro` y `anuncio` pueden ser globales o tener
  override por club.

Shape del doc:

```json
{
  "scope": "global",
  "club": null,
  "slot": "outro",
  "is_animated": false,
  "format": "mp4",
  "dropbox_path": "/Puntazo/assets/global/v1__outro.mp4",
  "version": 1,
  "content_hash": "sha256:...",
  "size_bytes": 123,
  "enabled": true,
  "target_filename": "outro.mp4",
  "render": {},
  "updated_at": "<serverTimestamp>",
  "updated_by": "operator-cli",
  "applied": {
    "BreakPoint-NUC": {
      "version": 1,
      "hash": "sha256:...",
      "ts": "<serverTimestamp>"
    }
  }
}
```

### Dropbox

Rutas versionadas:

```text
/Puntazo/assets/global/vN__slot.ext
/Puntazo/assets/clubs/ClubId/vN__slot.ext
```

Reglas:

- No sobrescribir archivos versionados.
- Publicar como `vN__slot.ext`.
- Rollback = apuntar Firestore a una version anterior.
- La NUC nunca reemplaza su archivo local hasta verificar hash.

### PC central

Script:

```text
tools/nuc_assets/push_asset.py
```

Docs de uso:

```text
tools/nuc_assets/README.md
```

Orden del publish:

1. Calcula hash y size.
2. Lee version actual en Firestore.
3. Sube a Dropbox con `rclone copyto`.
4. Verifica size con `rclone lsjson`.
5. Escribe Firestore en transaccion.

El script ya valida que `logo_club` no pueda publicarse como global.

## Estado real publicado

| Doc | Dropbox path | Target filename | Version | Hash | Size | Origen |
|---|---|---|---:|---|---:|---|
| `global__logo_puntazo` | `/Puntazo/assets/global/v1__logo_puntazo.webm` | `puntazo_anim.webm` | 1 | `sha256:a423fe9cf794c5f089df087236128b12e5c3a1290ee80f5590490a03a070730a` | 2498631 | seed BP |
| `global__anuncio` | `/Puntazo/assets/global/v1__anuncio.png` | `ANUNCIO.png` | 1 | `sha256:12d784953ab1638d011b999a47605edcfd17bf595ce35f6fee8a80e55c17c830` | 2218418 | seed BP |
| `global__outro` | `/Puntazo/assets/global/v1__outro.mp4` | `outro.mp4` | 1 | `sha256:2da07f4ed1554958dd45440873f4d5b819e5ef637aece85eb3c17685c36d02cb` | 1561638 | PC central |
| `club__BreakPoint__logo_club` | `/Puntazo/assets/clubs/BreakPoint/v1__logo_club.png` | `BreakPoint.png` | 1 | `sha256:6656b767905be86797df14203f3755fbb01e956c8e1171b425f0c62d224f7e6f` | 1555432 | seed BP |
| `club__WellStreet-Pickleball__logo_club` | `/Puntazo/assets/clubs/WellStreet-Pickleball/v1__logo_club.png` | `wellstreet.png` | 1 | `sha256:3fe9065bb40f177331c0931ccad8669b264fbac115d6c10982ed4ce90310c19d` | 20000 | seed WS |
| `club__WellStreet-Padel__logo_club` | `/Puntazo/assets/clubs/WellStreet-Padel/v1__logo_club.png` | `wellstreet.png` | 1 | `sha256:3fe9065bb40f177331c0931ccad8669b264fbac115d6c10982ed4ce90310c19d` | 20000 | seed WS |

## BreakPoint - estado final

BreakPoint quedo con Worker L activo.

Runner:

```text
C:\Puntazo\runner
```

Assets locales:

```text
C:\Puntazo\runner\media\Prod
```

Estado local:

```text
C:\Puntazo\runner\media\Prod\.assets_state.json
```

Temporales:

```text
C:\Puntazo\runner\media\Prod\.tmp\
```

Archivos agregados/modificados en BP:

```text
C:\Puntazo\runner\asset_sync.py
C:\Puntazo\runner\script.py
C:\Puntazo\runner\.gitignore
```

Integracion:

- `script.py` arranca `asset_sync.start_background(...)` como thread daemon.
- Si Firestore falla, se loguea y el runner sigue.
- Si rclone falla, se loguea y el runner sigue.
- No se tocaron comandos ni filtros FFmpeg.
- No se borraron assets viejos.

Restart controlado BP:

- Runner anterior:
  - `cmd.exe`: PID `12048`
  - `python.exe script.py`: PID `5764`
- Watchdog quedo vivo: PID `12036`.
- Runner nuevo:
  - `cmd.exe run_forever.bat`: PID `3544`
  - `python.exe script.py`: PID `1372`
  - `script.pid`: `1372`

Logs confirmados:

```text
Firestore publisher arrancado
R4 pulse listener arrancado
R6 NUC heartbeat arrancado
asset_sync: thread arrancado
Rclone OK: C:\Users\Puntazo BreakPoint\AppData\Local\Microsoft\WinGet\Links\rclone.EXE
[R4] listener iniciado: club=BreakPoint, watching pending_pulses
[R6] heartbeat NUC arrancado
```

Estado operativo:

- `asset_sync` vio los 4 docs.
- Tras aplicar el nuevo outro, los 4 docs quedaron en noop por hash correcto.
- `media\Prod\outro.mp4` quedo con hash:

```text
sha256:2da07f4ed1554958dd45440873f4d5b819e5ef637aece85eb3c17685c36d02cb
```

- Heartbeat fresco confirmado.
- Watchdog reportando normal.
- No habia procesos FFmpeg activos despues del restart.

Commit local BP:

```text
branch: worker-pat-rotation-bp-2026-06-03
sha: eae67e6be59903414b9c9a5d6f9467e83bdab2c1
message: feat: add asset sync worker and optional QSV encoder
files: script.py, asset_sync.py, .gitignore
```

QSV:

- `USE_QSV_ENCODER = False` por defecto.
- Con flag apagado, BP mantiene comportamiento actual `libx264`.
- Benchmark validado: QSV bajo el pipeline completo logos+outro de `38.6s` a
  `23.4s` en clip de prueba, con H.264 baseline, faststart, 30fps y audio OK.
- Fallback a `libx264` validado si QSV falla.
- Pendiente: activar manualmente `USE_QSV_ENCODER = True`, reiniciar runner y
  validar con un pulso real antes de dejarlo como default operativo.

## WellStreet - seed completado

WellStreet opera dos clubs en la misma NUC:

```text
WellStreet-Pickleball
WellStreet-Padel
```

Discovery:

- Runner: `C:\Users\WellStreet\Desktop\Puntazo-release`.
- Entrypoint: `main.py`.
- Pipeline modular en `core/`.
- Assets locales en `media/Prod`.
- FFmpeg usa un solo logo de club generico: `wellstreet.png`.
- Ese mismo `wellstreet.png` aplica hoy a Pickleball y Padel.

Seed:

- Se crearon los dos docs de club.
- Ambos apuntan a `target_filename = wellstreet.png`.
- Ambos tienen el mismo hash y size.
- Los globals solo fueron leidos, no modificados.

Nota operativa:

- En WellStreet, el remoto que ve los assets centrales es `nombre:`.
- `dropbox:` no vio el path exacto de `/Puntazo/assets/global/v1__outro.mp4`.
- Por eso Worker L en WS debe usar el remoto configurado localmente como
  `nombre:` para descargar assets.

Riesgo especifico WS:

- Hay dos docs `logo_club` que resuelven al mismo `target_filename` y al mismo
  hash. `asset_sync.py` debe deduplicar por target/hash para no tratarlo como
  conflicto.

## WellStreet - Worker L instalado, restart pendiente

Worker L quedo instalado en WellStreet y validado manualmente.

Archivos modificados en WS:

```text
C:\Users\WellStreet\Desktop\Puntazo-release\asset_sync.py
C:\Users\WellStreet\Desktop\Puntazo-release\main.py
C:\Users\WellStreet\Desktop\Puntazo-release\.gitignore
```

Integracion:

- `main.py` llama `start_background_sync(stop_event=STOP_EVENT)`.
- Remote local usado: `nombre:`.
- Clubs configurados:
  - `WellStreet-Pickleball`
  - `WellStreet-Padel`
- Estado local:
  - `media/Prod/.assets_state.json`
- Temporales:
  - `media/Prod/.tmp/`

Resultado del sync manual:

| Doc | Target | Version | Accion | Resultado |
|---|---|---:|---|---|
| `global__logo_puntazo` | `puntazo_anim.webm` | 2 | `skip_incompatible_format` | WS aun lee `puntazo.png`; no se aplico webm |
| `global__anuncio` | `ANUNCIO.png` | 1 | noop | hash correcto |
| `global__outro` | `outro.mp4` | 1 | replace | aplicado |
| `club__WellStreet-Padel__logo_club` + `club__WellStreet-Pickleball__logo_club` | `wellstreet.png` | 1 | noop/dedupe | hash correcto |

Hashes finales confirmados:

```text
outro.mp4    sha256:2da07f4ed1554958dd45440873f4d5b819e5ef637aece85eb3c17685c36d02cb
ANUNCIO.png  sha256:12d784953ab1638d011b999a47605edcfd17bf595ce35f6fee8a80e55c17c830
wellstreet.png sha256:3fe9065bb40f177331c0931ccad8669b264fbac115d6c10982ed4ce90310c19d
```

Pendiente:

- Hacer restart controlado para activar el thread automatico de `asset_sync`.
- `global__logo_puntazo` queda pendiente en WS hasta adaptar soporte de
  `puntazo_anim.webm` o decidir mantener `puntazo.png` local.

## Como publicar cambios futuros

Ejemplo: nuevo anuncio global.

```powershell
python tools\nuc_assets\push_asset.py --scope global --slot anuncio --file C:\assets\ANUNCIO.png --target-filename ANUNCIO.png
```

Ejemplo: nuevo outro global.

```powershell
python tools\nuc_assets\push_asset.py --scope global --slot outro --file C:\assets\outro.mp4 --target-filename outro.mp4
```

Ejemplo: logo de BreakPoint.

```powershell
python tools\nuc_assets\push_asset.py --scope club --club BreakPoint --slot logo_club --file C:\assets\BreakPoint.png --target-filename BreakPoint.png
```

## Importante

El seed hecho por BP fue una excepcion unica para aprovechar los assets buenos
que ya estaban en esa NUC.

Desde ahora:

- La PC central publica assets.
- Las NUCs solo sincronizan.
- BP ya no debe publicar assets.

## Pendientes

- WellStreet: instalar Worker L con remote local `nombre:` y dedupe de
  `wellstreet.png` para Pickleball/Padel.
- Interpadel: discovery de carpeta local y nombres exactos.
- Interpadel: instalar Worker L despues del discovery.
- Firestore Rules: agregar bloqueo explicito:

```js
match /nuc_assets/{id} {
  allow read, write: if false;
}
```

Hasta deployar esa regla, `nuc_assets` ya existe por Admin SDK, pero conviene
cerrar acceso cliente antes de escalar a mas NUCs.

## Evidencia central

Desde la PC central se verifico:

- Firestore contiene los 4 docs con version, hash, size, target y path correcto.
- Dropbox lista los 4 archivos con size esperado.
- `push_asset.py` compila.
- `push_asset.py` rechaza `--scope global --slot logo_club`.
