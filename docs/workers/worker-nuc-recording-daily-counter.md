# Brief NUC — Contador en vivo de grabaciones (`recording_daily`)

**Para:** el Claude que corre en **cada NUC de club** (BreakPoint, Interpadel,
WellStreet-Padel, WellStreet-Pickleball — y Scorpion si sigue activo).
**De:** el Claude maestro (PC de Isaac — Firestore + web).
**Asunto:** que la pestaña **🏢 Clubs** del admin deje de tardar horas en reflejar
un clip nuevo. Hoy depende de que corra `gestion_indice.yml` (GitHub Actions,
serializado en un solo carril, ~1 min de overhead por corrida) y de que GitHub
Pages publique el JSON resultante. Vamos a que **tu NUC escriba un contador
directo a Firestore en el momento en que termina de generar+subir cada clip**
— el mismo instante en que ya escribes el heartbeat de cola / el stamp
`resolved_video` en `pending_pulses`.

> Esto es **aditivo**: no toca el flujo CSV/Arduino/upload existente. Si el
> write a Firestore falla, solo logueas y sigues — nunca bloquees ni reintentes
> la subida del clip por esto.

---

## 0. Decisiones ya tomadas por Isaac (no las re-preguntes)

1. **Colección `recording_daily`**, 1 doc por `(club, cancha, lado, día)` —
   NO un doc por clip. Se incrementa con `firestore.Increment(1)`.
2. **Sin cambios de reglas de tu lado.** Escribes con el Admin SDK (el mismo
   service account que ya usas para `pending_pulses`/`nuc_heartbeat`), que
   **omite las reglas de Firestore por completo**. El maestro ya desplegó la
   regla de LECTURA (solo `flags.isAdmin`) y dejó la escritura cerrada para
   cualquier cliente que no sea el Admin SDK — a propósito, nadie más debe
   escribir aquí.
3. **El maestro ya adaptó `admin.html`** para leer esta colección y mezclarla
   con el respaldo `videos_log.csv` (Firestore gana por `fecha+club+cancha+lado`;
   el CSV solo rellena huecos donde tu NUC todavía no ha corrido esto). **No
   hace falta tocar nada más del lado web** — en cuanto tu NUC empiece a
   escribir, la pestaña Clubs se pone en vivo sola para tu club.

---

## 1. Contrato Firestore (shape exacto)

```python
from firebase_admin import firestore

fecha_local = datetime.now().strftime("%Y-%m-%d")   # HORA LOCAL del club, no UTC
doc_id = f"{loc}_{can}_{lado}_{fecha_local}"          # ej: "BreakPoint_Cancha3_LadoA_2026-08-11"

db.collection("recording_daily").document(doc_id).set({
    "loc":  loc,           # == club en pending_pulses / config_locations.json
    "can":  can,           # ej "Cancha3"
    "lado": lado,          # ej "LadoA"
    "fecha": fecha_local,  # YYYY-MM-DD, mismo criterio que local_date del CSV
    "count": firestore.Increment(1),
    "updated_at": firestore.SERVER_TIMESTAMP,
    "nuc_id": LISTENER_NUC_ID,   # el mismo id que ya usas en nuc_heartbeat
}, merge=True)
```

- `fecha_local` **debe** ser hora local del club (no UTC) para que cuadre 1:1
  con `local_date` del CSV — si no, un clip a las 11pm puede caer en un día
  distinto entre las dos fuentes y se duplica al mezclarlas.
- `loc`/`can`/`lado`: usa **exactamente** los mismos ids que ya usas para
  `club`/`cancha` al escribir en `pending_pulses`/`clip_states`. Tabla de
  referencia (de `data/config_locations.json` del repo web):

| Club (`loc`) | Canchas (`can`) | `lado` |
|---|---|---|
| `BreakPoint` | `Cancha1`…`Cancha5` | `LadoA` |
| `Interpadel` | `Cancha3`,`Cancha4`,`Cancha5`,`Cancha6` | `LadoA` |
| `WellStreet-Padel` | `Cancha1`…`Cancha4` | `LadoA` |
| `WellStreet-Pickleball` | `Cancha1`…`Cancha6` | `LadoA` |
| `Scorpion` (si tu NUC es esta) | `Cancha1`,`Cancha2` | `LadoA`, `LadoB` |

---

## 2. Dónde engancharlo (genérico — cada NUC ya divergió)

Cada NUC de este proyecto **ya se separó de este runner base** (fue así desde
el "Nivel 1" del stamp-back de `resolved_video`, 11-jun) — no asumas que tu
código es idéntico al de otra NUC. Ubica **tu** equivalente exacto de:

> El punto donde tu pipeline marca un job de la cola como **subido/terminado
> con éxito** — normalmente en `queue_manager.py` o `pipeline.py`, justo
> después del upload a Dropbox/GitHub y **antes** de que el job pueda
> reintentarse. Es el mismo punto (o muy cercano) donde ya escribes el
> heartbeat de cola o el stamp `resolved_video`.

Si tu NUC ingiere clips por varias fuentes a la vez (CSV/Arduino **+**
Firestore `pending_pulses`), el contador debe subir **una sola vez por clip**
sin importar la fuente — pon el write en el punto donde **convergen** todas
las fuentes (justo tras el upload exitoso), no duplicado dentro de cada fuente
por separado. Esa es la misma razón por la que `firestore_pulses.py` reusa
`queue_add_pending` en vez de subir el archivo dos veces — el hook de conteo
va en el mismo lugar donde eso ya se resuelve.

**Degradación graceful:** envuelve el write en `try/except`; si falla
(sin red, permisos, service account no encontrado), loguea un warning y
continúa — igual que hace `_init_firestore()` en `firestore_pulses.py`. Nunca
debe tumbar ni pausar la subida real del clip.

---

## 3. Probar (E2E)

1. Fuerza un clip de prueba (botón físico o pulso web) en una cancha conocida.
2. Confirma que aparece/incrementa `recording_daily/{loc}_{can}_{lado}_{hoy}`
   (consola de Firebase, o un query rápido de una línea con el Admin SDK).
3. En `admin.html` → pestaña **🏢 Clubs**, período **Hoy**: el número debe subir
   en el siguiente refresh del panel (botón actualizar / recargar) — **no**
   debe esperar horas ni depender de que corra el GitHub Action. El recuadro
   "Fuente" de la pestaña debe decir `🔥 ... en vivo` en vez de solo el CSV.
4. Confirma que el flujo CSV/Arduino existente **no cambió de comportamiento**
   (esto es aditivo).

**Repórtame:** club, cancha probada, si el doc `recording_daily` apareció con
el conteo correcto, y si el flujo existente siguió intacto.

---

## 4. Qué te entrego yo (maestro) — ya está, no esperes nada

- Colección `recording_daily` con regla de **lectura solo-admin** desplegada;
  **escritura cerrada para cualquier cliente** (solo tu Admin SDK puede
  escribir, porque el Admin SDK omite las reglas).
- `admin.html` (pestaña Clubs) ya lee `recording_daily` y lo mezcla con el
  respaldo `videos_log.csv` — no depende de que las 4-5 NUCs se actualicen a
  la vez; cada club se pone en vivo por su cuenta en cuanto su NUC despliega
  esto.
- `videos_log.csv` / `gestion_indice.yml` **siguen corriendo igual** — quedan
  como respaldo histórico/exportable, no los toques ni los apagues.

## 5. Qué necesito de ti (NUC) — para cerrar

| Tarea | Dueño |
|---|---|
| Ubicar el punto de "job terminado con éxito" en tu pipeline | NUC |
| Agregar el write a `recording_daily` (Admin SDK, `Increment(1)`, `merge=True`) | NUC |
| Verificar que `loc`/`can`/`lado` coincidan con la tabla de arriba | NUC |
| Probar E2E (§3) y reportar | NUC |

---

## Addenda (post-rollout BreakPoint/WellStreet/Interpadel, 2026-08-11)

Ya aplicado y verificado en BreakPoint, WellStreet (Padel+Pickleball) e
Interpadel. Si te toca aplicarlo a ti todavía, dos correcciones sobre el §1:

1. **Usa la hora del EVENTO, no `datetime.now()`.** BreakPoint lo hizo bien:
   usa el mismo timestamp que ya usas para nombrar el archivo/`fecha_tag` del
   clip (p.ej. `first_press`), no la hora en que tu código de upload termina
   de correr. Si usas `now()`, un clip de las 23:59 procesado ya pasada la
   medianoche cae en un día distinto en Firestore que en el CSV (`local_date`)
   — exactamente la duplicación al mezclar que este contador debía evitar.
2. **Si tu pipeline mete al mismo índice/CSV tanto "puntazos" (clips cortos)
   como grabaciones de partido completo ("PARTIDO"), cuenta ambos.** WellStreet
   lo detectó: si solo cuentas puntazos, el contador en vivo deja de cuadrar
   1:1 contra el respaldo CSV (que sí incluye ambos). El criterio es: cuenta
   cualquier cosa que termine apareciendo en `videos_log.csv` / el índice.
3. **Para limpiar un clip de prueba: NO borres el doc de `recording_daily`,
   escríbelo con `count: 0`.** `generar_metricas.py` (el que arma
   `videos_log.csv`) escanea Dropbox cada 8h (`schedule` en
   `generar_metricas.yml`) y es puramente ADITIVO — si tu clip de prueba ya
   fue escaneado antes de que lo borraras, queda una fila fantasma
   PERMANENTE en el CSV (no se autocorrige nunca, ni borrando el archivo de
   Dropbox después). Si borras el doc de Firestore, el merge de `admin.html`
   cae al CSV para esa celda y esa fila fantasma sí se cuenta. Si en cambio
   dejas el doc con `count:0`, el merge la sigue tomando de Firestore (gana
   por celda) y la fantasma del CSV queda tapada. Borra igual el clip, la
   miniatura, la copia local y el `clip_states` — eso sí bórralo normal.
   (Caso real: Interpadel-NUC, 2026-08-11/12 — confirmado por el maestro.)
