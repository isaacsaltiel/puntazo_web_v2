# Streaming en vivo a YouTube — activación (lado maestro/web)

Contraparte del handoff del NUC (`docs/STREAMING.md` + `HANDOFF_CLAUDE_MAESTRO.md`
en el repo del NUC). Este documento es **solo el lado web/Firestore + la guía OAuth**.

> Decisiones tomadas con Isaac (2026-06-15):
> - **Privacidad YouTube: `public`** → `streaming.youtube_api.privacy = "public"` en el `config.json` del NUC.
> - **Nivel B** (un broadcast con título por partido). Ya implementado en el NUC.
> - Todo está **staged, sin desplegar**. Esta guía son los pasos para activarlo.

---

## Qué ya quedó listo (sin desplegar)

| Pieza | Archivo | Estado |
|---|---|---|
| Reglas Firestore `stream_commands` | `firestore.rules` (bloque nuevo antes del catch-all) | editado, **sin deploy** |
| Panel admin "📡 Streaming" | `admin.html` (tab nuevo + JS) | editado, **sin push** |
| Script para el flag admin | `tools/grant_admin.py` | listo |
| Esta guía | `docs/streaming-youtube-activation.md` | — |

### Contrato Firestore (lo que respeta el panel)
Colección **`stream_commands`**, **un doc por cancha**, id = `<Club>_<CanchaId>`
(p.ej. `Interpadel_Cancha6`). El panel escribe SOLO: `club`, `cancha` (= `CanchaId`,
p.ej. `"Cancha6"`), `action` (`START`|`STOP`), `titulo`, `requested_at`, `requested_by`.
El NUC escribe el resto (`status`, `youtube_url`, `started_at`, `last_error`, `updated_*`…)
y el panel los lee en realtime. Coincide con el contrato del handoff.

### Seguridad
- El panel admin se ve solo si tu email está en `ADMIN_EMAILS` (allowlist en
  `assets/firebase-core.js`) — eso ya lo cumples.
- Pero las **reglas** no pueden leer esa allowlist (es client-side). Por eso la
  escritura a `stream_commands` se cierra con `flags.isAdmin == true` en tu doc
  `users/{uid}` (flag SERVER-ONLY). Hay que sembrarlo una vez (paso 1).

---

## Pasos de activación (web/Firestore — los míos)

### 1. Sembrar `flags.isAdmin` en tu cuenta
```
cd C:\Users\Isaac\Desktop\puntazo_web_v2
py tools\grant_admin.py isaacsaltiel@gmail.com
```
Debe imprimir `flags.isAdmin = True`. (Usa el SA de `~/.puntazo-secrets`.)

### 2. Desplegar las reglas de Firestore
Con Firebase CLI:
```
firebase deploy --only firestore:rules --project puntazo-clips
```
(o pegar `firestore.rules` en la consola Firebase → Firestore → Reglas → Publicar).
El bloque nuevo es **aditivo**: no toca ninguna colección existente.

### 3. Publicar el panel
```
git add admin.html firestore.rules tools/grant_admin.py docs/streaming-youtube-activation.md
git commit -m "Streaming: panel admin + reglas stream_commands (handoff NUC Interpadel)"
git push origin master
```
Entra a `puntazoclips.com/admin.html` → pestaña **📡 Streaming**. Verás las canchas
de `config_locations.json` con su estado en vivo (al principio "○ Offline" hasta que
el NUC reaccione).

---

## Pasos de credenciales YouTube — Nivel B (los tuyos, Isaac; yo te guío)

El Service Account de Firestore **NO sirve** para YouTube (un SA no puede ser dueño
de un canal). YouTube necesita **OAuth de usuario** de la cuenta DUEÑA del canal de Puntazo.

### A. Google Cloud Console (proyecto `puntazo-clips`)
1. Abre <https://console.cloud.google.com/> con la cuenta **dueña del canal de YouTube**.
2. Selecciona el proyecto **puntazo-clips** (arriba).
3. **APIs y servicios → Biblioteca** → busca **"YouTube Data API v3"** → **Habilitar**.
4. **APIs y servicios → Pantalla de consentimiento de OAuth**:
   - Si te pide configurarla: tipo **Externo**, nombre de app "Puntazo Streaming",
     tu correo de soporte, y guarda.
   - En **Usuarios de prueba** agrega el email dueño del canal (así el token no expira
     por estado "testing" tan seguido; o publica la app si prefieres).
5. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo de aplicación: **App de escritorio** (Desktop app).
   - Nómbrala "Puntazo NUC" → Crear → **Descargar JSON** → renómbralo `client_secret.json`.

### B. Generar el token (una sola vez, en una PC con navegador)
En tu PC, dentro del proyecto del NUC (o donde esté `core/youtube_authorize.py`):
```
pip install google-api-python-client google-auth-oauthlib google-auth-httplib2
python -m core.youtube_authorize client_secret.json youtube_token.json
```
Se abre el navegador → inicia sesión con la cuenta DUEÑA del canal → autoriza.
Genera `youtube_token.json`.

### C. Llevar el token al NUC
- Copia `youtube_token.json` a la raíz del proyecto del NUC (o a la ruta de
  `streaming.youtube_api.token_file`).
- En el `config.json` del NUC, dentro de `streaming.youtube_api`:
  - `enabled: true`
  - `privacy: "public"`  ← decisión tomada
  - `token_file: "youtube_token.json"`

Sin este token igual transmite (**Nivel A**: a la stream key, sin título por partido
ni `youtube_url` automático). Con token = **Nivel B** (lo que queremos).

---

## Pasos del NUC (los tuyos, Isaac — recordatorio del handoff)
1. Crear las transmisiones en **YouTube Studio**, una por cancha, con stream key
   **persistente/reutilizable** (NO reusar una key en dos canchas).
2. Pegar las keys en `stream_keys.json` del NUC (cancha → key). No subir a repos.
3. `streaming.enabled = true` en el `config.json` del NUC y reiniciar.

---

## Verificación E2E (después de activar)
1. En el panel, escribe un título en una cancha y pulsa **▶ START**.
2. El badge debe pasar `○ Offline → ⏳ Iniciando → 🔴 EN VIVO` en segundos.
3. Aparece el botón **▶ Ver en vivo** con el `youtube_url` de esa cancha.
4. **⏹ STOP** → vuelve a Offline.
5. Si algo falla, el panel muestra `last_error` del NUC (p.ej. `sin_stream_key`).

> ⚠️ Upstream del club es el límite real (~2.5 Mbps/cancha). Transmite solo canchas
> activas / por torneo, no las 6 a la vez 24/7, hasta medir el upload real.
