# Worker NUC WellStreet — arreglar el WRITEBACK de `asset_sync` a Firestore

## Objetivo
El `asset_sync` de esta NUC **funciona bien**. Lo único roto es que **no reporta a
Firestore** lo que aplica. Hay que encontrar por qué y arreglarlo.

## Lo que YA sabemos (no lo re-investigues)
El log del runner de esta máquina, hoy 2026-09-08 a las 13:50:18, dice:
```
[INFO] asset sync cycle: ANUNCIO.webm:applied; outro.mp4:satisfied;
       puntazo_anim.webm:satisfied; wellstreet.webm:satisfied
```
De ahí se concluye, y está confirmado:
- El thread de sync **está vivo** y corre en ciclos.
- **Sí maneja `.webm`.** No hay problema de formato. (Una teoría anterior decía que
  saltaba los webm por leer nombres `.png`; **es falsa**, descártala.)
- Ya bajó y aplicó `ANUNCIO.webm` v5 (el banner del patrocinador Loka Healthy), unos
  3 minutos después de que se publicara centralmente.
- `outro.mp4`, `puntazo_anim.webm` y `wellstreet.webm` están `satisfied`, o sea la NUC
  ya tiene las versiones vigentes.

## El bug real
En Firestore, el writeback `applied['WellStreet-NUC']` de TODOS los docs `nuc_assets`
sigue congelado en:
```
version = 1   (con hashes que corresponden a v1)
ts       = 2026-06-06
```
Es decir: la NUC aplica los archivos correctamente pero **nunca actualiza su reporte**.
Eso hace que desde central sea imposible saber qué tiene cada club, y ya provocó un
diagnóstico equivocado. El writeback es la única observabilidad de la flota: sin él,
operamos a ciegas.

Contexto histórico útil: el 11-jun-2026 se observó que esta NUC **sí escribía** el
- `version` debe escribirse como **int**, NUNCA string.
- 🚨 **OJO — hallazgo del 8-sep en la NUC de Interpadel, léelo ANTES de tocar esto:**
  el re-sello del writeback NO puede depender de comparar la versión. El código típico
  solo re-escribe si `applied[nuc].version != version`. Como BreakPoint guarda la versión
  como **string**, `'3' != 3` siempre es True, y por eso BreakPoint se re-sella cada ciclo
  y *parece* sano. Interpadel guarda **int**, `3 != 3` es False, y por eso su writeback
  lleva congelado desde el 11-jun **aunque su sync funcione perfecto**.
  ⇒ Si aquí corriges el tipo a int SIN cambiar el mecanismo, esta NUC se queda MUDA
  igual que Interpadel. **Hace falta re-sello por TIEMPO**: reescribir el writeback si el
  `ts` propio tiene más de ~1 h, aunque la versión no haya cambiado. Las dos cosas
  juntas: `version` int **y** re-sello temporal.
normalizarlo desde central). O sea el código de escritura existe y en algún momento
funcionó. **Algo lo rompió o lo silenció entre el 6-jun y hoy.**

## FASE A — diagnóstico, SIN CAMBIAR NADA (obligatoria)
1. Abre `C:\Users\WellStreet\Desktop\Puntazo-release\asset_sync.py` y localiza el código
   que escribe el writeback a Firestore (el campo `applied` de la colección `nuc_assets`).
   Pega el fragmento en el reporte.
2. Responde: **¿se está ejecutando ese código?** Métele logging temporal si hace falta,
   o razónalo del flujo. ¿Está dentro de un `try/except` que se traga la excepción?
3. ¿Con qué identidad escribe? Localiza la credencial/service account que usa esta NUC
   para Firestore. **¿Sigue válida?** ¿Escribe con un `nuc_id` que siga siendo
   `WellStreet-NUC`, o alguien lo cambió?
4. Prueba de escritura mínima: intenta una escritura a Firestore desde esta máquina con
   la misma credencial y reporta el resultado exacto (éxito, o el error literal).
   Si falla por permisos, pega el mensaje completo.
5. Confirma con `sha256` que los archivos en `media/Prod/` corresponden a esta tabla
   (esto es sanity check, se espera que ya coincidan):

| archivo local | sha256 esperado | de qué doc viene |
|---|---|---|
| `ANUNCIO.webm` | `b578e6e23b2a82a6e4e1b699bdd756f3deb947333a2d5066d7ba01d774b176d6` | `global__anuncio` v5 |
| `puntazo_anim.webm` | `b1fbb67ff7e1b57d7c1ff2109f93efe292732443d36e26585a55071a60e80a62` | `global__logo_puntazo` v3 |
| `outro.mp4` | `09a91a730732f7efb9742cd6e01ec56c41ff1d606ff6ec61e77856c09f72a5ae` | `global__outro` v3 |
| `wellstreet.webm` | `61895df3d5bb1f703322f5f8c22787dbacfb467b689167cf3b80b0bd4574047d` | logos de club v2 |

6. Vuelca `media/Prod/.assets_state.json` (es el estado local que sí funciona; sirve para
   ver qué DEBERÍA estar reportando).
7. Busca en el log la última vez que el writeback tuvo éxito o falló, y qué pasó ese día.

**PARA AQUÍ y entrega el reporte de Fase A.**

## FASE B — arreglo (solo con autorización del maestro)
- Arregla la causa raíz del writeback.
- El writeback debe escribir, por cada doc que la NUC gestiona:
  `applied.WellStreet-NUC = { version: <int>, ts: <timestamp>, hash: <sha256 del archivo> }`
- ⚠️ `version` debe ser **int**, NUNCA string. Ese fue un bug viejo de esta misma NUC.
- Debe reportar tanto cuando aplica (`applied`) como cuando ya está al día (`satisfied`).
  Hoy no sabemos si el bug es "no escribe nunca" o "solo escribe al aplicar" — el
  writeback tiene que quedar correcto en los dos casos.
- Si una escritura falla, que lo LOGUEE con el error completo. Nunca en silencio.

## 🚩 Regla de negocio que NO debes romper
**WellStreet conserva el outro de Puntazo.** El outro del patrocinador (Loka) se publicó
solo como override por club para BreakPoint e Interpadel. En esta NUC, `outro.mp4` debe
seguir teniendo el hash `09a91a73…`. **No crees un `club__WellStreet-*__outro`.**
Si en algún momento ves aquí el hash `d1ee2068…`, es un ERROR y hay que revertirlo.

## Fuera de alcance
- No toques la descarga de assets: funciona. Solo el reporte a Firestore.
- No toques el pipeline de visión, el corte, la subida de clips, ni streaming.
- No borres versiones viejas de Dropbox (son el rollback).
- No "arregles" que los dos logos de club compartan archivo y hash: es intencional.

## Riesgos
- ⚠️ **Reiniciar el runner interrumpe grabaciones.** Si hay canchas en uso, avisa y
  propón hora. Este arreglo NO es urgente: los assets ya están bien, lo que falta es
  la observabilidad. No vale la pena tumbar una grabación por esto.
- Esta NUC sirve dos clubes (Padel y Pickleball) desde la misma máquina: el writeback
  debe cubrir los docs de AMBOS.

## Validaciones
1. Tras un ciclo de sync, `applied['WellStreet-NUC']` en Firestore muestra, para los 5
   docs, la versión vigente con `ts` de hoy y `version` como **int**.
2. El `hash` reportado coincide con el `sha256` real del archivo en disco.
3. Reinicia el runner y confirma que el writeback sigue funcionando.
4. Fuerza un caso `satisfied` (sin cambios) y confirma que también sella.

## Formato del reporte
```
## REPORTE NUC WELLSTREET — writeback asset_sync
### FASE A — diagnóstico
- fragmento de código del writeback:
- ¿se ejecuta?: sí|no  / ¿excepción tragada?:
- credencial/service account usada + ¿válida?:
- nuc_id con el que escribe:
- prueba de escritura a Firestore: resultado literal
- sha256 de media/Prod/ vs tabla: (OK/DIFIERE por archivo)
- .assets_state.json:
- última vez que el writeback funcionó / qué pasó:
- CAUSA RAÍZ:
### FASE B — arreglo (si se autorizó)
- qué cambié:
- validaciones 1-4:
### PENDIENTES / HALLAZGOS para el maestro
```
