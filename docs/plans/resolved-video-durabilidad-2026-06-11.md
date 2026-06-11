# Durabilidad de clips de botón vía `resolved_video` (11-jun-2026)

Estado: **Nivel 1 LIVE** (NUCs + web en producción, verificado end-to-end).
Falta: **Nivel 2** (URL durable desde el indexador) — ver más abajo.

Web: commit `7a5f89062` en `master`.

---

## El problema (de tiempos)

La notificación "tu puntazo ya está listo" se crea **antes** de que exista el
nombre del video. Secuencia real de un pulso de botón:

1. Se crea el doc `pending_pulses` (club, cancha, lado, hora). **No hay video.**
2. La NUC lo recibe, lo encola y marca `consumed_at` (ACK de ingesta).
3. **Minutos después**: corta el clip del NVR, logos/outro/web-compat, sube a
   Dropbox. **Hasta aquí existe el nombre final** (`club_cancha_lado_DDMMYYYY_HHMMSS.mp4`).
4. El indexador (GitHub Action `gestion_indice`) arma `videos_recientes.json`
   con la URL del clip.

Como la notificación se dispara en el paso 2, **no conoce el nombre del clip** →
mandaba a `perfil.html` (genérico). La web "adivinaba" cuál era el clip cruzando
el `consumed_at` del pulso contra los timestamps de `videos_recientes.json` por
ventana de ±90s.

### Consecuencias de adivinar
- `videos_recientes.json` es rolling (~días). Si el clip caducó del índice, **no
  hay con qué casar** → el deep-link y la persistencia en "Mis clips" fallan.
- Depende del reloj/zona del navegador.
- Doble-botón rápido en la misma cancha → ambigüedad.

---

## La solución

**La NUC, que es la única que conoce el nombre final del clip (paso 3), lo
escribe de vuelta en el doc `pending_pulses`** en el campo `resolved_video`, justo
tras el upload exitoso. A partir de ahí todo downstream es exacto y durable, sin
adivinar.

```
pending_pulses/{id}: { ..., resolved_video: "Interpadel_Cancha4_LadoA_11062026_104045.mp4",
                            resolved_at: <serverTimestamp> }
```

`resolved_video` es un campo **nuevo** que nada más escribe — su sola presencia
prueba que el código nuevo corrió.

---

## Implementación NUC (las 3 arquitecturas)

El eslabón de fondo que faltaba: el `external_id` (= `client_pulse_id`) viajaba
en el CSV de la cola pero **se descartaba** antes de llegar al paso de publicar.
Las 3 NUCs lo recuperan del CSV por `job_id` y lo agregan al job, luego llaman
una función `mark_pulse_resolved(client_pulse_id, resolved_video)` (best-effort,
nunca lanza; query `pending_pulses where client_pulse_id == external_id`, update
`{resolved_video, resolved_at}`).

| NUC | Ruta / módulo Firestore | Guard del write-back | `consumed_at` se marca |
|---|---|---|---|
| **BreakPoint** | `c:\Puntazo\runner` · monolito `script.py` | `external_id and source not in (pulse,button,form)` (denylist) | al **encolar** |
| **WellStreet** (Padel+Pickleball) | `core/sources/firestore_pulses.py` | `if external_id:` | al **encolar** |
| **Interpadel** | `core/listener_pending_pulses.py` | `job_id.startswith("fs_")` | al **FINAL del job** |

### Notas críticas
- El brief original asumía que los pulsos de Firestore se encolan con
  `source=="firestore"`. **Es falso**: cada club usa otro valor (`button`,
  `web_boton`, `web`…). Por eso el guard quedó distinto en cada NUC. El marcador
  universal real es **la presencia de `external_id`** (los jobs de Arduino/teclado/
  Forms no lo traen). **Deuda menor:** unificar los 3 guards a `if external_id:`
  cuando se estandarice el release.
- **Interpadel marca `consumed_at` al final del job** (después de subir y de
  escribir `resolved_video`), no al encolar. Implicación operativa: un pulso de IP
  en proceso se ve `consumed_at == null` ("sin consumir") aunque la terminal lo
  esté procesando — **es normal, no falla**. Para IP esto es favorable: cuando su
  notificación de "clip listo" se dispara (gated por `consumed_at`), el
  `resolved_video` ya existe → deep-link exacto garantizado.

---

## Implementación web (Nivel 1 — LIVE)

Commit `7a5f89062`. Todos los cambios degradan al método previo (±90s) si el
pulso aún no trae `resolved_video` (NUC vieja o clip aún sin estampar).

- **`guardados.html`** (`resolveBotonClips`): matchea el clip de botón por
  **nombre exacto** (`resolved_video`); fallback al join de ±90s. Match exacto →
  se persiste el clip correcto en `usuarios/{uid}/guardados`, sin ambigüedad ni
  dependencia del reloj.
- **`assets/notifications.js`** (`resolveLadoUrlFromPulse`): la notificación arma
  el deep-link con `&video=<resolved_video>` (exacto) en vez de `&pt=<consumed_at>`
  cuando el pulso lo trae. Mapea cancha dígito→id de config. También: `markOneRead`
  espera a que persista antes de navegar (no hay persistencia offline → antes se
  perdía el "leído" al navegar rápido).
- **`assets/script.js`** (`populateVideos`): `?video=` (exacto) tiene prioridad
  sobre `?pt=` (match por tiempo, ±90s). Aterriza en el clip, hace scroll y lo
  resalta (`pz-clip-highlight`).
- **Aparte (mismo commit):** fix de pantalla negra en previews — frame de portada
  vía `#t=0.2` en galería/card.js/mis-clips (ver el propio commit).

---

## Verificación (end-to-end, 11-jun ~16:48 UTC)

Pulso fresco a cada club → `resolved_video` confirmado en Firestore (service
account), las 3 arquitecturas:

| Club | `resolved_video` |
|---|---|
| Interpadel | `Interpadel_Cancha4_LadoA_11062026_104045.mp4` |
| WellStreet-Padel | `WellStreet-Padel_Cancha2_LadoA_11062026_104040.mp4` |
| BreakPoint | `BreakPoint_Cancha1_LadoA_11062026_103049.mp4` |

Consistencia: el timestamp del filename coincide con la hora local del pulso
menos el pre-roll. Terminal de IP confirmó la cadena:
`resolved_video escrito` → `consumed_at seteado`.

Pulsos **sin** `resolved_video` observados = todos **pre-deploy** (consumidos
antes de que el código entrara). Cero fallos post-deploy. Los viejos no se
rellenan retroactivamente (esperado: el campo se escribe al subir el clip).

---

## Pendiente: Nivel 2 (cierre 100% de durabilidad)

`resolved_video` es solo el **nombre**, NO la URL. La web aún resuelve la URL
desde `videos_recientes.json` (rolling, caduca). Si el usuario nunca abre la web
dentro de esa ventana, la URL no se captura → el clip se pierde de "Mis clips".

**Fix bulletproof:** que el **indexador** (`gestion_indice_ci.py`, GitHub Action,
que conoce nombre + URL de cada clip) escriba el doc `usuarios/{uid}/guardados`
(o un `resolved_url` en el pulso) en Firestore al indexar, cruzando por
`resolved_video`. Server-side, sin interacción del usuario, justo al publicarse.
Requiere que el CI escriba a Firestore con service account. Sería un brief de
worker del **CI**, no de las NUCs.
