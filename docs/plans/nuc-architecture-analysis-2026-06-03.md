# Arquitectura NUC Puntazo — Análisis 2026-06-03

> Objetivo: tener una imagen única y comparable del estado real de cada NUC
> (BreakPoint, WellStreet, Interpadel) antes de hacer el onboarding de
> Interpadel al stack actualizado. Este doc consolida lo que está
> documentado en `docs/workers/` y deja explícito lo que NO lo está y hay
> que descubrir en sitio.

## TL;DR

- **BreakPoint y WellStreet** tienen feature parity de arquitectura R4 + R6 +
  clip_states + Worker H + Worker I cuando los briefs respectivos
  estén ejecutados.
- **WellStreet** suma: multi-club (Pickleball + Padel en misma NUC), soporte
  match_full con tag `_PARTIDO_`, migración E0 desde CSV histórico.
- **Interpadel** NO está modelado en `docs/workers/`. Es una NUC que Isaac
  innovó por su cuenta — necesita auditoría completa antes de aplicarle
  todo el stack nuevo.
- **Logo animado / watermark / manejo de assets via Firebase + Dropbox**:
  no documentado en briefs. Forma parte del pipeline FFmpeg heredado en
  `script.py`. Hay que preguntarle a cada NUC qué hace hoy.

---

## 1. Estructura común de carpeta NUC

Path raíz típico (verificado en BP, asumido similar en WS/IP):
```
C:\Puntazo\runner\           (BreakPoint, confirmado por Worker D)
C:\Users\WellStreet\Desktop\Puntazo-release\   (WellStreet, inferido)
???                          (Interpadel, desconocido)

├── script.py                      orquestador monolítico (~2.5k líneas)
├── watchdog.py                    supervisor + kill por freeze
├── run_forever.bat                loop de reinicio (entry point)
├── AUTO_START_PUNTAZO.bat         lanzador al boot
├── STOP.flag                      kill switch
├── DEV_MODE.flag                  (Worker C) si existe, watchdog no roba focus
├── config.json                    NVR creds + mapeo cancha→canal (HOY: secretos en claro)
├── secrets/
│   └── service_account.json       admin SDK Firebase
├── queue/
│   ├── puntazo_local_queue.csv    cola persistente (única fuente de verdad)
│   ├── pulses.log                 (Worker A+) ledger append-only
│   └── archive/                   filas históricas podadas
├── logs/                          script.log, watchdog.log
├── media/                         clips descargados / en proceso
├── exportados/                    artefactos post-upload
├── tools/                         scripts auxiliares (cleanup_clip_states.py)
├── core/                          módulos en WS si arquitectura modular
│   ├── sources/                   forms_csv.py, firestore_pulses.py
│   ├── queue_manager.py
│   └── nvr_utils.py
└── .git/                          (Worker A+) versionado local
```

## 2. Módulos clave en `script.py`

Workers A-I añaden estas capas (cada una documentada en su brief):

| Función / módulo | Worker | Rol |
|---|---|---|
| `register_press`, `_finalize_chain`, `_persist_and_enqueue` | A | Captura → encola |
| `procesar_puntazo` (FFmpeg pipeline + rclone Dropbox + GH dispatch) | base | Worker que procesa el clip |
| `queue_on_failure` | base | Clasifica errores: `connection` (retry) vs terminal |
| `set_state(clip_id, new_state, detail)` | A | Transición de estado en CSV |
| `state_publisher_loop` | B | Thread daemon publica a `clip_states/` Firestore |
| `_handle_pending_pulse` | D | Listener Firestore con NVR-window check |
| `_listener_close_with_error(doc_ref, reason)` | D | Cierra doc con error_reason en una tx |
| `init_nuc_heartbeat`, `heartbeat_loop` | D | Escribe a `nuc_heartbeat/{clubId}` cada 30s |
| `_process_upload_resumen` | H | Sube foto resumen a Dropbox, marca match doc |
| `classify_download_error(stderr, http)` | I | Distingue RTSP 404 vs TCP timeout |

## 3. Comparativa BP vs WS

| Feature | BreakPoint | WellStreet |
|---|---|---|
| Listener `pending_pulses` Firestore (R4) | ✅ post-D | ✅ post-E0 |
| Heartbeat `nuc_heartbeat/{clubId}` (R6) | ✅ post-D | ✅ post-E |
| `clip_states/` publisher (R2) | ✅ post-B | ✅ post-G |
| NVR-window check pre-tx (7 días) | ✅ | ✅ |
| Replay-on-boot FIFO por `created_at` | ✅ | ✅ |
| Helper `_listener_close_with_error` | ✅ | ✅ |
| Migración CSV → Firestore (E0) | N/A (ya era Firestore) | ✅ |
| Soporte match_full (`_PARTIDO_<id>` tag) | ❌ (deuda) | ✅ post-F |
| Multi-club en mismo runner | N/A (1 club) | ✅ Pickleball + Padel |
| Foto resumen upload (Worker H) | ⏳ pending | ⏳ pending |
| Hot-patch RTSP 404 vs TCP (Worker I) | ⏳ pending | ⏳ pending |
| `config.json` versionado en git local | ✅ post-A | ⚠️ Worker HP pidió saneamiento |

Constantes diferentes:
- BP: `LISTENER_CLUB="BreakPoint"`, `LISTENER_NUC_ID="BreakPoint-NUC"`, retention 7d.
- WS: `LISTENER_CLUB="WellStreet-Pickleball"` (+ "WellStreet-Padel" si multi-club), `LISTENER_NUC_ID="WellStreet-NUC"`, retention 7d.

Particularidad de cableado (WS): mapeo Cancha5→canal 601 y Cancha6→canal 501 (invertidos respecto a la secuencia). Confirmado físicamente, NO tocar.

## 4. Pendientes y deudas documentadas

Resumen extraído de los briefs:

1. **`LISTENER_NUC_ID` hardcoded** (D, E, F). Debería ser UUID o configurable para soportar N NUCs por club.
2. **Regla Firestore `nuc_heartbeat/{clubId}` deploy pendiente** en Firebase Console (riesgo: `init_nuc_heartbeat` falla con permission-denied al primer boot).
3. **CSV histórico WellStreet → Firestore**: migración one-shot pendiente (E0).
4. **Secretos en claro en `config.json` de WellStreet** (HP): password NVR + GitHub PAT en texto plano. Pendiente rotar y separar `config.example.json`.
5. **Match_full debe emitir clip_states** igual que pulsos normales (F): `source="match_full"` en el doc, transición en_cola → visible.
6. **Worker I patterns de Hikvision** podrían no aplicar a otros firmwares (BP/WS específicos).
7. **Regla `pending_pulses` para `source="upload_resumen"`** (H): web debe pegar la rule extendida en Firebase Console antes de que el cliente intente escribir.
8. **Doble-ingesta**: si listener Firestore NO filtra estrictamente por club, puede procesar pulsos de otro club. Riesgo en NUCs futuras si se replica mal.

## 5. Logo animado / watermark / assets management

**Estado: NO DOCUMENTADO en `docs/workers/`.**

Lo que sí está mencionado en briefs (sin detalle):

- `script.py` tiene una función estilo `ffmpeg_amplify_and_logos()` que aplica "logos" al clip. No se especifica:
  - Qué es el logo (¿watermark Puntazo? ¿logo del club?).
  - Si es animado (video sobre el clip) o estático (PNG overlay).
  - Posición en el frame.
  - De dónde se carga (¿archivo local en `assets/` de la NUC? ¿Dropbox? ¿Firebase Storage?).
- Hay un `ffmpeg_concat_outro()` que pega un video de cierre (outro). Misma falta de detalle.

**Pregunta abierta para los workers**: ¿hay un logo animado actualizado que Isaac pide aplicar? ¿De dónde sale (Dropbox / Firebase Storage)? ¿Las 3 NUCs lo tienen sincronizado o cada una tiene su propia copia local?

**Manejo de assets via Firebase + Dropbox**: tampoco documentado. Worker H toca Dropbox para subir foto resumen, pero no hay módulo que sincronice assets COMUNES (logo, outro, fuentes, etc.) entre NUCs. Si Isaac quiere que un cambio al logo se propague a las 3 NUCs sin tocar cada una a mano, eso es feature nueva — no existe hoy.

## 6. Interpadel

**Estado: NO modelado en `docs/workers/`.**

Únicas menciones documentadas:
- `dictado-2026-05-26-v100.md:33-37`: "Interpadel SOLO tiene canchas 3, 4, 5, 6. No tiene 1 ni 2." — es un issue de UI web (mapear `B3.png` a Cancha3 etc.), no de NUC.
- `etapa-08c-boton-digital.md:113`: mención al pasar como club posible para testear.

**Hipótesis** (Isaac lo confirmó): Isaac trabajó la NUC de Interpadel por su cuenta, fuera del modelo master/worker. La NUC probablemente tiene su propio `script.py` evolucionado, posiblemente con features que las otras NUC no tienen, pero **NO tiene los workers B/D/E/G/H/I aplicados**.

Por lo tanto:
- Probable: no publica `clip_states/`.
- Probable: no escribe heartbeat.
- Probable: no tiene listener `pending_pulses` (sigue por Apps Script / Google Forms si esa es la ruta legacy de Interpadel).
- Probable: tiene features únicas no documentadas que vale la pena entender ANTES de aplicar el stack BP/WS.

## 7. Checklist genérico de auditoría NUC

Cuando un worker entra a una NUC nueva (o re-audita una existente), debería reportar:

### Estructura
- [ ] Path raíz del runner (`c:\Puntazo\runner` u otro)
- [ ] ¿Tiene `.git/` con historial? Si sí, último commit y rama actual
- [ ] Archivos top-level: `script.py` o `core/main.py` u otro
- [ ] Tamaño aproximado del `script.py` (LOC) — indica versión
- [ ] Existencia de: `watchdog.py`, `run_forever.bat`, `STOP.flag`, `DEV_MODE.flag`, `pulses.log`

### Config y secretos
- [ ] Estructura de `config.json`: claves de primer nivel
- [ ] Mapeo cancha → canal NVR
- [ ] Hay secretos en texto plano (password NVR, GitHub PAT, etc.)
- [ ] Si hay `secrets/service_account.json` y a qué proyecto Firebase apunta

### Pipeline de captura y procesamiento
- [ ] Cómo se ingieren pulsos hoy (Arduino serial / Forms / Firestore listener / teclado)
- [ ] ¿Procesa con FFmpeg? ¿Qué funciones (amplify, logos, outro, web-compat)?
- [ ] ¿Aplica watermark / logo? ¿Animado o estático? ¿De dónde se carga?
- [ ] ¿Hay outro al final del clip? ¿De qué duración?
- [ ] Path de Dropbox destino

### Resiliencia (workers A-I)
- [ ] ¿Tiene `pulses.log` append-only? (Worker A)
- [ ] ¿Tiene `set_state` con transición CSV de estados? (Worker A)
- [ ] ¿Publica a `clip_states/` Firestore? (Worker B/G)
- [ ] ¿Tiene `DEV_MODE.flag` honrado por watchdog? (Worker C)
- [ ] ¿Listener Firestore `pending_pulses` con filtro estricto por club? (Worker D/E0)
- [ ] ¿NVR-window check pre-tx con `error_reason`? (Worker D)
- [ ] ¿Heartbeat a `nuc_heartbeat/{clubId}` cada 30s? (Worker D/E)
- [ ] ¿Replay-on-boot FIFO por `created_at`? (Worker D)
- [ ] ¿`_listener_close_with_error` helper? (Worker D)
- [ ] ¿Soporte `source="upload_resumen"` para foto del resumen? (Worker H)
- [ ] ¿`classify_download_error` distingue RTSP 404 de TCP timeout? (Worker I)

### Específico WellStreet (multi-club + match_full)
- [ ] ¿Multi-club en mismo runner? (Pickleball + Padel)
- [ ] ¿Soporte match_full con tag `_PARTIDO_<id>`? (Worker F)
- [ ] ¿Migración CSV legado → Firestore completada? (Worker E0)

### Específico Interpadel (TBD)
- [ ] Features únicas no documentadas
- [ ] Canchas reales (3, 4, 5, 6 según dictado v100)
- [ ] NVR modelo + firmware + retention real
- [ ] Estado del flujo legacy (Apps Script / Forms / etc.)

---

## 8. Prompts para los workers

Tres prompts para mandar a los chats de Claude Code corriendo dentro de cada NUC. Cada uno arranca con un **paso de audit** explícito antes de tocar código — Isaac no quiere que un worker implemente algo que ya existe.

### Prompt para Worker BreakPoint (audit + Worker I + Worker H si no están)

```
Eres un worker NUC dentro del runner Puntazo en BreakPoint
(probablemente c:\Puntazo\runner — verifica con `cd` y `git log -1`).

Fase 1 — AUDITORÍA (read-only, no toques código).

Lee docs/plans/nuc-architecture-analysis-2026-06-03.md del repo web:
https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/plans/nuc-architecture-analysis-2026-06-03.md

Reporta usando el "Checklist genérico de auditoría NUC" de la sección 7:
1. Estructura real del runner (path, git, archivos top-level, tamaño LOC).
2. config.json: keys de primer nivel + estado de secretos.
3. Pipeline FFmpeg actual: ¿qué funciones tiene? ¿aplica logo/watermark?
   Si sí, ¿de dónde carga el logo, es animado o estático, qué posición,
   qué duración el outro?
4. Estado feature por feature de los workers A-I (cada item del checklist).
5. Constantes clave (LISTENER_CLUB, LISTENER_NUC_ID, NVR_RETENTION_DAYS).
6. Pendientes que TÚ percibes operando esta NUC y que no están en briefs.
7. Versión del firmware del NVR Hikvision.
8. ¿Hay un logo animado nuevo que Isaac haya dejado en alguna carpeta o
   en Dropbox/Firebase Storage esperando integrarse? Búscalo.

Fase 2 — IMPLEMENTACIÓN (SOLO después de que Isaac confirme tu audit).

Si el audit muestra que Worker I (classify_download_error: RTSP 404 vs
TCP timeout) NO está aplicado, ejecutarlo siguiendo el brief:
https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/workers/worker-local-I-procesar-puntazo-error-distinction.md

Si Worker H (upload_resumen) NO está aplicado, idem:
https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/workers/worker-local-H-resumen-image-upload.md

Reglas inviolables del README:
https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/workers/README.md

Si encuentras que un brief YA está implementado, NO toques nada — solo
reporta "ya estaba". Si parcialmente, reporta qué parte está y qué falta.

Branch para tus cambios: worker-local-audit-bp-2026-06-03 (audit) +
worker-local-I-procesar-puntazo-error-distinction si aplicas I, etc.

Reporta en formato exacto del README.
```

### Prompt para Worker WellStreet (audit + Worker I + Worker H si no están)

```
Eres un worker NUC dentro del runner Puntazo en WellStreet
(verifica con `cd` y `git log -1` el path real — probable
C:\Users\WellStreet\Desktop\Puntazo-release o similar).

Fase 1 — AUDITORÍA (read-only, no toques código).

Lee docs/plans/nuc-architecture-analysis-2026-06-03.md del repo web:
https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/plans/nuc-architecture-analysis-2026-06-03.md

Reporta usando el "Checklist genérico de auditoría NUC" de la sección 7:
1. Estructura real del runner.
2. config.json: estado de secretos (HP pidió saneamiento, ¿se hizo?).
3. Pipeline FFmpeg: ¿aplica logo/watermark? ¿de dónde? ¿animado o
   estático? ¿WS y BP tienen el mismo logo?
4. Estado feature por feature de los workers A-I.
5. Especifico WS:
   - ¿Multi-club Pickleball + Padel en mismo runner? ¿1 listener o 2?
   - ¿Soporte match_full con tag _PARTIDO_<id> activo?
   - ¿Migración CSV legado → Firestore (E0) completada o todavía
     hay filas en CSV que nunca pasaron a Firestore?
6. Mapeo cancha → canal NVR. Confirmar el swap Cancha5↔Cancha6 (601/501).
7. Pendientes que percibes operando esta NUC.
8. Versión firmware NVR Hikvision (Worker E reportó IP 192.168.33.4).
9. ¿Hay un logo animado nuevo esperando integrarse? Búscalo en
   carpetas locales + Dropbox.

Fase 2 — IMPLEMENTACIÓN (después del audit).

Mismo criterio que BP: aplicar Worker I y Worker H si NO están.

Brief I: https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/workers/worker-local-I-procesar-puntazo-error-distinction.md
Brief H: https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/workers/worker-local-H-resumen-image-upload.md
README: https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/workers/README.md

Reporta en formato del README.
```

### Prompt para Worker Interpadel (discovery puro)

```
Eres un worker NUC dentro del runner Puntazo en Interpadel
(verifica con `cd` y `git log -1` el path real — desconocido).

Esta es una NUC con la que Isaac trabajó FUERA del modelo master/worker
del repo web. Por lo tanto, los workers A-I que ya corrieron en BP y WS
probablemente NO están aplicados acá. Pero también puede tener features
únicas que las otras NUCs no tienen — Isaac dice que innovó más en
Interpadel.

ESTA ETAPA ES PURO DISCOVERY. NO TOQUES NADA DE CÓDIGO.

Fase 1 — Estructura del repo:
1. Path raíz del runner.
2. ¿Tiene `.git/`? Si sí, log de los últimos 30 commits con mensaje
   completo (queremos entender qué se innovó).
3. Listado de archivos top-level + tamaño LOC del `script.py` o
   equivalente.
4. Lista de imports / dependencias Python.

Fase 2 — Funcionalidad actual:
Lee docs/plans/nuc-architecture-analysis-2026-06-03.md del repo web:
https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/plans/nuc-architecture-analysis-2026-06-03.md

Reporta de cada item del "Checklist genérico de auditoría NUC" (sección 7)
si está presente, no presente, o si Interpadel tiene una variante propia.

Específico:
1. ¿Cómo ingiere pulsos hoy? (Forms / Apps Script / Firestore / teclado)
2. ¿Tiene watchdog? ¿Tiene pulses.log?
3. ¿Hay listener Firestore o sigue todo por canales legacy?
4. ¿Publica clip_states / heartbeat o nada?
5. ¿Cómo aplica el logo / watermark? ¿Es el MISMO que BP y WS? ¿Es animado?
6. ¿Tiene canchas 3, 4, 5, 6 (no tiene 1 ni 2 según el dictado web)?
7. Mapeo cancha → canal NVR.
8. Versión del NVR (modelo, firmware, IP).
9. Path Dropbox destino.

Fase 3 — Innovaciones únicas de Interpadel:
Reporta CADA feature que está en Interpadel pero NO en BP/WS según los
briefs A-I. Pueden ser:
- Funciones nuevas en script.py
- Scripts adicionales (tools/, post-process/, etc.)
- Integraciones con servicios externos
- Mejoras al pipeline FFmpeg
- UI / dashboards locales
- Logging / observabilidad extendida
- Cualquier cosa que valga la pena cosechar al stack BP/WS

Para cada innovación reporta: archivo + líneas + qué hace + impacto.

Fase 4 — Pendientes operativos:
Lo que Isaac o el operador del club percibe que falta o falla.

REPORTE en formato del README de workers del repo web:
https://raw.githubusercontent.com/isaacsaltiel/puntazo_web_v2/master/docs/workers/README.md

NO IMPLEMENTES NADA. El maestro decidirá después de leer tu audit qué
workers se aplican a Interpadel y en qué orden, y si hay innovaciones
que vale la pena portar a BP/WS primero.

Branch: worker-local-audit-interpadel-2026-06-03.
```

---

## 9. Próximos pasos sugeridos

1. **Isaac dispara los 3 prompts** (en orden o paralelo, da igual — son independientes).
2. **Cada worker reporta** en formato del README. Isaac los pega aquí (chat maestro).
3. **Maestro consolida** los reportes en `docs/plans/nuc-state-2026-06-XX.md` (estado por NUC tras audit).
4. **Maestro decide** orden de implementación para Interpadel:
   - Si tiene innovaciones cosechables → primero portar lo bueno a BP/WS.
   - Después, plan de onboarding Interpadel = secuencia A → B → C → D → E0 →
     F (si necesita match_full) → G → H → I.
5. **Resolver logo animado / assets management**: si Isaac confirma que es
   feature nueva, armar un brief específico (Worker J o similar) que defina:
   - Cómo se sincronizan los assets compartidos (logo, outro, fuentes)
     entre las 3 NUCs.
   - Si vive en Firebase Storage, Dropbox compartido, o repo git.
   - Cómo se aplica al pipeline FFmpeg.

---

*Doc generado el 2026-06-03 después de auditoría exhaustiva de
`docs/workers/` (briefs A-I + HP + E0 + agente-local-auditoria.md) y
búsqueda de menciones de logo/watermark/assets/Interpadel en
`docs/plans/` + memoria del proyecto.*
