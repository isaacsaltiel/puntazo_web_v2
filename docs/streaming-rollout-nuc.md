# Llevar el streaming a otra NUC (Interpadel / WellStreet)

Cómo replicar en cualquier club lo que ya corre en BreakPoint. Escrito el 7-sep-2026,
después de que el sistema aguantara 27 h continuas en el torneo CPAM.

Contraparte: `docs/streaming-torneo-protocolo.md` (operación) y
`docs/workers/worker-nuc-BP-stream-layout-cpam.md` (contrato Firestore completo).

---

## 0. Decisión: usamos el sistema de MOSAICO, no el viejo de una-cancha-por-broadcast

Hay dos sistemas de streaming en la historia del proyecto. **Solo uno se usa.**

| | Viejo (`stream_commands`, jun-2026) | **Nuevo (`stream_control`, ago-2026)** |
|---|---|---|
| Forma | 1 broadcast por cancha | 1 broadcast por club, mosaico de N canchas |
| Procesos ffmpeg | 1 por cancha | **1 total** |
| Stream keys | 1 por cancha (6 por club) | **1 por club** |
| OAuth YouTube Data API | Requerido (Nivel B) | **No hace falta** |
| Upstream | ~2.5 Mbps × canchas | **850 kbps total** |
| Panel | pestaña 📡 de `admin.html`, solo admin | `control-stream.html` con link secreto, sin cuentas |
| Cambiar vista en vivo | — | 4 modos + break/retomar |
| Probado en producción | **No** (`stream_commands` = 0 docs) | **Sí**: 27 h, 0.13 % frames perdidos |

**El viejo queda deprecado.** No portes `stream_engine.py` / `listener_stream.py` /
`youtube_api.py`. Ignora `docs/workers/worker-nuc-WS-streaming-youtube-pickleball.md`
salvo como contexto histórico.

> Cuándo SÍ tendría sentido el viejo: si quisiéramos que cada cancha tenga su propio
> video permanente en YouTube (para que un jugador comparta el link de SU cancha). No es
> el caso de uso actual. Si algún día lo es, se discute aparte.

---

## 1. Lado web: no hay nada que hacer

El contrato es multi-club por diseño — el id del documento **es** el club. Ya funciona
para cualquier club sin tocar una línea:

- `stream_control/{club}` y `stream_public/{club}` — reglas ya desplegadas, sin lista de
  clubes hardcodeada.
- `/vivo.html?club=Interpadel` — ya sirve, incluido el escaparate de anteriores.
- `/control-stream.html?k=TOKEN` — el token trae el club adentro.
- Banners de `entrada.html` — se prenden solos con `live:true` del club correspondiente.
- Logos: `/assets/logos/interpadel.webp` y `wellstreet.webp` ya existen.

Lo único del maestro: `seed_stream_docs.py <Club>` y `stream_token.py new --club <Club>`.

---

## 2. Lado NUC: el checklist

### PARTE 1 — Que la NUC conteste esto ANTES de escribir código

Mismo cuestionario que salvó el rollout de BP. Datos reales, rutas exactas, sin adivinar:

1. **Hardware**: ¿CPU/iGPU? ¿QSV disponible y funcionando? (`ffmpeg -hwaccels` y una prueba
   real de `hevc_qsv`, no solo que el flag exista).
2. **NVR**: marca/modelo, IP, y **codec del mainstream** (¿HEVC o H.264?). De eso depende
   `hevc_qsv` vs `h264_qsv` en el decode. Lista las URLs RTSP por cancha (censura password).
3. **ffmpeg**: ¿el build trae `--enable-libzmq`? Sin eso no hay break/retomar sin corte
   (`ffmpeg -buildconf | findstr libzmq`).
4. **Upstream real del club** medido, no el del contrato con el ISP.
5. **Canchas a transmitir** y con qué ids las llama el código.
6. **Overlays disponibles** en `media/Prod`: ¿está el logo del club? ¿`puntazo_anim.webm`?
   ¿cortinilla?
7. **Firestore**: ruta del service account y qué watchers ya corren.

### PARTE 2 — Implementar

El contrato completo (campos, semántica de los 4 modos, `air`, espejo de estado) está en
`docs/workers/worker-nuc-BP-stream-layout-cpam.md`. **Está LOCKED — no lo cambies**, la web
ya lo consume tal cual. Pásale ese doc a la NUC del club junto con este.

**El kit ya existe y es idéntico en toda la flota.** La NUC de BP sacó todo lo específico
del sitio a un solo archivo, `stream_club.json`; el resto de `tools/` se copia tal cual:

```json
{
  "club": "Interpadel",                  // = id del doc en Firestore, exacto
  "titulo": "Puntazo · Interpadel",
  "organizador": "Interpadel",
  "nvr_ip": "...", "nvr_user": "...", "nvr_pass": "...",
  "canchas": [3, 4, 5, 6],
  "canal_principal": "{n}01",
  "canal_sub":       "{n}02",
  "logo_club": "Interpadel.webm", "logo_club_png": "Interpadel.png"
}
```

**No asumir la numeración de canales**: `{n}01`/`{n}02` es la convención del NVR de
BreakPoint y puede no ser la misma. Probar cancha por cancha antes de seguir:

```
ffprobe -rtsp_transport tcp -v error -show_entries stream=codec_name,width,height   -of csv=p=0 "rtsp://USER:PASS@NVR_IP:554/Streaming/Channels/302"
```

El principal debe dar ~2560×1440 y el substream 640×360. Si difiere, se ajusta en el JSON
sin tocar código.

**Tampoco asumir el bitrate**: los 720p a 850 kbps son el óptimo **de BreakPoint**, sacado
de medir con VMAF contra ese enlace. Otro club, otro ISP, otro resultado. Al arrancar, mirar
el `speed` de ffmpeg: si no sostiene 1.0x, el bitrate no cabe.

**La URL pública vive en `stream_public_url.txt`, y ese archivo manda**: si se escribe la URL
solo en Firestore, el controlador la revierte a lo que diga el archivo en su siguiente ciclo.

Piezas a construir, en este orden:

1. **Supervisor + ffmpeg base** (equivalente a `stream_forever.bat` + `stream_yt.ps1` de BP):
   decode QSV por cancha → `scale_qsv` 640×360 → `xstack` → **un solo** `h264_qsv` 1280×720
   @ 850 kbps 20 fps → RTMP. Overlays quemados. Apagado por flag (`STOP_STREAM.flag`).
2. **Watcher de `stream_control/{club}`**: aplica `mode`/`primary`/`secondaries`/`air`.
   Idempotencia por `rev > applied_rev` (`rev` = `Date.now()` en ms, **no** un contador).
3. **Espejo a `stream_public/{club}`**: `nuc_seen_at` cada ~15 s + `layout_*` + `air`.
   **Nunca copiar el `token` ahí** — `stream_public` es de lectura pública.
4. **zmq + streamselect** para que break↔live cueste 0 s (en BP: mismo PID, verificado).
   Cambiar de layout sí reinicia el encoder (~7 s) — eso es aceptado.

### PARTE 3 — Específico por club

**⚠️ Las canchas no empiezan en 1 ni son consecutivas.** Verificado contra
`recording_daily` en Firestore (lo que las NUCs realmente graban), 8-sep:

| Club | Canchas REALES | Ojo |
|---|---|---|
| `BreakPoint` | 1 2 3 4 5 | ya funcionando |
| `Interpadel` | **3 4 5 6** | no hay 1 ni 2, y **sí hay 6** |
| `WellStreet-Padel` | 1 2 3 4 | — |
| `WellStreet-Pickleball` | **1 2 3 4 6** | **se salta la 5**, y **sí hay 6** |

> `config_locations.json` (lo que la web ofrece) dice 1–6 para WS-Pickleball, pero la 5
> nunca ha grabado. Para streaming manda `recording_daily`, que es lo que hay con cámara.

**Bug que esto ya destapó (corregido por la NUC de BP el 7-sep):** el código validaba las
canchas contra `1-5` a rajatabla, en tres sitios. Con esa validación, **la Cancha6 de
Interpadel y de WS-Pickleball habría sido rechazada** y el controlador habría descartado
cualquier orden del panel para esa cancha. Ya valida contra las canchas reales del club.

| | Interpadel | WellStreet |
|---|---|---|
| Club id | `Interpadel` | `WellStreet-Pickleball` y/o `WellStreet-Padel` |
| Logo club | `interpadel.png` (ya en `nuc_assets`) | **falta confirmar** que el logo de WS esté en `media/Prod` |
| Mosaico | 2×2 natural con 4 canchas | 5 canchas no caben legibles a la vez — **usar los modos** |

**Stream key**: una sola por club, en YouTube Studio, transmisión persistente/reutilizable.
No reutilizar la de BreakPoint. Va en el archivo de keys de la NUC, **no** a git.

**La URL pública de YouTube la pone Isaac a mano** (la NUC no la conoce: leerla requeriría
OAuth, que a propósito ya no montamos). Va en `stream_public/{club}.youtube_url`.

---

## 3. Además del streaming: las dos guardas del contador

**Esto aplica a las 3 NUCs y no tiene nada que ver con streaming.** Es corrección de datos.

En BreakPoint se encontró que `bump_recording_daily()` contaba el mismo clip más de una vez
cuando su job se reprocesaba. Arreglado el 24-ago con dos guardas:

1. **Idempotencia por job** — registro en disco de clips ya contados
   (`queue/recording_daily_seen.txt`, mismo patrón que `mqtt_seen_events.txt`). Se marca
   como contado **después** de que el incremento sale bien, para que un fallo de red no lo
   dé por contado.
2. **Tope duro de intentos** (`MAX_TOTAL_ATTEMPTS = 8`) evaluado **antes** de procesar, sin
   mirar si la vuelta anterior salió bien o mal. Ese era el hueco: el tope viejo
   (`MAX_PROCESS_ATTEMPTS`) solo se consultaba en la rama de fallo, y el job fantasma
   "triunfaba" cada vez, así que nunca se descartaba.

> 🔑 **Gotcha que casi nos come**: `script.py` de BP **no importaba `io`** y los helpers
> nuevos lo usaban. El fallo era silencioso y "seguro" (devolvía `False` → contaba igual).
> El reinicio se habría visto perfecto con la idempotencia rota desde el día 1.
> **Valida en frío antes de reiniciar**, en cada NUC.

Procedimiento por NUC: respaldo de `script.py` → validación en frío → drenado **sin
`-Force`** → verificar que el registro en disco se está escribiendo.

---

## 4. Riesgos conocidos

- **Límite de directos concurrentes del canal**: BP + IP + WS transmitiendo a la vez son
  3 directos en el mismo canal de Puntazo. Con el mosaico es 1 por club (antes habrían sido
  hasta 16). Si YouTube se queja, hay tope por canal.
- **Puerto ZMQ abierto a la LAN**: el filtro `zmq` de estos builds solo acepta la forma sin
  argumentos → escucha en `0.0.0.0:5555`. Cerrar por firewall **en cada NUC donde se monte**
  (PowerShell como administrador, en esa máquina):
  ```powershell
  New-NetFirewallRule -DisplayName "Puntazo ZMQ solo local" -Direction Inbound -Protocol TCP -LocalPort 5555 -Action Block -Profile Any
  ```
  Loopback no pasa por firewall → el control local sigue funcionando.
- **El controlador de Firestore se muere solo**: en BP se cayó al menos dos veces (antes del
  cierre y otra vez el 28-ago). El watchdog vigila el runner de clips, **no** este proceso.
  Si no se mete al watchdog, el panel va a marcar "NUC no responde" a media transmisión.
  **Resolverlo antes del próximo torneo, en las 3 NUCs.**
- **Audio**: no capturar audio del club (música = strikes de copyright). Ruido inaudible,
  como en BP.
- **Dedup por URL exacta** en el archivado automático de `past_streams`: compara la URL, no
  el video id, así que `/live/xxx` puede duplicar un `watch?v=xxx` del mismo video. Arreglar
  al portar.
