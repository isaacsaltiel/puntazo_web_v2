# Por qué un clip tarda en aparecer en la web si la NUC ya lo procesa rápido

> Análisis del maestro. Fecha: 7-sep-2026.
> **Corrige una versión anterior de este mismo doc que decía que el quemado de logos corría
> en GitHub Actions. Es falso.** El quemado corre en la NUC; el workflow de CI que lo hacía
> antes lleva 7 meses muerto. Detalle del error de método al final.

---

## La observación de Isaac

El streaming compone 4 canchas + logos en tiempo real, 27 horas seguidas, con el **16 % del
motor de video**. Un clip corto de una sola cancha tarda mucho más en llegar a la web.

## Lo que NO es

**No es el quemado de logos.** Eso ya corre en la NUC con QSV, desde la migración de
principios de año. Evidencia dura, del historial real de Actions:

| Workflow | Última corrida | Estado |
|---|---|---|
| `procesar_ffmpeg.yml` (quemado en CI) | **17-feb-2026**, fallando | **muerto hace 7 meses** |
| `gestion_indice.yml` (publicar índice) | hoy, varias veces | **vivo** |
| `supervisor_puntazo.yml` | hoy, cada ~6 h | vivo |

El archivo `procesar_ffmpeg.yml` sigue en el repo, pero **nadie lo dispara**. Existir ≠ correr.

**Tampoco es "el CI es lento".** Medido en una corrida real de `gestion_indice.yml`:

```
     0s  Set up job
     3s  checkout
     0s  setup-python
     5s  Dependencias
   747s  Gestionar índice (barrido)     ← 96 % del tiempo
    22s  Generar stats_summary.json
```

El arranque del CI cuesta **8 segundos**. El problema no es el CI.

---

## ✅ Lo que sí es: se corre el BARRIDO COMPLETO en vez de indexar el video nuevo

`gestion_indice.yml` tiene tres ramas:

| Rama | Disparo | Qué hace | Costo |
|---|---|---|---|
| A) Por video | `repository_dispatch` + `gestionar_indice` | indexa **un** video (loc/can/lado del payload) | segundos |
| B) Manual puntual | `workflow_dispatch` **con** inputs loc/can/lado | un video | segundos |
| C) **Barrido** | `schedule`, o `workflow_dispatch` **sin** inputs | **recorre todas las locaciones** | **~12-13 min** |

En las últimas 60 corridas (3→7 sep):

```
workflow_dispatch : 47      ← caen en el BARRIDO (rama C)
schedule          : 13      ← barrido también
repository_dispatch:  0      ← la vía rápida NUNCA se usa
```

**La rama rápida está implementada y funcional, esperando un evento que nadie manda.**

### Por qué se rompió: quedó huérfana en la migración

El disparo por-video no lo mandaba la NUC. Lo mandaba **el propio workflow de quemado**, al
terminar cada video:

```yaml
# procesar_ffmpeg.yml  (el que murió en febrero)
POST_HOOK_PATH: scripts/dispatch_gestionar_indice.py
POST_HOOK_ALWAYS: "false"
PAT_GITHUB: ${{ secrets.PAT_GITHUB }}
```

Ese hook hacía `POST /repos/{owner}/{repo}/dispatches` con
`event_type: "gestionar_indice"` y `client_payload: {loc, can, lado, file, dest, status}`,
sacando loc/can/lado del nombre del archivo (`Loc_Can_Lado_YYYYMMDD_HHMMSS.mp4`).

Cuando el quemado se movió a la NUC —que fue lo correcto, es mucho más rápido— **el hook se
fue con el workflow que se dejó de usar.** El script `scripts/dispatch_gestionar_indice.py`
ni siquiera existe ya en el repo (solo sobrevive en worktrees viejos de agentes).

Resultado: no quedó nadie avisando "ya hay video nuevo, indexa este". Solo queda el barrido.

**Síntoma que lo confirma:** 47 de las últimas 60 corridas son `workflow_dispatch` manual
disparadas por Isaac en 4 días. Se está compensando a mano, cada vez pagando 12-13 minutos,
un hook que se rompió en la migración.

---

## El arreglo

**Restaurar el disparo por-video, ahora desde la NUC.** Al terminar de publicar un clip, la
NUC hace un `repository_dispatch`:

```
POST https://api.github.com/repos/isaacsaltiel/puntazo_web_v2/dispatches
Authorization: Bearer <PAT>
{
  "event_type": "gestionar_indice",
  "client_payload": { "loc": "...", "can": "...", "lado": "...",
                      "file": "Loc_Can_Lado_YYYYMMDD_HHMMSS.mp4", "status": "ok" }
}
```

La rama A ya existe en `gestion_indice.yml` y la consume tal cual — **cero cambios en el
workflow**. El script viejo sirve de referencia exacta (está en
`.claude/worktrees/agent-a911b8affc75f391c/dispatch_gestionar_indice.py`).

Efecto: **de 12-13 min de barrido a segundos por video.** El barrido cada 8 h se queda como
red de seguridad para lo que se haya escapado.

Cosas a cuidar:
- El PAT que use la NUC necesita permiso de `repository_dispatch` en el repo.
- Que el nombre del archivo respete el patrón `Loc_Can_Lado_fecha_hora.mp4`, o mandar
  loc/can/lado explícitos en el payload.
- Aplica a las 3 NUCs.

---

## Lo que falta medir (ya sin adivinar el grueso)

Con el índice arreglado, lo que quede es del lado NUC. Para saber si vale la pena tocarlo,
instrumenta 5 clips reales con timestamp por etapa:

```
t0  pulso recibido / job creado         → Δ(t0→t1) = cola
t1  empieza extracción del NVR
t2  termina extracción                  → Δ = costo del NVR   ← el piso sospechoso
t3  termina corte + overlays            → Δ = encode real en la NUC
t4  termina subida a la nube            → Δ = red
t5  visible en la web                   → Δ = índice (esto es lo que arreglamos arriba)
```

**M1 — El NVR.** Muchos NVR sirven playback a 1×: bajar 30 s cuesta 30 s. Es el piso duro que
ningún cambio de software arregla. Si resulta caro, la salida es **grabación continua
segmentada** (rolling buffer): grabar en segmentos de ~2 s con `-c copy` y entonces "hacer un
clip" = copiar segmentos, décimas de segundo, sin tocar el NVR. Cuesta disco (~9 GB/día por
flujo a 850 kbps) y precisión de corte (±1 segmento). No lo construyas antes de medir M1.

**M2 — Pasadas de ffmpeg en la NUC.** ¿Cuántas invocaciones por clip? Si hay varias (cortar →
logos → intro/outro → poster), cada una re-encodea el video completo; el streaming hace una
sola con `filter_complex`. ¿Y usa `h264_qsv` o cayó a `libx264`?

---

## Nota de método (para no repetirlo)

La versión anterior de este doc concluía que el quemado corría en GitHub Actions. El error
fue leer `.github/workflows/procesar_ffmpeg.yml`, ver que existía y que instalaba ffmpeg, y
tratar eso como prueba de que se ejecuta — **sin mirar el historial de corridas**. Bastaba
una consulta a la API de Actions para ver que la última fue el 17-feb y falló.

Es el mismo patrón que ya nos mordió dos veces en agosto: el proceso que se contaba a sí
mismo, y el `applied_rev` sembrado a mano que parecía dato real. **Un artefacto en el repo no
es evidencia de comportamiento en producción.** Verificar contra lo que corre, no contra lo
que está escrito.
