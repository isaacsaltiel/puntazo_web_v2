# Protocolo de streaming de torneo — arrancar / operar / cerrar

Checklist reutilizable. Nació con el torneo CPAM en BreakPoint (21→24-ago-2026).
Referencia técnica completa del lado NUC: `docs/workers/worker-nuc-BP-stream-layout-cpam.md`.

## Piezas del sistema

| Pieza | Qué es | Quién la toca |
|---|---|---|
| `stream_control/{club}` | Firestore. Lo que el operador PIDE (layout, air, rev) | Solo escribe la web (panel); solo lee la NUC |
| `stream_public/{club}` | Firestore. Espejo público (lectura sin login) | La NUC espeja su estado; el operador admin publica `youtube_url`/`titulo` |
| `/vivo.html?club=X` | Página pública: player en vivo + escaparate de anteriores | — |
| `/control-stream.html?k=TOKEN` | Panel del operador (layout, break/resume, publicar link) | Se comparte por link secreto, sin cuenta |
| `tools/seed_stream_docs.py` | Crea los docs base de un club nuevo | Isaac / maestro |
| `tools/stream_token.py` | Emitir/revocar el link secreto del panel | Isaac / maestro |
| `tools/grant_stream_op.py` | Dar el rol de operador a una cuenta con Google (alternativa al link) | Isaac / maestro |

## 1. Arrancar un torneo nuevo

1. **Sembrar los docs** (si el club nunca ha transmitido, o para resetear):
   ```
   python tools/seed_stream_docs.py <Club>
   ```
2. **Emitir el link del operador**:
   ```
   python tools/stream_token.py new --club <Club> --label "Admin <Torneo>"
   ```
   Manda `https://puntazoclips.com/control-stream.html?k=<TOKEN>` por WhatsApp a quien
   vaya a operar el mosaico (organizador del torneo, Isaac, quien sea).
3. **Avisarle a la NUC del club** (mensaje al chat de esa NUC — ver plantilla en
   `docs/workers/worker-nuc-BP-stream-layout-cpam.md`) que arranque el encoder con las
   canchas del torneo y que empiece a espejar `stream_public` (`nuc_seen_at`,
   `layout_*`, `air`).
4. **Publicar el link de YouTube** en `stream_public/{club}` (el panel admin tiene un
   card para esto, o a mano con `seed_stream_docs.py --url ... --live`).
5. Compartir `https://puntazoclips.com/vivo.html?club=<Club>` — o dejar que aparezca
   solo: el banner rojo "🔴 Transmisión en vivo" en `entrada.html` se prende solo
   cuando `stream_public.live === true`.

## 2. Durante el torneo

- **Cambiar de cancha/layout** desde el panel: reinicia el encoder, ~5-7s de corte.
- **Pausar sin cortar YouTube** (comida, cambio de ronda, problema técnico): botón
  **⏸ EN BREAK** del panel. El RTMP sigue vivo, solo cambia la cortinilla. **Nunca
  usar un botón de "terminar"** — reconectar a YouTube da una URL nueva y el link ya
  compartido quedaría muerto.
- Si el link del panel se pierde o hay que revocarlo por seguridad:
  `python tools/stream_token.py rotate --club <Club> --label "..."` (mata todos los
  viejos y emite uno nuevo, sin tocar código ni deploy).

## 3. Cerrar el torneo (checklist de cierre)

Cuando el torneo termina, en este orden:

1. **Archivar la última transmisión** en `past_streams` (si la NUC no lo hizo ya) y
   marcar `live: false` en `stream_public/{club}`. Un one-liner rápido:
   ```python
   ref = db.collection("stream_public").document(club)
   d = ref.get().to_dict() or {}
   past = d.get("past_streams", [])
   url = d.get("youtube_url", "")
   if url and not any(p.get("url") == url for p in past):
       past.append({"url": url, "titulo": d.get("titulo"), "fecha": "YYYY-MM-DD"})
   ref.set({"live": False, "past_streams": past,
            "past_streams_updated_at": firestore.SERVER_TIMESTAMP}, merge=True)
   ```
2. **Avisarle a la NUC** que apague el encoder de stream (su mecanismo de siempre,
   p.ej. `STOP_STREAM.flag`) — **sin tocar el resto del daemon** (heartbeat de flota y
   pipeline de clips siguen corriendo normal, eso NO se apaga).
3. **Revocar el link del operador**: `python tools/stream_token.py revoke <TOKEN>`
   (o `list` primero si no se tiene a la mano). No hace falta si el operador es
   cuenta admin (`grant_stream_op.py --revoke`), pero por default el link es la vía.
4. Con `live: false` y `past_streams` poblado, `/vivo.html?club=<Club>` pasa solo al
   modo "escaparate": título del evento derivado de `organizador` + club + mes
   (`"CPAM · BreakPoint · agosto 2026"`), card destacada con la transmisión más
   reciente, y grid con el resto. Nada que tocar a mano.
5. El banner rojo de `entrada.html` desaparece solo (`live:false`); en su lugar
   aparece un banner azul discreto **"📺 Ver transmisiones anteriores"** mientras
   `past_streams` no esté vacío — así el club sigue promoviéndolo después del evento.

## 4. Volver a transmitir (el mismo club, otro evento)

Repite la sección 1. `past_streams` es acumulativo entre eventos (no se borra al
cerrar), así que el escaparate de `/vivo.html` va juntando el historial completo del
club. Si se quiere "empezar de cero" visualmente para un club, hay que vaciar
`past_streams` a mano (no hay comando para eso todavía — pregúntale a Isaac antes de
borrar historial).
