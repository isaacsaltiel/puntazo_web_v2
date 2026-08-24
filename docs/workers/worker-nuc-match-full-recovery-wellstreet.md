# Brief NUC — "Partido completo" desde recuperación (source=`match_full_recovery`)

**Para la NUC de WellStreet (sirve WellStreet-Pickleball y WellStreet-Padel).** El lado
web YA está desplegado: en `/recuperar.html`, SOLO para estos dos clubes, el formulario
de "¿cuándo fue el puntazo?" (recuperación puntual, ventana ±90s) fue reemplazado por un
selector de rango `[inicio, fin]` de hasta 20 minutos, con el mensaje "Ya puedes pedir tu
partido completo". Al enviarlo, la web encola un doc en `pending_pulses` con
`source="match_full_recovery"`. Sin este handler, el doc se queda sin procesar.

## Por qué (contexto real, no hipotético)

Con datos de Firestore (22-ago-2026, `pending_pulses` fuente `recovery`, últimos 60
días): un solo usuario logueado pidió **34 recuperaciones puntuales** en
WellStreet-Pickleball cancha 3, espaciadas ~3 minutos entre sí, cubriendo **155 minutos
continuos** — estaba reconstruyendo el partido completo a punta de clips sueltos porque
el throttle de invitado (1/24h) no aplica a usuarios logueados. El nuevo flujo cierra ese
hueco: en vez de N clips de 90s, UNA sola solicitud de hasta 20 min, con su propio tope
(3 por cancha por hora, validado client-side antes de escribir a Firestore).

Este handler **reusa exactamente el contrato y la lógica de `source="match_full`**
(ver `docs/workers/worker-nuc-match-full-grabacion-completa.md`, ya en producción para
WellStreet-Pickleball vía el botón "grabar partido en vivo"). La única diferencia real:
no hay un `matchId` de un partido jugado en la app — el usuario eligió el rango a mano
desde el formulario de recuperación.

## Doc que llega a `pending_pulses` (contrato)

```jsonc
{
  "source": "match_full_recovery",
  "client_pulse_id": "PLS_W_<uuid>",   // random por click (NO determinístico — no hay matchId real)
  "match_id": null,
  "club": "WellStreet-Pickleball",     // o "WellStreet-Padel"
  "cancha": "3",                       // SOLO el dígito, igual que los demás pulsos
  "lado": null,                        // la NUC decide, igual que "recovery"
  "uid_creator": "<uid>",              // SIEMPRE presente (anónimo o logueado — auth es obligatorio)
  "start_at": <Timestamp server>,
  "end_at":   <Timestamp server>,
  "created_at": <Timestamp server>,
  "consumed_at": null,
  "consumed_by": null
}
```

## ⚠️ URGENTE (medido 2026-08-23) — hoy se sella `consumed_at` y no sale nada

Tres pedidos reales llegaron a `pending_pulses` y la NUC les puso
`consumed_at` + `clamped:false` en **~0.4 segundos**… y ahí murió todo: no
apareció ningún clip, ningún doc en `clip_states`, y nada en el índice de la
cancha. Dos de esos pedidos eran de un usuario real.

Peor: como el backend interpretaba `consumed_at` como "clip listo", al usuario
le llegó la notificación **"Tu puntazo en WellStreet Pickleball ya está listo —
tócalo para verlo"** un segundo después de pedirlo, apuntando a un video que no
existe. (El criterio ya se corrigió en la web: ahora exige `resolved_video`.)

Hace falta que revisen **por qué el pipeline se detiene después de aceptar el
job** — logs de esa ventana horaria. Y que al terminar de publicar estampen:

1. **`resolved_video`** en el propio doc de `pending_pulses` = el nombre exacto
   del archivo publicado (ej. `WellStreet-Pickleball_Cancha1_LadoA_PARTIDO_ab12_23082026_231500.mp4`).
   **Esta es ahora la señal oficial de "listo"** en todo el sistema: dispara la
   notificación, el deep-link al video exacto, y el panel de seguimiento en
   vivo de `/recuperar.html`. Sin este campo, para la web el pedido sigue
   "procesando" para siempre. Es el mismo campo que ya estampan para los pulsos
   normales (Nivel 1, 11-jun).
2. **`error_reason`** si falla, en vez de dejarlo en silencio — así el usuario
   ve "no se pudo" en lugar de esperar indefinidamente.

## Obligaciones del handler

1. **Reconocer `source == "match_full_recovery"`** junto a `"match_full"` en el listener
   (`core/sources/firestore_pulses.py` o equivalente). Tratarlo IGUAL: ventana exacta
   `[start_at, end_at]`, modo `manual_exact`, **sin** pre/post-roll.
2. **Clamp defensivo** con el mismo `NUC_MATCH_FULL_MAX` que ya usas para `match_full`
   (la web ya valida ≤20 min antes de encolar, pero la NUC sigue siendo la verdad
   autoritativa — no confiar ciegamente en el cliente).
3. **Retención NVR**: mismo comportamiento que `match_full` (clamp al borde de retención
   si `start_at` cae fuera; error sin encolar si la ventana entera ya caducó).
4. **Mismo sufijo de archivo `_PARTIDO_<hash>`** — así el badge web "🎾 PARTIDO COMPLETO"
   (`assets/card.js`, ya en producción) y el resto de la UI funcionan SIN cambios en el
   repo web.
5. **Emitir `clip_states`** con `source="match_full_recovery"`, mismo ciclo
   `en_cola → visible` que ya implementaste para `match_full` (ver
   `docs/workers/worker-local-G-wellstreet-clip-states.md`).
6. **Confirmar que corre en AMBOS clubs.** El flujo LIVE de `match_full` (botón "grabar
   partido completo") solo se probó en WellStreet-Pickleball porque Padel no tiene ese
   botón en la app. Pero la extracción en sí es una ventana RTSP sobre el NVR — no
   debería depender del club. Validar con una prueba real en una cancha de Padel antes
   de dar por hecho que ya funciona ahí.
7. **Idempotencia** por `client_pulse_id` (dedup), igual que los demás sources.
8. **Marcar `consumed_at`/`consumed_by`** al terminar (éxito o error con `error_reason`).

## Fuera de alcance (no tocar)

- Los flujos `"web"`, `"recovery"` y `"match_full"` existentes siguen igual — cambios
  **aditivos** únicamente.
- El tope de "3 por cancha por hora" vive **en el cliente** (consulta a `pending_pulses`
  antes de escribir). La NUC no necesita replicarlo, pero si ven ráfagas de
  `match_full_recovery` de un mismo `uid_creator`/cancha que excedan claramente eso,
  avisar al maestro — podría indicar que alguien está saltándose el throttle del cliente
  (localStorage limpio no ayuda porque el conteo es server-side por uid, pero un cliente
  modificado sí podría llamar Firestore directo).

## Verificación (antes de cerrar)

- Pedir "partido completo" desde `/recuperar.html` en una cancha de
  **WellStreet-Pickleball** → sale un doc `match_full_recovery` en `pending_pulses` → la
  NUC lo consume → aparece un clip con sufijo `_PARTIDO_` en los clips de esa cancha.
- Mismo test en una cancha de **WellStreet-Padel**.
- Rango > 20 min forzado manualmente en Firestore (simular un bug del cliente) → la NUC
  recorta anclando al final, no lo rechaza silenciosamente.
- `consumed_at` queda sellado; `clip_states` transiciona `en_cola → visible` en ambos
  clubes.

## Reglas

- No imprimir secretos (tokens/PAT): solo longitud + prefijo si hace falta.
- Cambios aditivos: no romper `web`/`recovery`/`match_full`.
- Idempotencia primero: ante la duda, dedup por `client_pulse_id`.
