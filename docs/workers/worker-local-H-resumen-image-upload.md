# Worker Local H — Upload de "foto del resumen" custom desde la web a Dropbox

> Worker de **implementación** corriendo dentro de la NUC (BreakPoint o
> WellStreet — aplica a las dos). Path probable: `c:\Puntazo\runner\`
> (verifica con `git log -1` al arrancar). NO trabaja sobre el repo web.
> Coordinado por el chat maestro.
>
> **Branch base**: `master` local del repo NUC. Esta etapa NO depende del
> rediseño del jugador.

## Objetivo

Cerrar el flujo H2 (foto del resumen del partido como artefacto **global**
del match): cuando un user vinculado al partido sube una foto custom
desde `resumen.html`, esa foto debe quedar guardada en Dropbox bajo una
URL pública y persistirse en el doc del match para que **todos** los que
abran el resumen vean la misma foto — no solo el que la subió.

Hoy en `resumen.html` el botón "Subir foto" cambia el background del card
local-only (data URL en el browser). Cuando recarga la página, se pierde.
F128-H2 ya agregó la **lectura** del campo `match.summaryImageUrl`. Falta:

- La **escritura** desde el cliente web a un canal que la NUC consuma.
- El **consumo** por la NUC: subir el blob a Dropbox y marcar la URL en
  el match doc.

Este brief cubre el lado NUC. La iteración web (UI de upload + polling)
va aparte y se dispara cuando este worker esté listo.

## Contexto que ya sabemos

### Flujo end-to-end propuesto

1. User vinculado abre `resumen.html?matchId=X`, sube una foto custom.
2. Cliente compone el card final con `html2canvas` a 1080×1920, lo
   convierte a JPEG q85 → blob ≈ 150-400 KB → base64 ≈ 200-540 KB.
3. Cliente escribe en `pending_pulses` un doc con shape **NUEVO**:
   ```js
   {
     source: "upload_resumen",
     match_id: "X",
     club: "<loc>",                  // del match doc (para que listeners por club lo consuman)
     uid_creator: "<user-uid>",
     created_at: serverTimestamp,
     payload_base64: "<base64 JPEG>",
     mime: "image/jpeg",
     // CAMPOS NULL para mantener compatibilidad con la rule actual de
     // create de pending_pulses (validation client_pulse_id, cancha, etc.).
     // Ver "Cambios coordinados que pide a la web" abajo.
     consumed_at: null,
     consumed_by: null,
   }
   ```
4. NUC detecta este doc, decodea, sube a Dropbox como
   `/Puntazo/Resumenes/{matchId}.jpg`, obtiene shared link permanente
   (mismo patrón que `gestion_indice_ci.py:59-66`), y:
   a. Marca `consumed_at: serverTimestamp` + `consumed_by:
      "<LISTENER_NUC_ID>"` + `summary_image_url: "<dropbox raw url>"`
      en el mismo doc de `pending_pulses`.
   b. **Update** el doc `matches/{matchId}` con
      `summaryImageUrl: "<dropbox raw url>"`. **Crítico**: este update
      lo hace el admin SDK (bypaseando rules), porque las rules
      actuales solo permiten al owner del match actualizarlo + a
      invitados modificar `jugadores`/`scoreAcceptedBy`/`updatedAt`
      (`firestore-rules-v100-fase3.md:48-67`).
5. Cliente (web) hace polling al doc `pending_pulses/{id}` y espera
   `consumed_at != null`. Cuando llega, refresca el match doc, ve el
   nuevo `summaryImageUrl` y el bg del card se actualiza
   automáticamente (F128-H2 ya hace esa lectura).

### Detalles importantes

- **Tamaño del payload**: Firestore tiene límite **1 MB por doc**. Con
  JPEG q85 a 1080×1920, el promedio es 200-400 KB binario → 270-540 KB
  base64. Cabe holgado. Si en algún caso patológico (foto con mucho
  detalle) supera 800 KB base64, el cliente debe re-comprimir a q70
  antes de escribir. NO es tu problema, es del cliente.
- **Idempotencia**: si dos users vinculados suben fotos casi
  simultáneas, los dos docs llegan a `pending_pulses`. La NUC consume
  ambos en orden FIFO. El último que escriba `matches/{matchId}
  .summaryImageUrl` gana. Aceptable — es la última versión, que es lo
  que el usuario espera.
- **Dropbox path determinístico**: `/Puntazo/Resumenes/{matchId}.jpg`.
  Si el matchId se repite (re-upload), `files_upload` con mode=overwrite
  reemplaza. El shared link existente sigue funcionando.
- **Solo BreakPoint hoy** tiene listener R4 con Worker B + Worker D.
  WellStreet espera Worker G. Para H, el listener debe ser **igual de
  agnóstico al club**: filtrar por `club==<LISTENER_CLUB>` igual que
  para pulsos de clip normal. Mismo doc, mismo schema, distinta
  `source`.

## Arquitectura relevante

- **Lenguaje**: Python.
- **Listener actual** (post-Worker D, `script.py:2007+`): filtra
  `pending_pulses where club==<LISTENER_CLUB> and consumed_at==null`.
  Hoy asume `source ∈ {web_boton, recovery, web, button}`. Hay que
  agregar el branch para `source == "upload_resumen"`.
- **Dropbox SDK**: ya en uso en `gestion_indice_ci.py:21-23, 37-43`.
  Reusar el mismo patrón de auth (refresh token OAuth2). Pero atención:
  ese script es del workflow CI, no del runner local. Verificar si el
  runner ya tiene credenciales Dropbox propias (probablemente sí, por
  rclone). Si no, **decidir con Isaac** si exponer el mismo refresh token
  al runner o configurar uno separado.

## Archivos importantes a revisar (esperados, verifica)

- `script.py` (o `core/main.py`) — orquestador con el listener Firestore.
- `config.json` — config local. Agregar:
  - `dropbox_resumen_dest`: `/Puntazo/Resumenes/`
  - Si NO hay credenciales Dropbox configuradas, agregar las que tenga
    Isaac (refresh_token, app_key, app_secret).
- `secrets/service_account.json` — credencial admin SDK Firebase
  (ya configurada por workers anteriores).
- `pulses.log` o equivalente — ledger.

## Decisiones críticas pendientes que el worker debe confirmar EN SITIO

1. **Credencial Dropbox para upload desde el runner**: ¿el runner
   tiene su propia credencial Dropbox o reusa la de rclone? Si la
   tiene, ¿qué scopes y refresh token? Coordinar con Isaac.

2. **Path de destino en Dropbox**: el brief sugiere
   `/Puntazo/Resumenes/{matchId}.jpg`. ¿OK con esa convención o Isaac
   prefiere otro path (ej. `/Puntazo/Locaciones/{loc}/Resumenes/`)?

3. **Tamaño máximo aceptado**: si llega un payload > 900 KB base64
   (apretado contra el límite 1 MB), ¿se procesa con re-compresión
   server-side, o se rechaza con `error_reason="payload_too_large"`?
   Recomendado: rechazar y obligar al cliente a comprimir.

4. **Permisos en `matches/{matchId}` update**: las rules actuales NO
   permiten que un admin SDK escriba `summaryImageUrl` desde fuera del
   owner. Como la NUC usa service account, **bypasea** las rules.
   Confirmar con Isaac (chat maestro) que está OK con que el admin
   SDK actualice `matches.summaryImageUrl` sin restricciones, y si
   más adelante se quiere restringir vía rule (que solo permita
   ese campo cuando viene de admin), Isaac actualiza las rules.

## Alcance

1. Auditar `script.py` para el branch nuevo de `source ==
   "upload_resumen"` dentro de `_handle_pending_pulse` (alrededor de
   `script.py:2007-2049` según Worker D).

2. Implementar `_process_upload_resumen(doc_id, doc_data)`:
   - Validar `match_id`, `payload_base64`, `mime`.
   - Decodear base64 (manejar errores).
   - Verificar tamaño descomprimido razonable (< 5 MB).
   - Subir a Dropbox vía SDK: `files_upload(decoded, path, mode=overwrite)`.
   - Obtener shared link permanente (`sharing_create_shared_link_with_settings`
     o `sharing_list_shared_links` si ya existe). Convertir a `?raw=1`
     igual que `gestion_indice_ci.py:46-53`.
   - Si OK: en una sola transacción Firestore:
     - `update pending_pulses/{doc_id}` con `consumed_at,
       consumed_by, summary_image_url`.
     - `update matches/{match_id}` con `summaryImageUrl`.
   - Si falla en algún paso: cerrar el doc con `error_reason` apropiado
     (`dropbox_upload_failed` / `base64_decode_failed` / `match_not_found`)
     y NO update el match doc.

3. Heartbeat: agregar a `nuc_heartbeat/{clubId}` un campo nuevo
   `resumenUploadsQueued` (count de docs con `source=upload_resumen` y
   `consumed_at=null`). Útil para la web saber si hay backlog.

4. Logging: cada upload exitoso log INFO con tamaño + path Dropbox +
   shared link. Cada fallo log WARNING con motivo + doc_id.

## Fuera de alcance

- **Cambios al cliente web**: la UI de "Guardar para todos" + polling se
  hace en una iteración web aparte cuando este worker esté listo y
  validado.
- **Migrar resúmenes históricos**: cero. Solo aplica a uploads nuevos.
- **Reglas Firestore para `pending_pulses` con `source=upload_resumen`**:
  ver "Cambios coordinados que pide a la web" abajo. La regla actual
  exige `client_pulse_id`, `cancha`, `lado`, etc. — campos que NO tienen
  los uploads de resumen. **Hay que ampliar la regla** para que los
  docs `source=upload_resumen` no necesiten esos campos. Eso lo hace
  el maestro web cuando reciba este reporte.
- **Cloud Function de fallback**: nada. Mantenemos todo en NUC + web.
- **Reglas para `matches/{matchId}.summaryImageUrl` update**: el admin
  SDK bypasea rules. Si Isaac decide endurecer (ej. solo permitir
  `summaryImageUrl` cuando viene de admin), eso es otra etapa.

## Riesgos

- **Doc gigante en Firestore**: si el cliente sube un payload > 1 MB
  por error, la write falla con `INVALID_ARGUMENT`. El cliente debe
  comprimir antes. Documentar el límite client-side.
- **Dropbox rate limits**: el SDK puede arrojar `RateLimitError`. Worker
  D ya maneja esto en `gestion_indice_ci.py`; reusar el mismo retry
  con backoff.
- **Match no existe**: si `match_id` viene de un client maldicioso o
  está mal escrito, marcar `error_reason: match_not_found` y NO subir
  a Dropbox (ahorra storage).
- **Permission denied en update `matches/`**: si el admin SDK por algún
  motivo pierde permisos, el doc de pending_pulses queda con
  `error_reason: match_update_failed`. Web debe detectar.

## Validaciones

Cada item ✅ ❌ o ⏭️ con razón en el reporte:

1. **Doc test desde Firestore Console**: crear manualmente un doc en
   `pending_pulses` con `source="upload_resumen"`, `match_id=<un match
   ended real>`, `payload_base64=<JPEG chico 50KB encoded>`. Verificar
   que la NUC lo consume en ≤60s, sube a Dropbox, marca summary_image_url
   en el pending_pulse Y en el match doc.

2. **Shared link funciona**: la URL final debe ser HTTPS con `?raw=1`
   y servir el JPEG cuando se abre en browser.

3. **Re-upload (idempotencia)**: subir un segundo doc para el mismo
   match_id. El Dropbox path se sobrescribe. El match doc se actualiza
   con la nueva URL.

4. **Match inexistente**: subir con `match_id="aaa-bbb-no-existe"`.
   Verificar que el doc se marca con `error_reason: match_not_found`
   y que NO se sube a Dropbox.

5. **Payload corrupto**: subir con `payload_base64="not_valid_base64"`.
   Verificar `error_reason: base64_decode_failed`.

6. **Heartbeat `resumenUploadsQueued`**: con 2 docs sin consumir,
   verificar que el heartbeat reporta `resumenUploadsQueued: 2`. Tras
   consumirlos, vuelve a 0.

7. **No interfiere con clips normales**: durante una sesión de pulsos
   de clip (source="web_boton"), subir simultáneo 1 upload_resumen.
   Ambos se procesan independientes. El listener no se confunde.

## Definition of done

- Listener procesa `source=upload_resumen` correctamente.
- Upload a Dropbox + shared link con `?raw=1` funcionando.
- Update simultáneo de `pending_pulses` Y `matches/{matchId}` cuando OK.
- `error_reason` apropiado cuando hay fallo (sin update del match).
- Heartbeat `resumenUploadsQueued` reportando count.
- Validaciones 1-7 documentadas.
- Branch `worker-local-H-resumen-image-upload` con commit SHA.
- Reporte en formato `docs/workers/README.md`.

## Cambios coordinados que pide a la web

En el reporte final incluir explícito:

1. **Modificación a Firestore rules para `pending_pulses` create**:
   La rule actual (`firestore-rules-v100-fase3.md:133-148`) exige
   `client_pulse_id`, `cancha`, `source ∈ {web_boton, recovery, web,
   button}`, etc. Para `source=upload_resumen` esos campos NO aplican.
   Propuesta de rule extendida:
   ```firestore
   match /pending_pulses/{pulseId} {
     allow create: if (
       // Caso original (pulso de clip)
       (request.resource.data.source in ["web_boton","recovery","web","button"]
         && request.resource.data.client_pulse_id is string
         && request.resource.data.cancha is string
         && /* resto del schema actual */)
       ||
       // NUEVO caso F128-H2 (upload de foto resumen)
       (request.resource.data.source == "upload_resumen"
         && request.resource.data.match_id is string
         && request.resource.data.payload_base64 is string
         && request.resource.data.uid_creator == request.auth.uid
         && request.resource.data.consumed_at == null
         && request.resource.data.created_at == request.time)
     );
     // ... allow read / update / delete iguales que hoy ...
   }
   ```

2. **Diff exacto** a aplicar en `docs/plans/firestore-rules-v100-fase3.md`.

3. **Timing recomendado**: maestro web debe pegar las rules nuevas en
   Firebase Console **antes** de mergear la iteración web del upload UI
   (sino los writes desde el cliente fallarán). El worker H puede
   funcionar standalone con docs manuales mientras tanto.

## Formato del reporte de regreso

Ver `docs/workers/README.md`. Sí o sí incluir:

- Branch + commit SHA local.
- Validaciones 1-7 con outputs.
- Bloque "Reglas Firestore propuestas" con el diff exacto + texto a
  pegar en Firebase Console.
- Bloque "Cambios coordinados que pide a la web" con el plan para la
  iteración web del upload UI (qué endpoints/campos espera el cliente,
  cómo hacer el polling).

---

**Referencias rápidas**:

- Etapa hermana (clip pulses): `worker-local-D-pulse-resilience.md`.
- Reglas propuestas R6: `worker-local-D-pulse-resilience.md` bloque final.
- F128-H2 web lectura: commit `5b3c8ed4b` (refleja `match.summaryImageUrl`
  como bg del card).
- Repo web (solo lectura desde la NUC):
  https://github.com/isaacsaltiel/puntazo_web_v2
