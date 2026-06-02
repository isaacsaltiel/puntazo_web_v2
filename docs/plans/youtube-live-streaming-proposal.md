# Transmisión en vivo a YouTube — estado y propuesta

## Estado actual (auditado 2-jun-2026)
**No existe NADA de streaming en vivo a YouTube** en ninguna carpeta del proyecto
(Puntazo, Puntazo-release, Puntazo26, PUNTAZO_NEW_F1, puntazo-noche,
puntazo-prototipo-modos, Vision_*, JETSON, Analisis_IA). Búsqueda exhaustiva de
`rtmp`, `youtube`, `livestream`, `stream key`, YouTube Live API, OAuth → 0 hits de
código propio. El único `stream_v3.py` (Robótica Visión) es un robot recolector con
MJPEG local, no relacionado. **Es greenfield: nunca se empezó.**

Lo que SÍ existe y se reaprovecha: `ffmpeg.exe` empaquetado en el runner, las
credenciales RTSP del NVR Hikvision por canal, y el patrón de config por cámara.

## Propuesta (cuando se priorice)

### Opción A — Re-stream RTMP por cancha (la más simple, recomendada para v1)
Por cada cancha que se quiera transmitir, un proceso ffmpeg:
```
ffmpeg -rtsp_transport tcp -i rtsp://<user>:<pass>@<NVR_IP>:554/Streaming/Channels/<canal> \
  -c:v copy -c:a aac -f flv rtmp://a.rtmp.youtube.com/live2/<STREAM_KEY>
```
- `-c:v copy` si el NVR ya entrega H.264 compatible (sin reencode → CPU bajísimo).
- Una stream key de YouTube por cancha (canal de YouTube "WellStreet Cancha 1", etc.)
  o un solo canal con transmisiones programadas.
- Gestión: un módulo `live.py` en el runner que arranca/para el ffmpeg por cancha
  según un flag (config o doc Firestore `live_requests/{club}/{cancha}`), para poder
  "ir en vivo" desde la web.

### Opción B — YouTube Live Streaming API (automatizar broadcasts)
Si se quiere crear/agendar broadcasts y bindear streams automáticamente:
`liveBroadcasts.insert` + `liveStreams.insert` + `liveBroadcasts.bind`, con OAuth de
Google del canal. Más complejo (auth, cuotas). Solo si se necesita programación
automática o multi-canal gestionado.

### Integración web (futura)
- Botón "Ver en vivo" por cancha en la web, leyendo un doc Firestore
  `live_status/{club}_{cancha}` (similar a `nuc_heartbeat`) que el runner actualiza:
  `{ live: bool, youtubeUrl, startedAt }`. La web muestra el embed de YouTube.
- Reusar el patrón pending_pulses para "go live"/"stop live" requests.

### Riesgos / consideraciones
- Ancho de banda de subida del club (1080p ≈ 4-6 Mbps por cancha simultánea).
- El NVR debe permitir múltiples lecturas RTSP del mismo canal (clips + live).
- Stream keys = secretos (NO al repo; config local / .env, igual que el resto).

**Decisión pendiente de Isaac**: si se prioriza, arrancar por Opción A (1 cancha
piloto) antes de generalizar.
