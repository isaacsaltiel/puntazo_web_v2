# Worker NUC BreakPoint — que el clip se vea en segundos (Fase A: preguntas y mediciones)

## Objetivo
Hoy un clip tarda unos 3 min del botón a Dropbox, y después otros ~4 min (entre 0.5 y 8) en
entrar al índice que lee la web. Queremos que aparezca **segundos después de subirse**, y
bajar también lo más posible esos 3 min: una vez quitado el índice, **tu parte es la mitad
del tiempo total**.

**Esta fase es solo de preguntas y mediciones.** No cambies código ni config, y no reinicies
nada. Con tu reporte decidimos el diseño y te mandamos la Fase B.

## Lo que ya sabemos en la central (10-sep-2026)

1. **El índice suma ~4 min y es impredecible.** Según la copia de tu código que tenemos
   (puede estar vieja), después de cada clip disparas `gestion_indice.yml` con
   `{"ref": "master"}` y **sin** `loc/can/lado`. Sin esos datos el workflow cae en el
   **barrido completo**: 23 lados, 266 clips, ~554 llamadas a Dropbox, de 12 a 20 min por
   corrida. De las últimas 40 corridas, 39 fueron barridos.
   El clip no espera el barrido entero, solo a que el barrido en curso pase por su cancha. En
   7 clips de BreakPoint de ayer y hoy, entre la subida y el índice pasaron **de 0.5 a 7.7 min
   (mediana 4.2)**. Pero si el clip llega cuando el barrido en curso ya pasó por su cancha,
   `skip_if_running` omite el disparo y el clip espera al siguiente barrido que alguien
   dispare, o al cron de cada 8 h. Tu log del 7-sep lo confirmó: "GitHub dispatch omitido:
   workflow ya corre".
2. **Del botón a Dropbox:** en `clip_states`, la mediana de BreakPoint es **2 min 54 s**
   (93 clips). El 8-sep mediste 4 min 20 s. Algo mejoró y queremos saber qué.
   Ojo: `ts_pulso` va en hora local y `published_at` en UTC.
3. **Hoy hubo dos clips muy lentos** en Cancha1/LadoA: el pulso de las 11:54:59 se marcó
   visible 58 min después, y el de las 13:26:37, 22 min después.
4. **Puedes generar el link público tú misma.** Desde la PC central, `rclone link` sobre un
   clip ya indexado devolvió **exactamente el mismo link** que tiene el índice (mismo id y
   mismo `rlkey`) en unos 2 s. Solo cambia el final: `dl=0` en vez de `raw=1`.
5. **Tu propia propuesta del 8-sep** fue escribir el metadato del clip directo en Firestore y
   sacar a GitHub del camino crítico. Vamos por ahí.

## El diseño que tenemos en mente (opina, NO lo implementes)
Justo después de subir el mp4 y su miniatura:
1. `rclone link` del mp4 y del jpg, y cambiar `dl=0` por `raw=1`.
2. En el **mismo** write que hoy marca el clip como `visible` en `clip_states`, agregar
   `video_url`, `poster_url` y `nombre` (el nombre exacto del archivo en Dropbox).
3. La web escucha `clip_states` en vivo y pinta el clip al instante, sin refrescar.
4. El disparo a GitHub se queda solo como respaldo (historial durable), pero mandando
   `loc/can/lado` para que indexe un solo lado (~1 min) en vez de barrer todo.

Si el link falla, el clip no se pierde: queda como hoy (`video_url` vacío) y el índice lo
recoge después.

## Preguntas
Contesta cada una con evidencia: `archivo:línea`, una línea de log o una medición.

**P1. Disparo a GitHub hoy.** Archivo y línea. Payload exacto del POST (sin el token).
Valores de cooldown y `skip_if_running`. Cuando se omite un disparo, ¿se reintenta después o
se pierde?

**P2. Subida a Dropbox.** Nombre del remote de rclone en esta NUC. Comando exacto con el que
subes el mp4 y el jpg, en qué orden y a qué ruta. Tiempo de cada subida en los últimos 10
clips (del log).

**P3. `clip_states`.** Archivo y función que lo escribe. En qué momento exacto pasa a
`visible`: ¿justo después del rclone del mp4? ¿antes o después del jpg? Formato del id del
documento y campos que escribe. Con qué credencial (solo la RUTA del archivo, nunca su
contenido). ¿Ese mismo write puede llevar `video_url`, `poster_url` y `nombre`? ¿Qué
habría que tocar?

**P4. Prueba de links (inofensiva).**
- **a) Clip ya indexado.** Su link ya existe, así que rclone solo lo devuelve y no crea nada:
  ```
  rclone link <remote>:/Puntazo/Locaciones/BreakPoint/Cancha3/LadoA/BreakPoint_Cancha3_LadoA_10092026_072950.mp4
  ```
  Esperado:
  `https://www.dropbox.com/scl/fi/l0d26d4pt33u9sn5xviba/BreakPoint_Cancha3_LadoA_10092026_072950.mp4?rlkey=ondi26bxplj8ljtvki0167ljq&dl=0`

  Haz lo mismo con el `.jpg` hermano. Esperado:
  `https://www.dropbox.com/scl/fi/svz2pdz0av7joqck2hrx9/BreakPoint_Cancha3_LadoA_10092026_072950.jpg?rlkey=k8mt1cjy7h9a9guy4j7xh08mv&dl=0`

  Mide el tiempo de cada uno y di si coincide.
- **b) Archivo nuevo.** Prueba que tu remote tiene permiso de CREAR links, no solo de leerlos.
  Sube un `.txt` de una línea a `<remote>:/Puntazo/briefs/respuestas/prueba-link-BP.txt`,
  córrele `rclone link` y mide el tiempo. Si falla, pega el error completo: puede ser un tema
  de permisos de la app de Dropbox.

Si la ruta de (a) no existe en tu remote, dilo: significaría que subes a otra cuenta o a otra
carpeta, y el diseño cambia.

**P5. Tiempos por etapa hoy.** Tabla de los últimos 10 clips reales, sacada del log:
encolado/espera, descarga del NVR, ffmpeg pase 1, pase 2 + miniatura, subida mp4, subida
jpg, write a `clip_states` y disparo. ¿Qué cambió desde el 8-sep (1080p, fusionar pases,
otra cosa)? ¿Por qué tardaron tanto los dos clips lentos de hoy (punto 3)?

**P6. Qué queda para que sea súper rápido, una vez quitado el índice.** Sin cambiar nada:
- `WAIT_BEFORE_REQUEST_SECONDS`, pre-roll y post-roll: valores actuales y por qué existen.
  ¿Cuánto se podría recortar sin que el NVR entregue el archivo incompleto?
- **Buffer local continuo.** La idea: grabar el RTSP de cada cámara en segmentos locales
  cortos con `-c copy` (sin recodificar, un anillo de pocos minutos), para cortar el clip al
  instante sin pedirle nada al NVR. ¿Es viable aquí? Dinos el número de cámaras, el bitrate de
  cada una, el disco libre, el CPU, cuántas conexiones RTSP aguanta el NVR y cuántas usa ya
  el streaming. Solo si NO hay streaming en vivo ni clips en cola, puedes grabar 60 s de UNA
  cámara a una carpeta temporal para medir CPU y MB/min. Nada más.
- **Encode.** ¿Usas QSV? Si la cola está vacía, mide un encode de un solo pase a 1080p sobre
  un crudo que ya exista, con salida a una carpeta temporal.
- Tamaño típico del clip final y velocidad de subida a Dropbox.

**P7. Concurrencia.** ¿Los clips se procesan de uno en uno? Si llegan 3 pulsos seguidos, de
la misma cancha o de canchas distintas, ¿cuánto espera el tercero?

**P8. Para desplegar después.** Ruta del proyecto, cómo corre el runner (servicio, tarea
programada o consola), cómo se reinicia, y en qué horario están vacías las canchas.

**P9. Tu propuesta.** Con lo que ves en tu código: ¿cómo lo harías tú, en qué orden y con
qué riesgos?

## Reglas
- **READ-ONLY.** Lo único que puedes escribir es el `.txt` de prueba de P4b, la grabación de
  60 s y el encode de prueba de P6 (en una carpeta temporal), y tu reporte.
- No reinicies el runner, no toques `config.json` ni el código, y no borres nada.
- Nunca imprimas secretos (PAT, tokens de Dropbox, service account): solo largo y prefijo.
- Si algo de este brief no cuadra con lo que ves en tu código, **dilo**. La verdad es tu
  código, no este documento.

## Entrega
1. El reporte en el formato de abajo, en un bloque listo para copiar.
2. Súbelo también a Dropbox:
   `<remote>:/Puntazo/briefs/respuestas/RESPUESTA-BREAKPOINT-publicacion-instantanea.md`

```
# RESPUESTA BP — publicación instantánea (Fase A)
Fecha/hora local:
Remote rclone:                 Ruta del proyecto:
P1 Disparo:
P2 Subida:
P3 clip_states:
P4 Links: (a) mp4 __s ¿igual? | jpg __s ¿igual? | (b) nuevo __s ¿ok? / error
P5 Tiempos (tabla de 10 clips) + qué cambió + clips lentos:
P6 Súper rápido: WAIT/pre/post-roll | buffer local | encode 1080p | subida
P7 Concurrencia:
P8 Despliegue:
P9 Tu propuesta:
```
