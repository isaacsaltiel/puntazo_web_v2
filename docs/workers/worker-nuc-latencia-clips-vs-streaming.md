# Por qué un clip de 30 s tarda minutos si el streaming compone en vivo

> Análisis del maestro + brief de medición para la NUC. Fecha: 7-sep-2026.
> **Es diagnóstico. No rearquitectures nada todavía.**

---

## La observación de Isaac

El streaming compone **4 canchas + logos + cortinilla** y las encodea **en tiempo real**, sin
despeinarse, durante 27 horas seguidas. Un clip de 30 segundos de **una sola** cancha tarda
mucho más que eso en aparecer en la web.

Eso no cuadra con la intuición, y la intuición tiene razón.

## La matemática de por qué no cuadra

Números reales medidos en la NUC de BreakPoint durante el torneo CPAM:

- 1,953,532 frames en 27 h 8 min = **20.0 fps sostenidos**
- Trabajo por segundo: **4 decodes HEVC** + escalado + `xstack` + **1 encode H.264 720p**
- Costo: **16 % del motor de video** de la iGPU

Si con el 16 % del motor haces 4 decodes + 1 encode **en tiempo real**, con el motor libre y
**una sola** cancha deberías ir muy por encima de tiempo real. Un clip de 30 s debería
encodearse en **1 a 3 segundos**.

**Conclusión: el encode no es el cuello de botella.**

---

## ✅ La causa, ya verificada (no es hipótesis)

**El quemado de logos de los clips no corre en la NUC. Corre en GitHub Actions.**
Ver `.github/workflows/procesar_ffmpeg.yml`:

```yaml
runs-on: ubuntu-latest          # VM sin GPU
concurrency:
  group: procesar-videos-ffmpeg # ← SERIALIZADO: un clip espera al anterior
  cancel-in-progress: false
env:
  BATCH_LIMIT: "20"             # ← procesa por lotes
  MAX_PARALLEL: "2"
  THREADS_PER_FFMPEG: "2"
steps:
  - uses: actions/checkout@v4
    with: { lfs: true }         # ← clona el repo CON LFS en cada corrida
  - run: sudo apt-get install -y ffmpeg   # ← instala ffmpeg DESDE CERO cada vez
  - run: python procesar_videos_ffmpeg.py # ← baja de Dropbox, quema, sube de vuelta
```

El camino real de un clip hoy:

```
NUC saca del NVR → sube el crudo a Dropbox /Puntazo/Entrantes
  → repository_dispatch → espera en la cola de GitHub Actions
  → checkout con LFS + apt-get install ffmpeg      (~1-2 min, EN CADA CORRIDA)
  → DESCARGA el video de Dropbox
  → quema logos con libx264 en 2 vCPU, SIN GPU
  → SUBE el resultado de vuelta a Dropbox
  → dispara gestion_indice.yml → otro workflow, otro arranque
  → commit del índice → redeploy de GitHub Pages
  → recién ahí el clip es visible
```

Contra el streaming: **RTSP en vivo → QSV en la iGPU → RTMP.** Sin viajes de archivo, sin CI,
sin instalar nada, con hardware dedicado.

**Por eso gana el streaming:** no es que componer sea barato allá y caro acá. Es que el clip
hace **el doble viaje del archivo por la red, en CPU sin GPU, detrás de una cola serializada,
reinstalando ffmpeg cada vez**. La composición es la parte barata de las dos.

### Lo que esto implica

La NUC ya demostró que compone 4 canchas + logos en tiempo real con el **16 % del motor de
video**. Quemar el logo de **un** clip de 30 s ahí mismo debería costar **1-3 segundos** —
y además **ahorra el viaje redondo del archivo**: hoy sube el crudo y Actions lo vuelve a
bajar y subir. Si la NUC procesa antes de subir, el archivo viaja **una sola vez**.

Los logos ya se distribuyen a las NUCs por `nuc_assets` — esa parte ya está resuelta.

---

## Lo que todavía falta medir

La causa principal ya está identificada, pero antes de mover nada hay que saber **cuánto pesa
cada etapa**, porque hay un piso que mover el encode no arregla:

**M1 — ¿Cuánto tarda sacar el video del NVR?** Muchos NVR sirven playback a velocidad
limitada (1×). Si entrega a 1×, bajar 30 s cuesta 30 s, y con margen ± más. **Este es el piso
duro que seguiría existiendo aunque muevas todo lo demás a la NUC.**

**M2 — ¿Cuánto pesa el CI en el "ya se ve en la web"?** Aunque la NUC procese el video, si el
índice sigue publicándose por `gestion_indice.yml` + redeploy de Pages, ahí quedan minutos.
Mover el encode no arregla esto — es otro trabajo aparte.

**M3 — ¿Cuántas pasadas de ffmpeg hay por clip?** Cortar → logos → intro/outro → poster.
Cada pasada re-encodea el video completo; el streaming hace **una sola** con un
`filter_complex`. ¿Se puede colapsar?

**M4 — La concatenación de intro/outro.** El *filtro* `concat` siempre re-encodea. El
*demuxer* `concat` con `-c copy` no, pero exige mismo codec/resolución/fps/timebase.
¿Cuál se usa?

**M5 — Subida a la nube.** Tamaño del archivo contra el upstream real del club.

**M6 — Cola.** ¿El clip esperó turno detrás de otros?

### Cómo medirlo

Instrumenta con un timestamp por etapa, **5 clips reales**, y devuelve la tabla. No estimes:

```
t0  pulso recibido / job creado
t1  empieza extracción del NVR
t2  termina extracción del NVR        → Δ = costo del NVR            (M1)
t3  termina corte/recorte
t4  terminan overlays                 → Δ = costo real de encode     (M3)
t5  termina el poster
t6  empieza subida
t7  termina subida                    → Δ = costo de red             (M5)
t8  el clip ya es visible en la web   → Δ(t7→t8) = costo del CI      (M2)
```

---

## Hacia dónde podría ir (NO lo implementes todavía)

**Paso 1 — Mover el quemado de logos a la NUC.** Es el cambio de mayor rendimiento por menor
riesgo: usa el QSV que ya está probado, elimina un viaje redondo del archivo, y saca el clip
de la cola serializada de Actions. Los logos ya llegan por `nuc_assets`.
*Riesgo a cuidar: las 3 NUCs tendrían que compartir la lógica, y ya hay antecedente de que
las NUCs se van a versiones distintas. Necesita una sola fuente de verdad.*

**Paso 2 — Si M1 confirma que el NVR es un piso caro: grabación continua segmentada
(rolling buffer).** Ya que el hardware compone en tiempo real con el 16 % del motor, se puede
grabar en segmentos cortos a disco (`-f segment -segment_time 2 -c copy`). Entonces **"hacer
un clip" = copiar segmentos con `-c copy`**: una operación de disco de **décimas de segundo**,
sin decodificar, sin encodear y **sin tocar el NVR**. Es como funcionan los sistemas de
instant replay deportivos.

Trade-offs honestos:
- **Disco**: ~9 GB/día por flujo a 850 kbps; por cancha y a mejor calidad, más. Se acota con
  un buffer circular de N horas.
- **Motor**: grabar por cancha son N encodes en vez de 1. Con 4 canchas al 16 % hay margen,
  pero hay que medirlo.
- **Precisión del corte**: queda alineado al segmento (±2 s) salvo re-encodear los bordes.
- **Gana**: elimina la dependencia del NVR para clips recientes.

**Paso 3 — El CI del índice (M2), aparte.** Si tras los pasos 1-2 el clip está listo en
segundos pero tarda minutos en verse, el trabajo se muda al lado web y no tiene nada que ver
con la NUC.

---

## Qué me devuelves

1. La tabla de timestamps de 5 clips reales.
2. El comando ffmpeg completo de generación de un clip, y cuántas invocaciones hay.
3. Qué etapa se lleva la mayor parte del tiempo, con el número que lo respalda.
4. Tu lectura de si el Paso 1 es viable en esa NUC sin tocar el pipeline de pulsos.
