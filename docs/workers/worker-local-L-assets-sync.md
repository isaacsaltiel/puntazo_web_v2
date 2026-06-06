# Worker Local L - Assets sync central + BreakPoint

# objetivo

Implementar el sistema de assets versionados para NUCs, empezando por BreakPoint:

- PC central: `push_asset.py` sube assets a Dropbox y publica el estado activo en Firestore.
- Firebase: coleccion `nuc_assets` como manifiesto de assets activos.
- Dropbox: archivos versionados e inmutables.
- BreakPoint: `asset_sync.py` escucha Firestore, descarga assets a `media/Prod/`, verifica hash y reemplaza atomico sin tocar FFmpeg.

El pipeline de video debe seguir leyendo los mismos nombres locales que ya usa hoy.

# contexto

Puntazo usa runners locales en NUCs para cortar clips desde NVR, aplicar FFmpeg, subir a Dropbox y actualizar la web.

BreakPoint ya tiene:

- Runner en `C:\Puntazo\runner`.
- Assets FFmpeg en `C:\Puntazo\runner\media\Prod`.
- Logo Puntazo animado `puntazo_anim.webm`.
- Logo fallback `puntazo.png`.
- Logo club `BreakPoint.png`.
- Anuncio `ANUNCIO.png`.
- Outro `outro.mp4`.
- `rclone` instalado con remoto `dropbox:`.
- Firebase Admin y listener Firestore `on_snapshot` ya funcionando para `pending_pulses`.

El discovery de BreakPoint reporto:

- `ASSETS_DIR = os.path.join(BASE, "media", "Prod")` en `script.py:121-124`.
- `ffmpeg_amplify_and_logos` en `script.py:1062`.
- `ffmpeg_concat_outro` en `script.py:1141`.
- `procesar_puntazo` en `script.py:3536`.
- Upload actual con `rclone copy` en `script.py:3666-3675`.
- Firestore `on_snapshot` en `script.py:2318-2335`.
- Init listener daemon en `script.py:2369-2395`.

El diseno anterior Worker L era solo Dropbox `/Puntazo/Assets/` + `rclone copy` al boot. Este brief reemplaza ese enfoque por un sistema controlado por Firestore, con versionado, hash y soporte global + override por club.

# arquitectura relevante

## 1. Firestore

Coleccion nueva:

```text
nuc_assets
```

Doc IDs:

```text
global__{slot}
club__{ClubId}__{slot}
```

Ejemplos:

```text
global__logo_puntazo
global__anuncio
global__outro
club__BreakPoint__logo_club
club__Interpadel__logo_club
```

Slots permitidos:

```text
intro
outro
logo_puntazo
logo_club
anuncio
font
```

Shape del doc:

```json
{
  "scope": "global",
  "club": null,
  "slot": "anuncio",
  "is_animated": false,
  "format": "png",
  "dropbox_path": "/Puntazo/assets/global/v4__anuncio.png",
  "version": 4,
  "content_hash": "sha256:9f86d0...",
  "size_bytes": 248576,
  "enabled": true,
  "target_filename": "ANUNCIO.png",
  "render": {
    "x": 120,
    "y": 48,
    "width": 300,
    "height": null,
    "opacity": 1.0,
    "anchor": "top-left",
    "z": 10
  },
  "updated_at": "<serverTimestamp>",
  "updated_by": "operator-cli",
  "applied": {
    "BreakPoint-NUC": {
      "version": 4,
      "hash": "sha256:9f86d0...",
      "ts": "<serverTimestamp>"
    }
  }
}
```

Para `club__BreakPoint__logo_club`:

```json
{
  "scope": "club",
  "club": "BreakPoint",
  "slot": "logo_club",
  "dropbox_path": "/Puntazo/assets/clubs/BreakPoint/v1__logo_club.png",
  "target_filename": "BreakPoint.png"
}
```

Precedencia local:

1. Aplicar docs `global__{slot}`.
2. Aplicar docs `club__{ClubId}__{slot}` encima si existen y `enabled == true`.

## 2. Dropbox

Rutas versionadas:

```text
/Puntazo/assets/global/v1__logo_puntazo.webm
/Puntazo/assets/global/v1__outro.mp4
/Puntazo/assets/global/v1__anuncio.png
/Puntazo/assets/clubs/BreakPoint/v1__logo_club.png
```

Reglas:

- Nunca sobrescribir un asset versionado.
- `push_asset.py` sube `vN__slot.ext`.
- Rollback = cambiar Firestore para apuntar a una version anterior.
- La NUC nunca lee un archivo a medio sobrescribir.

## 3. PC central

Crear script:

```text
tools/nuc_assets/push_asset.py
```

Comandos esperados:

```powershell
python tools/nuc_assets/push_asset.py --scope global --slot anuncio --file C:\assets\anuncio.png --target-filename ANUNCIO.png --x 120 --y 48 --width 300
python tools/nuc_assets/push_asset.py --scope club --club BreakPoint --slot logo_club --file C:\assets\BreakPoint.png --target-filename BreakPoint.png
python tools/nuc_assets/push_asset.py --scope global --slot logo_puntazo --file C:\assets\puntazo_anim.webm --target-filename puntazo_anim.webm --animated
python tools/nuc_assets/push_asset.py --scope global --slot outro --file C:\assets\outro.mp4 --target-filename outro.mp4
```

Orden obligatorio:

1. Calcular sha256 y size.
2. Leer doc Firestore actual.
3. `next_version = (version || 0) + 1`.
4. Subir a Dropbox con `rclone copyto` a ruta versionada.
5. Verificar upload con `rclone check` o descarga/listado + metadata.
6. Recien ahi escribir Firestore en transaccion.

Credenciales:

- Firebase central: `C:\Users\Isaac\.puntazo-secrets\service_account.json`.
- Dropbox central: remoto `dropbox:` ya configurado en rclone.

## 4. BreakPoint NUC

Crear modulo:

```text
C:\Puntazo\runner\asset_sync.py
```

Integrar en:

```text
C:\Puntazo\runner\script.py
```

Modo:

- Thread daemon.
- No bloquear `procesar_puntazo`.
- Degradar si Firestore o rclone falla.
- No tocar FFmpeg.

Estado local:

```text
C:\Puntazo\runner\media\Prod\.assets_state.json
C:\Puntazo\runner\media\Prod\.tmp\
```

Proceso por doc:

1. Recibe snapshot completo de `nuc_assets`.
2. Filtra `global__*` y `club__BreakPoint__*`.
3. Resuelve precedencia global + club.
4. Si `enabled != true`, no descarga ni borra archivo.
5. Si `.assets_state.json` ya tiene `{version, hash}` y el archivo local existe con hash correcto, no-op.
6. Si falta o difiere, descarga desde Dropbox a `.tmp`.
7. Verifica `sha256`.
8. Reemplaza con `os.replace(tmp, media/Prod/{target_filename})`.
9. Actualiza `.assets_state.json`.
10. Opcional: escribe `applied.BreakPoint-NUC` en el doc.

# archivos importantes

## Repo web central

```text
docs/workers/worker-local-L-assets-sync.md
tools/nuc_assets/push_asset.py
tools/nuc_assets/README.md
docs/plans/firestore-rules-v100-fase3.md
docs/plans/firebase-admin-capabilities.md
```

## BreakPoint runner

```text
C:\Puntazo\runner\script.py
C:\Puntazo\runner\asset_sync.py
C:\Puntazo\runner\media\Prod\
C:\Puntazo\runner\media\Prod\.assets_state.json
C:\Puntazo\runner\media\Prod\.tmp\
C:\Puntazo\runner\secrets\*.json
```

## BreakPoint assets conocidos

```text
C:\Puntazo\runner\media\Prod\puntazo_anim.webm
C:\Puntazo\runner\media\Prod\puntazo.png
C:\Puntazo\runner\media\Prod\BreakPoint.png
C:\Puntazo\runner\media\Prod\ANUNCIO.png
C:\Puntazo\runner\media\Prod\outro.mp4
```

# alcance

## PC central

- Crear `tools/nuc_assets/push_asset.py`.
- Crear `tools/nuc_assets/README.md` con ejemplos de uso.
- Soportar `--scope global`.
- Soportar `--scope club --club <ClubId>`.
- Soportar `--slot`.
- Soportar `--file`.
- Soportar `--target-filename`.
- Soportar render opcional: `--x`, `--y`, `--width`, `--height`, `--opacity`, `--anchor`, `--z`.
- Soportar `--animated`.
- Calcular `sha256:<hex>`.
- Subir con `rclone copyto`.
- Verificar upload antes de escribir Firestore.
- Escribir doc Firestore con `serverTimestamp`.
- Validar slots, scope, club y extensiones.
- Modo `--dry-run` que no sube ni escribe.

## Firebase

- Agregar regla Firestore:

```js
match /nuc_assets/{id} {
  allow read, write: if false;
}
```

- La regla debe ir antes del catch-all.
- Deploy solo con aprobacion del maestro si toca rules productivas.
- No modificar reglas de `pending_pulses`, `clip_states`, `matches` ni otras colecciones.

## BreakPoint

- Crear `asset_sync.py`.
- Integrar arranque como thread daemon desde `script.py`.
- Reusar cliente Firestore o patron de inicializacion existente.
- Usar `rclone copyto` para bajar desde `dropbox:{dropbox_path}` a `.tmp`.
- Verificar hash antes del reemplazo.
- Usar `os.replace` para reemplazo atomico.
- Manejar `PermissionError` en Windows con retry/backoff.
- Guardar estado local.
- Loguear acciones y errores.
- Mantener archivo viejo si descarga/hash/reemplazo falla.

# fuera de alcance

- No modificar FFmpeg, filtros, posiciones actuales ni comandos de render.
- No cambiar `procesar_puntazo` salvo el arranque del thread de assets.
- No borrar assets viejos locales.
- No borrar assets viejos en Dropbox.
- No cambiar pipeline de subida de clips a Dropbox.
- No tocar web assets HTML/JS/CSS.
- No cambiar reglas de colecciones existentes.
- No cambiar secretos, PATs, NVR password ni service accounts.
- No implementar UI web para gestionar assets.
- No implementar Interpadel ni WellStreet en este primer worker.
- No habilitar `intro` si BP no lo usa hoy.

# riesgos

- Windows puede bloquear reemplazo si FFmpeg tiene el archivo abierto. Mitigar con `.tmp`, `os.replace`, retry y conservar viejo.
- `target_filename` debe coincidir con nombres reales actuales. En BP son case-sensitive a nivel de convencion aunque Windows no lo sea: `ANUNCIO.png`, `BreakPoint.png`, `outro.mp4`, `puntazo_anim.webm`.
- Si `push_asset.py` escribe Firestore antes de que Dropbox tenga bytes validos, las NUCs intentaran descargar algo inexistente. Por eso el orden bytes primero, commit despues es obligatorio.
- Si se toca rules sin validar contra prod, puede romper flujos no relacionados. Cambiar solo `nuc_assets`.
- Si el listener de assets lanza excepcion no capturada, no debe tumbar el runner.
- Si se aplican overrides por club mal nombrados, una NUC puede no recibir el logo esperado.
- Assets grandes pueden tardar. La descarga debe ir fuera del hilo principal.

# validaciones

## PC central

- `python tools/nuc_assets/push_asset.py --help` muestra comandos claros.
- `--dry-run` para un asset local calcula hash, version destino y doc id sin subir ni escribir.
- Upload real de un archivo pequeno de prueba a `/Puntazo/assets/global/` funciona.
- Firestore doc se escribe solo despues de verificar Dropbox.
- Re-ejecutar el mismo slot incrementa version monotonicamente.
- Scope `club` exige `--club`.
- Slot invalido falla antes de subir.
- `target_filename` faltante falla con mensaje claro.

## Firebase

- Rule `nuc_assets` deployada antes del catch-all.
- Cliente web normal no puede leer ni escribir `nuc_assets`.
- Admin SDK central si puede leer/escribir `nuc_assets`.

## BreakPoint

- Runner arranca sin romper si Firestore no esta disponible.
- Runner arranca sin romper si `rclone` no esta disponible.
- Snapshot inicial baja assets faltantes.
- Si el asset local ya coincide con version/hash, no-op.
- Si hash descargado no coincide, conserva archivo viejo.
- Si `os.replace` falla por archivo ocupado, conserva archivo viejo y reintenta.
- `.assets_state.json` queda actualizado tras exito.
- FFmpeg sigue procesando un clip normal despues de instalar Worker L.
- No hay cambios en filtros FFmpeg ni nombres que lee el pipeline.

# definition of done

- Existe `push_asset.py` central funcional y documentado.
- Existe coleccion `nuc_assets` con al menos docs iniciales para BreakPoint:

```text
global__logo_puntazo
global__anuncio
global__outro
club__BreakPoint__logo_club
```

- Los archivos correspondientes existen en Dropbox bajo rutas versionadas.
- Firestore rules bloquean acceso cliente a `nuc_assets`.
- BreakPoint tiene `asset_sync.py` instalado.
- BreakPoint arranca asset sync como thread daemon.
- BreakPoint puede actualizar `media/Prod/ANUNCIO.png` desde un cambio publicado por `push_asset.py` sin tocar FFmpeg.
- Si Dropbox/Firebase falla, BP conserva assets viejos y sigue procesando clips.
- El worker reporta branch, commit, validaciones y cualquier pendiente.

# formato del reporte de regreso

```text
## REPORTE ETAPA L - assets-sync

### Resumen ejecutivo
Una a tres oraciones: que se hizo.

### Archivos modificados
- `path/to/file.ext` (nuevo | modificado | eliminado) - descripcion de 1 linea.

### Decisiones tecnicas tomadas
- Decision: X. Justificacion: Y. Alternativa descartada: Z.

### Bugs encontrados
Solo si los hubo en codigo existente al investigar. Tipo, archivo, severidad.

### Riesgos detectados
Si descubriste algo del scope ajeno que el maestro debe saber.

### Que quedo pendiente
Items dentro del scope que no terminaste, con razon.

### Que validaciones se hicieron
Cada item del bloque "Validaciones" del brief: status (OK/FAIL/SKIP) + output observado.

### Resultado
Branch + commit SHA + que quedo funcionando + que archivos puede revisar el maestro.

### Recomendacion al arquitecto maestro
Que etapa proponen como siguiente y por que.
```
