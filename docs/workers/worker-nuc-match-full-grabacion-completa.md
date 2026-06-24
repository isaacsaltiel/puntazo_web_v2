# Brief NUC — Grabar "partido completo" (source=`match_full`)

**Para la NUC de WellStreet-Pickleball (y cualquier club que se agregue a
`MATCH_RECORDING_CLUBS`).** El lado web YA está desplegado: cuando un partido de
pickleball se crea con la casilla **"Grabar el partido completo"** (decidida al
inicio), al **terminar** el partido la web encola un doc en `pending_pulses` con
`source="match_full"`. La NUC debe consumirlo y cortar del NVR la ventana
`[start_at, end_at]` del partido. Sin este handler, el doc se queda sin procesar.

---

## Contexto / por qué

Hoy la NUC (`core/sources/firestore_pulses.py`) escucha `pending_pulses` y procesa
`source` = `web` (pulso normal, pre/post-roll) y `recovery` (ventana ±90 s sobre
`event_at`). El NVR (Hikvision) graba **continuo con retención 7 días**, así que la
grabación de un partido completo es una **extracción por ventana RTSP** `[inicio,
fin]` — no requiere haber empezado a grabar antes.

La web decide la intención AL INICIO (campo `recordFull` en `matches/{id}`), pero la
grabación se **encola al cerrar** el partido, con la ventana real `startedAt..endedAt`
ya resuelta a server-timestamps. Idempotente por `client_pulse_id` determinístico.

## Doc que llega a `pending_pulses` (contrato exacto)

```jsonc
{
  "source": "match_full",
  "client_pulse_id": "PLS_M_<matchId>",   // determinístico por partido (dedup)
  "match_id": "<matchId>",
  "club": "WellStreet-Pickleball",
  "cancha": "3",                          // SOLO el dígito (igual que pulsos normales)
  "lado": "LadoA",
  "uid_creator": "<uid|null>",
  "start_at": <Timestamp server>,         // inicio del partido (startedAt)
  "end_at":   <Timestamp server>,         // fin del partido (endedAt)
  "created_at": <Timestamp server>,
  "consumed_at": null,
  "consumed_by": null
}
```

> Nota: a diferencia de `recovery` (que trae `event_at`), `match_full` trae
> `start_at` **y** `end_at`. A diferencia de `web`, NO se le aplica pre/post-roll:
> la ventana es exacta (modo `manual_exact`).

## Obligaciones del handler

1. **Reconocer `source == "match_full"`** en el listener (hoy solo distingue
   `recovery`). Parsear `start_at` y `end_at` (Timestamp → naive local con el mismo
   `LOCAL_TZ_OFFSET_HOURS` que ya usas; anclar SIEMPRE a estos server-timestamps,
   nunca a `created_at`).

2. **Dedup / idempotencia** por `external_id = client_pulse_id` ANTES de encolar
   (igual que ya haces con los pulsos por `event_id`). Un doble disparo (auto al
   cerrar + botón manual en resumen.html, o doble ruta de cierre) NO debe duplicar
   el upload.

3. **Clamp autoritativo + anclaje al final.** Define `NUC_MATCH_FULL_MAX` (sugerido:
   el máximo que tu pipeline ffmpeg→Dropbox tolera de forma estable). Si
   `end_at - start_at > NUC_MATCH_FULL_MAX`, recorta **anclando al final**:
   `start = end_at - NUC_MATCH_FULL_MAX`. La NUC es la verdad; la web solo manda un
   hint (hoy `MATCH_RECORDING_MAX_MINUTES = 20` en `assets/pulses.js`).
   **⚠️ Coordinar con el maestro el valor real**: si tu pipeline tolera ~45 min,
   avisa para subir el hint web de 20 → 45 (los clips normales son de segundos; un
   clip de decenas de minutos nunca se ha probado en este pipeline — VALIDARLO).

4. **Retención 7 días.** Si `start_at < now - 7d`, clampa `start` al borde de
   retención. Si `end_at` también cae fuera → marca error (no encolar un clip vacío).

5. **Encolar** como job `mode="manual_exact"` (ventana exacta, sin pre/post-roll),
   `source="match_full"`, con `external_id=client_pulse_id`.

6. **Emitir `clip_states`** igual que un pulso normal: transición
   `en_cola → visible`, con `source="match_full"`, `cancha="CanchaN"`,
   `video_url=null` hasta que el indexador CI publique la URL. El archivo final debe
   llevar el sufijo de partido `_PARTIDO_<hash>` (la web ya lo reconoce vía
   `parseFromName` en `assets/matches.js`), para que aparezca en "Mis clips" / clips
   de la cancha del usuario.

7. **Marcar `consumed_at`/`consumed_by`** en el doc al terminar (éxito o error con
   `error_reason`), como con los demás sources.

## (v2, opcional pero recomendado) Barrido de cierre

Hueco conocido: si el usuario **cierra la pestaña y nunca termina** el partido en la
app, ni el cierre manual ni la expiración (ambos client-side) corren → la grabación
nunca se pide y el video del NVR caduca a los 7 días. Para cerrarlo:

- La NUC (o una Cloud Function) barre `matches` con `recordFull == true` &&
  `recordRequested == false` && `status == "active"` cuya edad supere la duración
  máxima esperada (`PuntazoMatches.maxMatchDurationMs`), los considera terminados y
  extrae `[startedAt, now_o_endedAt]`. Marca el doc para no repetir.

## Verificación (antes de cerrar)

- Crear un partido de pickleball en WellStreet con la casilla activada, jugar unos
  minutos, terminarlo → aparece un doc `match_full` en `pending_pulses` → la NUC lo
  consume → sale un clip con sufijo `_PARTIDO_` en los clips de la cancha.
- Doble disparo (terminar + botón manual en resumen.html) → un solo upload.
- Partido > NUC_MATCH_FULL_MAX → clip recortado a los últimos N min (anclado al fin).
- `consumed_at` queda sellado; `clip_states` transiciona `en_cola → visible`.

## Reglas

- **No imprimir secretos** (tokens/PAT): solo longitud + prefijo si hace falta.
- Cambios **aditivos**: no romper el flujo de `web`/`recovery` existente.
- Idempotencia primero: ante la duda, dedup por `client_pulse_id`.
