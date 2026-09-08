# Worker Local IP — Assets animados (paridad BP/WS) · Worker L para Interpadel

## objetivo

Dejar Interpadel al nivel de BreakPoint/WellStreet en assets gestionados desde
Firestore + Dropbox central, **sin tocar** su pipeline de visión ni la lógica de
pulsos:

- `asset_sync` instalado y activo (thread daemon, no tumba runner).
- Logo Puntazo **animado** `puntazo_anim.webm` con fallback a `puntazo.png`.
- Anuncio **animado** `ANUNCIO.webm` con fallback a `ANUNCIO.png`.
- `outro.mp4` central aplicado.
- Logo de club IP vía `nuc_assets` (cuando esté el seed; ver "Dependencia").

NO cambiar match logic, ingestión de pulsos, ni el encoder/QSV de IP. NO tocar
visión/dashboard/watchdog (Workers J/K/N). Esto es **solo assets**.

> Complementa al brief de Firestore (`worker-local-IP-onboarding-firestore.md`).
> Pueden correr en cualquier orden; son tracks independientes.

## contexto

- IP corre arquitectura **modular** (`core/`+`vision/`+`runner/`, sin `script.py`,
  sin git). El `asset_sync` debe entrar como **módulo nuevo en `core/`**, separado,
  igual que en WellStreet (no incrustarlo en el pipeline de corte).
- Assets locales actuales de IP (confirmar en discovery): `puntazo.png` (logo izq,
  estático), `interpadel.png` (logo der, estático). Outro/anuncio: confirmar si
  existen.
- **rclone remote de IP: DESCONOCIDO — descúbrelo.** ⚠️ CRÍTICO: en WellStreet el
  remote de assets resultó ser un remote local llamado `nombre:`, NO `dropbox:`.
  En IP **no asumas `dropbox:`** — corre `rclone listremotes` y prueba cuál ve los
  paths centrales `/Puntazo/assets/...` antes de cablear nada.

## CONTRATO — docs `nuc_assets` (Firestore) que IP debe resolver

Ya existen y están publicados (BP y WS los consumen hoy):

| doc id | target_filename | version | dropbox_path |
|---|---|---|---|
| `global__logo_puntazo` | `puntazo_anim.webm` | 3 | `/Puntazo/assets/global/v3__logo_puntazo.webm` |
| `global__anuncio` | `ANUNCIO.webm` | 4 | `/Puntazo/assets/global/v4__anuncio.webm` |
| `global__outro` | `outro.mp4` | 3 | `/Puntazo/assets/global/v3__outro.mp4` |
| `club__Interpadel__logo_club` | `interpadel.png` (tentativo) | — | **PENDIENTE de seed central** |

`asset_sync` (igual que WS) debe:
- leer `nuc_assets`, resolver **global + el club `Interpadel`**;
- deduplicar por `target_filename`;
- descargar por `<remote>:{dropbox_path}` (remote descubierto, NO asumir `dropbox:`);
- verificar `sha256` si el doc lo trae (hoy varios vienen `null` → si no hay sha,
  validar por tamaño/no-vacío y `os.replace` atómico);
- reemplazar con `os.replace`, conservar el archivo viejo si algo falla;
- nunca tumbar el runner; si un asset llega durante un encode, entra al siguiente clip.

## Dependencia — seed central del logo de club IP

`club__Interpadel__logo_club` **no existe todavía** en `nuc_assets`. Eso es una
tarea de la **PC central** (subir `interpadel.{png|webm}` a
`/Puntazo/assets/clubs/Interpadel/v1__logo_club.*` + crear el doc Firestore), no de
esta NUC. **Esta dependencia NO bloquea** la cosecha de los 3 assets globales
(logo_puntazo, anuncio, outro): impleméntalos ya. El logo de club IP se aplicará en
cuanto el doc exista (tu `asset_sync` lo tomará solo). Reporta que quedó pendiente.

## FFmpeg / pipeline (adaptación mínima, descubriendo el código de IP)

En el módulo de IP que compone el logo/overlay (descúbrelo; NO reescribir el
pipeline), agregar fallback exacto:

- si existe `puntazo_anim.webm` → usar animado; si no → `puntazo.png`.
- si existe `ANUNCIO.webm` → usar animado; si no → `ANUNCIO.png`.
- si algún día existe `interpadel.webm` → usar animado; si no → `interpadel.png`.

Para `.webm` con alpha (VP9): `-stream_loop -1`, preservar alpha, acotar duración
del cuerpo para no colgar cola infinita, mantener posiciones actuales, no cambiar
filtros visuales salvo lo mínimo técnico.

## alcance

1. Discovery: estructura modular IP, dónde compone el logo, assets locales, rclone
   remote (probar cuál ve `/Puntazo/assets/`), Firestore alcanzable con el SA de IP.
2. `asset_sync.py` como módulo nuevo en `core/`, daemon, con `.assets_state.json` y
   `.tmp/` propios (patrón WS).
3. Dry-run: resolver global + club, mostrar qué bajaría/aplicaría, sin escribir.
4. Sync real controlado de los 3 globales (logo_puntazo, anuncio, outro).
5. Adaptar el compositor a `.webm` con fallback `.png` (los 3 slots).
6. Mantener `puntazo.png` / `interpadel.png` como fallback (no borrarlos).
7. Restart controlado **solo con OK de Isaac**.
8. Pulso real de prueba **solo con OK de Isaac**.

## fuera de alcance

- Visión, dashboard, watchdog, Telegram (J/K/N).
- Listener de pulsos / heartbeat / clip_states (ese es el otro brief).
- Encoder/QSV de IP, filtros visuales.
- Subir assets desde la NUC o publicar `nuc_assets` (eso es central).
- Web. Secretos (no imprimir; saneamiento es HP-IP).
- Logo de club IP: la NUC NO lo sube; solo lo consume cuando el central lo seedee.

## seguridad

- NUNCA imprimir secretos (SA JSON, tokens, pwd NVR) — solo nombre de archivo.
- No publicar a Firestore (la NUC solo LEE `nuc_assets`).
- Restart y pulso real **solo con OK de Isaac**.
- No borrar fallbacks PNG.

## validaciones

**Antes:** `rclone listremotes`; cuál remote ve `/Puntazo/assets/global/v3__logo_puntazo.webm`,
`v4__anuncio.webm`, `v3__outro.mp4`; hashes/tamaños actuales de `puntazo.png` /
`interpadel.png`; Firestore alcanzable.

**Dry-run:** `global__logo_puntazo` → aplica `puntazo_anim.webm`; `global__anuncio`
→ `ANUNCIO.webm`; `global__outro` → `outro.mp4`; `club__Interpadel__logo_club` →
**skip (doc inexistente)**, sin error.

**Sync real:** aplica los 3 globales; no borra PNG; `.tmp` limpio; `.assets_state.json`
actualizado.

**FFmpeg:** con solo PNG → render OK; con `puntazo_anim.webm` + `ANUNCIO.webm` →
render OK, alpha correcto, output reproduce local.

**Restart / pulso real:** solo con OK. Runner vivo, asset_sync vivo, rclone OK,
visión sin errores.

## definition of done

- `asset_sync` activo en IP tras restart (con OK), `.assets_state.json` poblado.
- IP usa `puntazo_anim.webm` (global v3) y `ANUNCIO.webm` (global v4) con fallback PNG.
- `outro.mp4` global v3 aplicado.
- Fallbacks PNG conservados.
- Logo de club IP: pendiente de seed central (reportado), tomado automático cuando exista.
- Pipeline de visión/encode de IP intacto.

## formato del reporte

```
## REPORTE IP — Assets animados

### Resumen ejecutivo
3-5 bullets.

### Discovery
- estructura modular / dónde compone el logo / rclone remote que ve /Puntazo/assets/.

### asset_sync
- módulo / estado / .assets_state.json / .tmp.

### Compatibilidad animados
| Slot | Target | Acción | Resultado |
| logo_puntazo | puntazo_anim.webm | ... | ... |
| anuncio | ANUNCIO.webm | ... | ... |
| outro | outro.mp4 | ... | ... |
| logo_club | interpadel.* | SKIP (sin seed) | pendiente central |

### Validaciones
- dry-run / sync real / render / restart / pulso real.

### Pendientes
- seed central club__Interpadel__logo_club; lo demás.

### Confirmación final
- No imprimí secretos. No toqué visión/web/pulsos. No publiqué a Firestore.
  No borré fallbacks PNG. Restart/pulso real solo con OK de Isaac.
```
