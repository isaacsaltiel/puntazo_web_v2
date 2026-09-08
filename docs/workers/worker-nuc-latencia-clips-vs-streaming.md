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

### Por qué nunca se dispara: una guarda que se muerde la cola

Mi primera explicación fue que el hook había quedado huérfano al migrar el quemado a la NUC
(el disparo vivía dentro de `procesar_ffmpeg.yml`, con `POST_HOOK_PATH:
scripts/dispatch_gestionar_indice.py`, y ese script ya ni existe en el repo).

**El log de la NUC prueba que no es eso.** Ahí aparece:

```
GitHub dispatch omitido: workflow ya corre
```

O sea **la NUC sí tiene el dispatch cableado y sí lo intenta** — pero tiene una guarda que lo
omite si ya hay un workflow corriendo. Y como el **barrido dura 12-13 min** y se dispara
seguido, casi nunca hay una ventana libre.

**Es un círculo vicioso: el barrido tarda tanto que bloquea justo el mecanismo que lo volvería
innecesario.** Por eso el contador marca 0 de 60.

---

## El arreglo

### Opción A (la que propone la NUC, y es mejor) — sacar el CI del camino crítico

`recording_daily` ya se escribe **directo a Firestore en el mismo segundo**. En vez de pelear
por una ventana libre en Actions, **escribir también el metadato del clip por esa vía** y que
la página lo lea de ahí. Eso saca a GitHub Actions del camino crítico **por completo**, en
vez de hacerlo más rápido; el CI queda solo para el índice durable.

Es trabajo del **lado web** (la página tendría que leer clips de Firestore además de
`videos_index.json`), y ya hay precedente: `clip_states` y `pending_pulses.resolved_video` ya
se leen así.

### Opción B (parche, si A tarda) — quitar la guarda o hacer el barrido barato

El dispatch por-video ya funciona; lo único que le falta es poder ejecutarse. Dos vías:
- Que la NUC **encole el dispatch** en vez de omitirlo cuando hay uno corriendo.
- O que el `workflow_dispatch` mande **inputs loc/can/lado** para caer en la rama B (un
  video, segundos) en vez de la C (barrido, 12-13 min). Hoy se dispara sin inputs.

Cualquiera de las dos rompe el círculo. Pero A es la buena: mientras la publicación dependa
de Actions, sigue habiendo cola, y la cola es lo que nos trajo aquí.

## ✅ Medido por la NUC de BP (8-sep): la traza real

**4 min 20 s del botón al archivo en Dropbox.**

| Etapa | Tiempo | Peso |
|---|---|---|
| Encolado + espera | 45 s | 17 % |
| **Descarga del NVR** (1× tiempo real) | 65 s | 25 % |
| **ffmpeg pase 1** — logos y amplify | 117 s | 45 % |
| ffmpeg pase 2 + miniatura | 23 s | 9 % |
| Subida a Dropbox | 10 s | **4 %** |

Confirma las dos sospechas de este doc: el NVR entrega a **1× tiempo real**, y hay **dos
pases** de ffmpeg que juntos son el **54 %**. Y descarta una: **la subida nunca fue el
problema** (4 %).

### Lo demás que propone la NUC

- **Bajar el clip final a 1080p**: corta el encode casi a la mitad y de 52 MB a ~20 MB. Hoy
  el crudo del NVR pesa 21 MB en HEVC y el procesado 52 MB en H.264 — **procesar lo hace 2.5×
  más grande**, en 1440p, para algo que casi todo el mundo ve en el teléfono.
- **Fusionar los dos pases** de ffmpeg: ahorra 23 s y una escritura completa a disco.
- **Descarga acelerada del NVR: vía muerta probada.** La API de Hikvision
  (`ISAPI/ContentMgmt/download`) no funciona en ese NVR — la búsqueda devuelve 0 coincidencias
  aun pidiendo un día entero, mientras el RTSP de esa misma ventana sí responde. Queda la
  opción de tirar del substream para clips: 16× menos datos, a costa de calidad.

**Proyección de la NUC con los 3 primeros cambios:** 4m 20s → **~2m 20s** hasta el archivo
subido, y de "variable" a **segundos** hasta que se ve en la web.

## Nota de método (para no repetirlo)

La versión anterior de este doc concluía que el quemado corría en GitHub Actions. El error
fue leer `.github/workflows/procesar_ffmpeg.yml`, ver que existía y que instalaba ffmpeg, y
tratar eso como prueba de que se ejecuta — **sin mirar el historial de corridas**. Bastaba
una consulta a la API de Actions para ver que la última fue el 17-feb y falló.

Es el mismo patrón que ya nos mordió dos veces en agosto: el proceso que se contaba a sí
mismo, y el `applied_rev` sembrado a mano que parecía dato real. **Un artefacto en el repo no
es evidencia de comportamiento en producción.** Verificar contra lo que corre, no contra lo
que está escrito.
