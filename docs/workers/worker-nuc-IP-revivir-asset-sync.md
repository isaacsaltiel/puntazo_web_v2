# Worker NUC Interpadel — revivir `asset_sync` y aplicar el patrocinio de Loka

## Objetivo
Esta NUC dejó de aplicar assets de marca. Hay que **descubrir por qué**, arreglarlo, y
dejarla aplicando la versión vigente de cada asset — incluido un asset NUEVO
(`club__Interpadel__outro`) que nunca ha existido en esta máquina.

## Contexto (lo que pasó del lado central, 8-sep-2026)
Puntazo consiguió su **primer patrocinador pagado: Loka Healthy**. Se publicaron:
- `global__anuncio` **v5** = banner animado de Loka (reemplaza el viejo "¿Tu marca aquí?").
- `club__Interpadel__outro` **v1** = outro co-branded "Loka × Puntazo" (10s, con audio).
  Es un **override por club**: la NUC debe aplicar `global__{slot}` y luego
  `club__{ClubId}__{slot}` ENCIMA si existe. Ambos apuntan al mismo archivo local
  (`outro.mp4`), y eso es intencional: así el club pisa al global.

**Ya está probado que el override por club funciona**: BreakPoint-NUC aplicó su
`club__BreakPoint__outro` v1 el 2026-09-08 a las 19:57:53 UTC, en su primer ciclo.
Si en Interpadel no funciona, es una diferencia del código de ESTA NUC.

## El síntoma — y una pista MUY fuerte de la NUC hermana
En Firestore, el writeback `applied['Interpadel-NUC']` de TODOS los assets tiene
timestamp **2026-06-11 16:17:44** y no se ha movido, aunque `global__anuncio` ya pasó
de v4 a v5.

🚨 **PERO**: hoy 2026-09-08 se descubrió que en la NUC de **WellStreet** pasaba
exactamente lo mismo (writeback congelado desde el 6-jun) y resultó que **su sync está
perfectamente vivo**. Su log decía:
```
[INFO] asset sync cycle: ANUNCIO.webm:applied; outro.mp4:satisfied;
       puntazo_anim.webm:satisfied; wellstreet.webm:satisfied
```
O sea: descargaba y aplicaba bien, pero **nunca actualizaba el writeback**.

⚠️ **Es muy probable que Interpadel esté igual.** Por eso el paso 1 de la Fase A es
mirar el log, no el código. Si el log muestra ciclos de sync recientes, el problema NO
es el sync sino el writeback, y este brief se vuelve mucho más chico.

Hipótesis, en orden de probabilidad:
- **(A)** el sync vive y solo el **writeback a Firestore** está roto ← la más probable
- **(B)** el sync vive pero no detecta el doc NUEVO `club__Interpadel__outro` (nunca ha
  existido un override por club en esta máquina)
- **(C)** el thread de sync está muerto

**El writeback es la única observabilidad de la flota.** Aunque los archivos estén bien,
si no reporta operamos a ciegas — y eso ya causó un diagnóstico equivocado.

## Estado que DEBE quedar en esta NUC (tabla de verdad)
| doc Firestore | v | archivo local destino | sha256 |
|---|---|---|---|
| `global__anuncio` | 5 | `ANUNCIO.webm` | `b578e6e23b2a82a6e4e1b699bdd756f3deb947333a2d5066d7ba01d774b176d6` |
| `global__logo_puntazo` | 3 | `puntazo_anim.webm` | `b1fbb67ff7e1b57d7c1ff2109f93efe292732443d36e26585a55071a60e80a62` |
| `global__outro` | 3 | `outro.mp4` | `09a91a730732f7efb9742cd6e01ec56c41ff1d606ff6ec61e77856c09f72a5ae` |
| `club__Interpadel__logo_club` | 1 | `interpadel.png` | `81e2cb5ef581629a67ba0dad93f789467126f3f2fb86ee0c3534dc10765613e4` |
| `club__Interpadel__outro` | 1 | `outro.mp4` | `d1ee206893ba229b317e713471bc0e5977eb7fcb0d842322836ac5990d1432e2` |

⚠️ `outro.mp4` aparece dos veces **a propósito**. El resultado correcto es que el archivo
local `outro.mp4` termine con el hash de `club__Interpadel__outro` (`d1ee2068…`), NO con
el de `global__outro`. Si tu código no soporta override por club para el slot `outro`,
ese es justamente el bug a arreglar.

## FASE A — diagnóstico, SIN CAMBIAR NADA (obligatoria)
No modifiques ni un archivo hasta terminar esta fase y entregar el reporte.
0. **EMPIEZA POR EL LOG DEL RUNNER.** Busca líneas tipo `asset sync cycle:` (así se ven
   en WellStreet). ¿Hay ciclos recientes? ¿Qué dice de cada archivo: `applied`,
   `satisfied`, o algo más? Esto responde en un minuto si el sync vive. Ponlo primero
   en el reporte.
1. ¿Está vivo el runner? ¿Desde cuándo? ¿Qué proceso lo levanta?
2. Localiza el módulo de sincronización de assets (en otras NUCs se llama
   `asset_sync.py` y se arranca desde `main.py` con algo tipo
   `start_background_sync(stop_event=...)`). Confirma **si el thread está corriendo**.
3. Encuentra el archivo de estado local (en WellStreet es `media/Prod/.assets_state.json`).
   Vuelca su contenido.
4. **Verdad de disco**: localiza la carpeta de assets que lee FFmpeg y saca el
   `sha256` REAL de cada archivo (`ANUNCIO.*`, `puntazo_anim.*`, `outro.mp4`,
   `interpadel.*`). Compáralos contra la tabla de arriba. Esto es lo único que dice
   qué se está viendo en cancha; el writeback de Firestore NO es confiable.
5. `rclone listremotes` y **descubre cuál remote ve** `/Puntazo/assets/global/v5__anuncio.webm`.
   ⚠️ NO asumas `dropbox:` — en WellStreet el remote resultó llamarse `nombre:`.
6. Revisa el log del runner buscando errores del sync: excepciones, `skip_incompatible_format`,
   fallos de rclone, fallos de credenciales de Firestore.
7. Lee el código del sync y responde explícitamente: **¿filtra `club__Interpadel__*`
   además de `global__*`? ¿Aplica el club ENCIMA del global? ¿Para cualquier slot o solo
   para `logo_club`?**

**PARA AQUÍ y entrega el reporte de Fase A.** Si algo no cuadra con lo descrito, dilo en
vez de improvisar.

## FASE B — arreglo (solo después de que el maestro apruebe la Fase A)
- Arregla la causa raíz que encontraste.
- **Si el problema es el writeback** (lo más probable): que escriba
  `applied.Interpadel-NUC = { version: <int>, ts, hash }` en CADA ciclo, tanto cuando
  aplica como cuando ya está `satisfied`. Si una escritura falla, que lo loguee con el
  error completo, nunca en silencio.
- Si falta soporte de override por club para slots que no sean `logo_club`, impleméntalo:
  aplicar `global__{slot}` y luego `club__{ClubId}__{slot}` encima.
- El writeback debe escribir `version` como **int**, nunca string.
- Deja el sync corriendo de forma continua y sobreviviendo a reinicios del runner.

## Fuera de alcance
- No toques el pipeline de visión, la lógica de corte, ni la subida de clips.
- No cambies nada de streaming.
- No modifiques documentos de Firestore desde la NUC salvo el writeback `applied`.
- No borres versiones viejas de Dropbox.

## Riesgos
- ⚠️ **Reiniciar el runner interrumpe grabaciones.** Si hay canchas en uso, avisa y
  espera indicación antes de reiniciar. Di siempre a qué hora propones hacerlo.
- El `outro.mp4` pesa 9.2 MB y trae **pista de audio AAC 44100** (el viejo también la
  traía, a 44100). Si tu pipeline concatena, verifica que no truene el audio.
- Si el sync arranca y baja todo de golpe, puede coincidir con un encode en curso.

## Validaciones (obligatorias antes de declarar hecho)
1. `sha256` de cada archivo local == la tabla de verdad. En particular
   `outro.mp4` == `d1ee2068…` (el de Loka), NO `09a91a73…`.
2. `applied['Interpadel-NUC']` en Firestore muestra la versión correcta de los 5 docs,
   con timestamp de hoy y `version` como int.
3. El sync sobrevive: reinicia el runner y confirma que el thread vuelve solo.
4. Genera/observa **un clip real** y confirma en el video que sale el banner de Loka
   y que el cierre es el outro "Loka × Puntazo" (10s, con música), no el de Puntazo.

## Formato del reporte
```
## REPORTE NUC INTERPADEL — asset_sync
### FASE A — diagnóstico
- LOG: ¿hay ciclos `asset sync cycle:` recientes? ¿qué dicen?
- runner vivo desde:
- módulo de sync (ruta) / thread vivo: sí|no
- archivo de estado local (ruta + contenido):
- HASHES REALES EN DISCO vs esperados: (tabla, marca OK/DIFIERE por archivo)
- rclone remote que ve /Puntazo/assets/: 
- errores encontrados en log:
- ¿el código soporta override club-sobre-global? ¿para qué slots?
- CAUSA RAÍZ:
### FASE B — arreglo (si se autorizó)
- qué cambié (archivos + diff resumido):
- validaciones 1-4: resultado de cada una
- clip de prueba (URL o ruta):
### PENDIENTES / HALLAZGOS para el maestro
```
