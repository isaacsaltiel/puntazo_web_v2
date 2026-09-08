# Brief NUC — Streaming en vivo a YouTube en **WellStreet-Pickleball**

**Para:** el Claude que corre en la **NUC de WellStreet** (lado de ejecución).
**De:** el Claude maestro (PC de Isaac — Firestore + web).
**Asunto:** llevar el subsistema de **transmisión en vivo a YouTube** —ya validado y
LIVE en la NUC de Interpadel— a **WellStreet, solo las canchas de Pickleball (6)**.

> El lado web/Firestore **ya soporta WellStreet sin cambios**: el panel 📡 Streaming de
> `admin.html` lee TODAS las locaciones de `config_locations.json` (WellStreet-Pickleball
> con 6 canchas ya está) y las reglas de `stream_commands` gatean por `flags.isAdmin`
> (no por club). O sea: las canchas de WS **ya aparecen** en el panel con START/STOP; no
> hacen nada hasta que esta NUC esté conectada. **Todo lo que falta es tu lado.**

---

## 0. Decisiones ya tomadas por Isaac (no las re-preguntes)

1. **Canal de YouTube = el MISMO canal Puntazo** que usa Interpadel.
   → **Reusa el mismo `youtube_token.json`** que la NUC de Interpadel (es el dueño del
   canal). **No hay OAuth nuevo.** PERO: necesitas **6 stream keys NUEVAS y distintas**
   (una por cancha de WS) creadas en ese mismo canal — **nunca** reusar las keys de
   Interpadel (YouTube rechaza la misma key en dos encoders simultáneos).
2. **Alcance = solo Pickleball, 6 canchas.** `club_key = "WellStreet-Pickleball"`.
   (NO incluir WellStreet-Padel en esta ronda.)
3. **El código de streaming NO está en esta NUC todavía** → este brief incluye
   **portarlo** desde la NUC de Interpadel + configurarlo.

---

## 1. Contrato Firestore (ya está del lado web — solo para que sepas qué leer/escribir)

Colección **`stream_commands`**, **1 doc por cancha**, id = `<club>_<canchaId>`.
Para WS las canchas son `Cancha1`…`Cancha6`, así que los docs son:

```
WellStreet-Pickleball_Cancha1 … WellStreet-Pickleball_Cancha6
```

**La web escribe** (estado deseado): `club="WellStreet-Pickleball"`, `cancha="Cancha1"`,
`action="START"|"STOP"`, `titulo`, `requested_at`, `requested_by`.
**Tú escribes de vuelta** (estado real): `status` (`STARTING|LIVE|RECONNECTING|STOPPING|OFFLINE|ERROR`),
`youtube_url`, `broadcast_id`, `started_at`, `stopped_at`, `last_error`, `updated_by`, `updated_at`.

> El filtro del listener es `where club == "WellStreet-Pickleball"`. El campo `cancha`
> llega como `"Cancha1"` o `"1"` — el motor extrae el dígito y lo cruza con `cameras`
> del `config.json`. Auth Firestore = el mismo Service Account que ya usa
> `pending_pulses` (Admin SDK, omite reglas).

---

## 2. Portar el código (desde la NUC de Interpadel)

Copia estos módulos de la NUC de Interpadel (proyecto `PUNTAZO_NEW_F1`) a esta NUC,
respetando rutas:

| Archivo | Rol |
|---|---|
| `core/stream_engine.py` | Motor: 1 ffmpeg/cancha (hevc_qsv→h264_qsv + logos + audio), auto-restart, backoff, freeze-detect, fallback QSV→software. |
| `core/listener_stream.py` | Listener Firestore `on_snapshot` sobre `stream_commands`; reconcilia START/STOP vs estado real del motor; writeback; replay-on-boot. |
| `core/youtube_api.py` | Nivel B: crea broadcast con título por partido y lo enlaza a la stream key; degrada a Nivel A si no hay token. |
| `core/youtube_authorize.py` | (Opcional — NO lo necesitas porque reusas el token de Interpadel.) |
| Doc técnica | `docs/STREAMING.md` y `docs/HANDOFF_CLAUDE_MAESTRO.md` de la NUC de Interpadel. |

Wiring:
1. `pip install google-api-python-client google-auth-oauthlib google-auth-httplib2`
   (en el venv/entorno de esta NUC).
2. En `core/main.py`: arrancar el listener de streaming si `streaming.enabled` (mismo
   patrón que ya usa el listener de `pending_pulses`). Copia el bloque equivalente de
   la NUC de Interpadel.
3. **Cambios aditivos**: no tocar el flujo de pulsos/recovery/`match_full` existente.

---

## 3. Config (`CONTEXTO/config.json → streaming`)

```jsonc
"streaming": {
  "enabled": false,                         // prender SOLO al final (paso §7)
  "club_key": "WellStreet-Pickleball",      // == loc.id que escribe la web. CRÍTICO.
  "commands_collection": "stream_commands",
  "keys_file": "stream_keys.json",
  "resolution": "1280x720",
  "video_bitrate": "2500k",
  "audio_amplitude": 0.0015,                // ruido inaudible (YouTube exige audio)
  "framerate": 25,
  "gop": 50,                                // keyframe 2s (= 2× fps)
  "decode": "hevc_qsv",                     // ⚠️ confirmar codec mainstream del NVR de WS
  "encode": "h264_qsv",                     // ⚠️ confirmar QSV disponible; si no, "libx264"
  "enable_logos": true,
  "reconnect_delay_sec": 10,
  "freeze_timeout_sec": 30,
  "youtube_api": {
    "enabled": true,
    "token_file": "youtube_token.json",     // EL MISMO de Interpadel (mismo canal)
    "privacy": "public",                    // decisión de Isaac
    "latency": "normal"                     // estable para 24/7
  }
}
```

**`cameras`:** confirma que `config.json → cameras` ya tiene `Cancha1`…`Cancha6` de WS
con su `channel_id` del NVR (lo más probable es que ya existan porque pulsos/posters ya
corren en WS). El motor mapea el dígito de la cancha → `channel_id`. Si falta una
cancha en `cameras`, agrégala antes de prender.

---

## 4. Stream keys y token de YouTube

1. **YouTube Studio (cuenta dueña del canal Puntazo):** crea **6 transmisiones
   persistentes/reutilizables**, una por cancha de WS, cada una con su **stream key
   propia**. NO reutilices las 6 keys de Interpadel — son canchas distintas
   transmitiendo en paralelo.
2. **`stream_keys.json`** (raíz del proyecto NUC, NO subir a git):
   ```json
   {
     "Cancha1": "xxxx-xxxx-xxxx-xxxx-wsp1",
     "Cancha2": "xxxx-xxxx-xxxx-xxxx-wsp2",
     "Cancha3": "xxxx-xxxx-xxxx-xxxx-wsp3",
     "Cancha4": "xxxx-xxxx-xxxx-xxxx-wsp4",
     "Cancha5": "xxxx-xxxx-xxxx-xxxx-wsp5",
     "Cancha6": "xxxx-xxxx-xxxx-xxxx-wsp6"
   }
   ```
3. **`youtube_token.json`**: copia el MISMO que ya tiene la NUC de Interpadel (mismo
   canal → mismo dueño). Ponlo en la ruta de `streaming.youtube_api.token_file`.
   No corras `youtube_authorize.py`.

> Nivel B sigue usando la key como ingest; el broadcast con título por partido se enlaza
> a esa key por API. Como el token es del dueño del canal, resuelve el `liveStream id` de
> cada key sin problema. Varias canchas en paralelo en el mismo canal = OK mientras cada
> una tenga su key. (Si YouTube se queja por límite de directos concurrentes en el canal,
> avísame: hay tope por canal y entre Interpadel + WS podríamos rozarlo — ver §6.)

---

## 5. Logos quemados (NO dejes el logo de Interpadel)

El ffmpeg quema overlays de `media/Prod` (`puntazo.png` + logo del club + `ANUNCIO.png`).
Para WS, el logo del club debe ser **el de WellStreet**, no `interpadel.png`. Asegúrate
de que `media/Prod` en esta NUC tenga el logo de WellStreet y que el filter_complex lo
use. Si no tienes el logo de WS en la NUC, pídemelo al maestro (lo distribuyo por
`nuc_assets` igual que los demás logos de club) o corre con `enable_logos:false`
temporalmente (solo Puntazo) hasta tenerlo.

---

## 6. Validar ANTES de prender (riesgos reales de WS)

- **⚠️ QSV / hardware:** el pipeline se validó en el N150 de Interpadel (~20% CPU/cancha
  con `hevc_qsv`+`h264_qsv`). **Confirma que esta NUC tiene iGPU Intel con QSV.** Si no
  inicializa, el motor cae a `libx264 -preset veryfast` (mucho más CPU) y avisa por
  Telegram. Con software puro, 6 canchas pickleball en paralelo probablemente **no**
  aguanta — mide.
- **⚠️ Upstream del club:** ~2.5 Mbps de subida por cancha. **Mide el upload real de WS
  antes de prometer N canchas.** Estrategia recomendada: transmitir **solo canchas
  activas** (1–2 a la vez), no las 6 24/7. Esto además respeta el límite de directos
  concurrentes del canal compartido con Interpadel.
- **⚠️ Codec del NVR:** `decode:hevc_qsv` asume mainstream HEVC (como Hikvision de
  Interpadel). Si el NVR de WS manda H.264 en mainstream, pon `decode:h264_qsv`.
- **Música = strikes:** no captures audio del club (mandamos ruido inaudible). El canal
  es público.

---

## 7. Prender y verificar (E2E)

1. `streaming.enabled = true` en `config.json` → reiniciar el sistema NUC.
2. En la web, tab **📡 Streaming**, bloque **WellStreet - Pickleball**: el panel ya
   muestra las 6 canchas. Manda **START** en una.
3. Esperado: el doc `WellStreet-Pickleball_Cancha1` pasa `status: STARTING → LIVE`,
   aparece `youtube_url` y el botón **▶ Ver en vivo** en el panel. CPU ~20%/cancha si QSV.
4. **STOP** → `status: STOPPING → OFFLINE`.
5. **Reinicio del NUC** con una cancha en START → replay-on-boot la vuelve a poner LIVE
   sola.
6. Logs por cancha: `logs/stream_camN.log`. General: `logs/script.log`.

---

## 8. Qué te entrego yo (maestro) — ya está, no esperes nada

- Panel 📡 multi-club en `admin.html` (el bloque de WS ya sale, lee `config_locations.json`).
- Reglas `stream_commands` desplegadas (escritura web gated por `flags.isAdmin`, sin
  filtro de club; ya tengo el flag).
- `config_locations.json` ya tiene `WellStreet-Pickleball` con Cancha1…6.

## 9. Qué necesito de ti (NUC) — para cerrar

| Tarea | Dueño |
|---|---|
| Portar `stream_engine.py` / `listener_stream.py` / `youtube_api.py` + wiring en `main.py` | NUC |
| `pip install` libs de YouTube | NUC |
| Bloque `streaming` en `config.json` (con `club_key=WellStreet-Pickleball`) | NUC |
| Confirmar `cameras` Cancha1..6 con channel_id | NUC |
| 6 stream keys NUEVAS en YouTube Studio (mismo canal) + `stream_keys.json` | Isaac |
| Copiar `youtube_token.json` de la NUC de Interpadel | Isaac |
| Logo de WellStreet en `media/Prod` (o `enable_logos:false` temporal) | NUC / pedir al maestro |
| Medir upstream real + decidir cuántas canchas simultáneas | Isaac |
| `streaming.enabled=true` + restart | Isaac |

## Reglas
- **No imprimir secretos** (stream keys, token): solo longitud + prefijo si hace falta.
- **Cambios aditivos**: no romper pulsos/recovery/`match_full`.
- Ante la duda de nombres (colección/campos/club_key), confírmalos contra este brief.

— Claude maestro (PC de Isaac)
