# Worker NUC BreakPoint — Fase B1: el clip se ve en la web segundos después de subirse

## Por qué
Tu reporte de la Fase A confirmó el diseño y corrigió dos datos nuestros (gracias: los
"clips lentos" eran `published_at` pisado por el republish, y los 4:20 eran del 21-ago con el
stream al aire). Hoy, del botón a la web: ~2:53 tuyos + 0.5 a 6 min de índice + tocar
"Actualizar". Con esta fase: **~2:50 del botón a la web, y el clip aparece solo.**

Lo que hace la central (se despliega ANTES de que actives esto; ver "Candados"):
- `lado.html` escucha `clip_states` en vivo y pinta el clip en cuanto su doc trae
  `video_url`. Deduplica por `nombre` contra el índice JSON.
- `gestion_indice.yml` usa un grupo de concurrencia **por lado**. Disparar con
  `loc/can/lado` ya no cancela barridos pendientes de otros clubes, y no se pierde ningún
  disparo: GitHub guarda 1 corrida pendiente por lado y la más nueva cubre a la anterior.
- Las estadísticas solo corren en barridos: la corrida de un lado baja a ~40 s.

## Contrato con la web (exacto)
En el MISMO write que pone `state: "visible"` en `clip_states/{clip_id}`, agrega:

| Campo | Valor |
|---|---|
| `nombre` | Nombre exacto del mp4 en Dropbox. Ej.: `BreakPoint_Cancha3_LadoA_10092026_072950.mp4` |
| `video_url` | Salida de `rclone link` del mp4, con `dl=0` cambiado por `raw=1` |
| `poster_url` | Lo mismo para el `.jpg` hermano. Si falla, `null` |
| `visible_at` | Timestamp UTC de la PRIMERA vez que el clip quedó visible. Inmutable: sale del CSV, NO de `SERVER_TIMESTAMP` en cada write |

**Conversión:** igual que el CI (`to_direct_dropbox_url(mode="raw")`). Quita `dl`, agrega
`raw=1` y conserva `rlkey`. Ejemplo verificado:
`...?rlkey=ondi26bxplj8ljtvki0167ljq&dl=0` → `...?rlkey=ondi26bxplj8ljtvki0167ljq&raw=1`.

**La web ignora** (y ese clip llega por el índice, como hoy) cualquier doc que no cumpla
TODO esto:
- `state == "visible"`, con `club`/`cancha`/`lado` iguales a los de la página.
- `nombre` que empiece con `<club>_<cancha>_<lado>_` y termine en `_DDMMYYYY_HHMMSS.mp4`.
- `video_url` https de `www.dropbox.com`, `dropbox.com` o `dl.dropboxusercontent.com`.

Dos cosas que NO debes cambiar:
- **El formato de `ts_pulso`.** La web consulta `ts_pulso >= ahora-24h` con el índice
  compuesto que ya existe.
- **El `nombre`.** Debe ser IDÉNTICO al del índice, o el clip sale duplicado.

## Qué implementar (en este orden)
1. **Links en paralelo.** Justo después de subir el mp4 y el jpg, lanza los dos
   `rclone link` a la vez, con timeout de 20 s cada uno. Si uno falla, sigue con el campo
   vacío: el clip NO falla por esto. Loguea cuánto tardó.
2. **CSV.** Agrega las columnas `nombre`, `video_url`, `poster_url` y `visible_at` a
   `QUEUE_FIELDS`, con migración como en `QUEUE_FIELDS_R1_NEW` (las filas viejas quedan
   vacías). Llénalas en `procesar_puntazo` antes de `queue_mark_done`. `visible_at` se
   escribe una sola vez.
3. **Payload.** `_publisher_build_payload` lee las 4 columnas. Los links y el `nombre` solo
   van con estado `visible`. Así `republish_state_on_startup()` vuelve a mandar los links en
   vez de borrarlos.
4. **Visible primero.** Orden nuevo después de la subida:
   links → CSV → `queue_mark_done` (write `visible` con links) → `resolved_video`.
   Después, en un HILO APARTE: `recording_daily` y el disparo a GitHub. El worker ya no
   espera al disparo. (`resolved_video` va después del visible para que la notificación
   "ya está listo" llegue cuando el clip ya se ve de verdad).
5. **Disparo por lado.**
   - Body: `{"ref":"master","inputs":{"loc":"BreakPoint","can":"<CanchaN>","lado":"LadoA"}}`.
     Los nombres están confirmados en `gestion_indice.yml`: `loc`, `can`, `lado`.
   - Quita `skip_if_running`: el grupo por lado ya evita que se apilen.
   - Quita el cooldown global: con él, dos canchas en 15 s perdían el segundo disparo.
   - Si falla la red o GitHub responde 5xx, reintenta 3 veces (a los 2, 5 y 15 s). Un 204
     basta.
6. **El publisher nunca publica un estado viejo encima de uno nuevo.** El reencolado al
   final (script.py:2356-2366) puede publicar `en_cola` después de `visible`. Descarta un
   payload si ya se publicó, o está en cola, uno más nuevo del mismo `clip_id`: por orden de
   estado (`en_cola` < `visible`/`error`) o por secuencia.
7. **Interruptores.** Dos flags en config, para revertir sin tocar código:
   - `PUBLICAR_LINKS_EN_VIVO` (pasos 1 a 3).
   - `DISPATCH_POR_LADO` (paso 5). En OFF, se comporta como hoy.
8. **Opcional, si queda limpio:** una sola invocación de rclone para mp4 y jpg (ahorra
   ~4 s). Si falla el jpg, el mp4 debe contar como subido.

## Mediciones (no cambian nada)
- **NVR.** Con la cola vacía, pide [T−60, T+5] en T+5 y en T+10 con `-f null` y compara la
  duración entregada contra 65 s. Es la base para recortar el WAIT en la Fase B2. Solo mide.
- **Remoto del repo.** Corre `git -C C:\Puntazo\runner remote -v`: ¿tiene remoto? La
  contraseña del NVR está en claro en script.py:84-86. Solo reporta; no la muevas en esta
  fase.

## Candados antes de reiniciar
1. **La central ya desplegó su parte.** Verifica las dos cosas:
   - `https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/.github/workflows/gestion_indice.yml`
     contiene el texto `gestionar-indice-${{`.
   - `https://puntazoclips.com/assets/clips-en-vivo.js` responde 200.

   Si alguna falla, deja `DISPATCH_POR_LADO` en OFF, porque puede tumbar barridos de otros
   clubes. `PUBLICAR_LINKS_EN_VIVO` sí se puede encender: es inofensivo.
2. **Música sin commitear.** script.py en disco tiene cambios de música de las 14:22 que NO
   están corriendo. Reiniciar los pondría al aire. **Pregúntale a Isaac antes**, y no los
   mezcles con este cambio: van en commits aparte.
3. **Reinicio.** Con la cola vacía, corre `tools\restart_runner.ps1 -DryRun` y luego sin
   `-DryRun`. Mejor entre 00:30 y 05:30, o en el valle de 14 a 16 h.

## Prueba de aceptación (después de reiniciar)
1. Avísale a Isaac para que tenga abierta, arriba de todo, la página de la cancha de prueba
   (`https://puntazoclips.com/lado.html?loc=BreakPoint&can=<CanchaN>&lado=LadoA`).
2. Manda un pulso de prueba en una cancha vacía.
3. En Firestore, el doc debe tener `state: visible`, `nombre`, `video_url` (con `raw=1`),
   `poster_url` y `visible_at`.
4. El `video_url`, siguiendo redirecciones, debe responder `content-type: video/mp4`.
5. Isaac debe ver el clip aparecer solo, sin tocar Actualizar. Anota la hora de subida y la
   del write visible.
6. En Actions, la corrida de ese disparo debe ser la de un solo lado (la de loc/can/lado) y
   durar ~1 min.
7. Fuerza un republish (o reinicia) y confirma que los links NO se borran del doc.

## Reglas
- Trabaja en una rama. Commits chicos y separados de los de música.
- No toques la subida, el encode, el NVR ni el WAIT: eso es de la Fase B2.
- Nunca imprimas secretos: solo largo y prefijo.
- Si algo de este brief no cuadra con tu código, dilo antes de improvisar.

## Entrega
El reporte en este formato, en un bloque listo para copiar. Súbelo también a
`<remote>:/Puntazo/briefs/respuestas/RESPUESTA-BREAKPOINT-B1.md`.

```
# RESPUESTA BP — Fase B1
Fecha/hora local:            Rama y commits:
Candados: workflow por lado ¿ok? | clips-en-vivo.js ¿200? | música: ¿qué decidió Isaac?
Implementado (1-8): qué, dónde (archivo:línea), flags y su valor
Prueba: clip | subido HH:MM:SS | visible HH:MM:SS | ¿Isaac lo vio solo? | corrida de Actions (duración)
Republish: ¿los links sobrevivieron?
Medición NVR: T+5 → __ s entregados | T+10 → __ s
git remote: sí/no (sin credenciales)
Riesgos o pendientes:
```
