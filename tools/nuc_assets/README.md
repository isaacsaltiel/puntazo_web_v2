# NUC assets publisher

Script central para publicar assets versionados a Dropbox y activar la version en Firestore `nuc_assets`.

## Requisitos

- Service account local:

```text
C:\Users\Isaac\.puntazo-secrets\service_account.json
```

- Rclone con remoto:

```text
dropbox:
```

- Python con `firebase_admin` instalado.

## Dry-run

No sube a Dropbox ni escribe Firestore:

```powershell
python tools\nuc_assets\push_asset.py --dry-run --scope global --slot anuncio --file C:\assets\ANUNCIO.png --target-filename ANUNCIO.png --x 120 --y 48 --width 300
```

Si quieres evitar incluso la lectura de Firestore:

```powershell
python tools\nuc_assets\push_asset.py --dry-run --dry-run-current-version 0 --scope global --slot anuncio --file C:\assets\ANUNCIO.png --target-filename ANUNCIO.png
```

## Publicar global

Anuncio para todas las NUCs:

```powershell
python tools\nuc_assets\push_asset.py --scope global --slot anuncio --file C:\assets\ANUNCIO.png --target-filename ANUNCIO.png --x 120 --y 48 --width 300
```

Logo Puntazo animado para todas:

```powershell
python tools\nuc_assets\push_asset.py --scope global --slot logo_puntazo --file C:\assets\puntazo_anim.webm --target-filename puntazo_anim.webm --animated
```

Outro global:

```powershell
python tools\nuc_assets\push_asset.py --scope global --slot outro --file C:\assets\outro.mp4 --target-filename outro.mp4
```

## Publicar para un club

Logo de BreakPoint:

```powershell
python tools\nuc_assets\push_asset.py --scope club --club BreakPoint --slot logo_club --file C:\assets\BreakPoint.png --target-filename BreakPoint.png
```

Logo de Interpadel:

```powershell
python tools\nuc_assets\push_asset.py --scope club --club Interpadel --slot logo_club --file C:\assets\interpadel.png --target-filename interpadel.png
```

## Regla de scopes

- `logo_club` siempre es por club. No existe `global__logo_club`.
- `logo_puntazo`, `intro`, `outro` y `anuncio` pueden ser globales o tener override por club.

## Como pedirle a Codex que suba un asset

Pidele asi, con path local y destino:

```text
Sube este como anuncio global animado:
C:\ruta\ANUNCIO.webm
target: ANUNCIO.webm
```

```text
Sube este como logo de BreakPoint animado:
C:\ruta\BreakPoint.webm
target: BreakPoint.webm
```

```text
Sube este como logo Puntazo global:
C:\ruta\puntazo_anim.webm
target: puntazo_anim.webm
```

Codex debe:

1. Revisar formato con `ffprobe` si es video.
2. Hacer `--dry-run`.
3. Publicar con `push_asset.py`.
4. Verificar Dropbox con `rclone lsjson`.
5. Verificar Firestore.
6. Reportar doc, version, hash y size.

## Comandos canonicos

Logo Puntazo global animado:

```powershell
python tools\nuc_assets\push_asset.py --scope global --slot logo_puntazo --file C:\assets\puntazo_anim.webm --target-filename puntazo_anim.webm --animated
```

Anuncio global estatico:

```powershell
python tools\nuc_assets\push_asset.py --scope global --slot anuncio --file C:\assets\ANUNCIO.png --target-filename ANUNCIO.png
```

Anuncio global animado:

```powershell
python tools\nuc_assets\push_asset.py --scope global --slot anuncio --file C:\assets\ANUNCIO.webm --target-filename ANUNCIO.webm --animated
```

Logo de club estatico:

```powershell
python tools\nuc_assets\push_asset.py --scope club --club BreakPoint --slot logo_club --file C:\assets\BreakPoint.png --target-filename BreakPoint.png
```

Logo de club animado:

```powershell
python tools\nuc_assets\push_asset.py --scope club --club BreakPoint --slot logo_club --file C:\assets\BreakPoint.webm --target-filename BreakPoint.webm --animated
```

Outro global:

```powershell
python tools\nuc_assets\push_asset.py --scope global --slot outro --file C:\assets\outro.mp4 --target-filename outro.mp4
```

## Compatibilidad NUC

No actives un asset animado para una NUC si su pipeline todavia no soporta ese
`target_filename`.

Estado conocido:

- BreakPoint soporta `puntazo_anim.webm`.
- BreakPoint debe soportar `BreakPoint.webm` y `ANUNCIO.webm` antes de activar
  logo club/anuncio animados.
- WellStreet todavia usa `puntazo.png`, `wellstreet.png`, `ANUNCIO.png`;
  `global__logo_puntazo` webm queda skip hasta adaptar pipeline.

## Como funciona

1. Calcula `sha256` y tamano del archivo local.
2. Lee el doc actual en Firestore para calcular `version + 1`.
3. Sube a Dropbox con nombre inmutable:

```text
/Puntazo/assets/global/vN__slot.ext
/Puntazo/assets/clubs/ClubId/vN__slot.ext
```

4. Verifica que Dropbox tenga el archivo con el tamano esperado.
5. Recien entonces actualiza Firestore.

## Docs Firestore

Global:

```text
nuc_assets/global__anuncio
nuc_assets/global__logo_puntazo
nuc_assets/global__outro
```

Club:

```text
nuc_assets/club__BreakPoint__logo_club
nuc_assets/club__Interpadel__logo_club
```

## Rollback

No borres archivos viejos en Dropbox. Para rollback, apunta el doc Firestore a una ruta/version anterior y baja el `version` solo si el worker NUC esta preparado para aceptar rollback manual. La ruta versionada vieja sigue viva.
