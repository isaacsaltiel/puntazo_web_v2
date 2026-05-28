# Dictado 2026-05-29 — Compartir, Vincular, Validar (flujo crítico de ranking)

> **Estado**: bug crítico del dictado anterior (`collectionGroup claims`) ya
> resuelto en F96-F101. El usuario probó el link compartido con sus dos
> hermanos y detectó **el flujo de compartir/vincular/validar no jala
> end-to-end**. Este doc es el plan PRIORITIZADO para arreglarlo.
>
> Sin este flujo trabajando, el ranking es ficción.

---

## 🎯 Decisión arquitectónica de fondo

El "link de partido compartido" es la pieza viral más importante. Si
falla en Android, si el login no devuelve al partido, o si el usuario
no encuentra dónde decir "Ese soy yo", **el ranking nunca va a tener
data validada y todo lo demás se cae**.

Prioridad absoluta: el flujo abrir-link → vincular → aceptar marcador
debe ser un **camino feliz a prueba de balas**.

---

## 📊 Diagnóstico del dictado (11 issues + 1 prioridad)

### Issue 1 — Link no abre en Android (CRÍTICO)
- Uno de los hermanos con Android no pudo abrir el link.
- **Posibles causas**: dominio no autorizado en Firebase Auth para móvil,
  rutas relativas (`/detalle.html`) que dependen del origin, errores
  de CORS, errores de Firestore por reglas, o redirect raíz incorrecto.
- **A revisar**:
  - DNS / HTTPS válido en `puntazoclips.com` (curl test).
  - Test del link real en Android (Chrome / WhatsApp embedded browser).
  - `firebase.initializeApp` falla silencioso en navegadores móviles → no carga match.
  - El `?join=1` ENCODE bien por WhatsApp (¿corta el `&`?).
  - El user agent de WhatsApp embedded redirige raro.

### Issue 2 — No aparece "Ese soy yo" en detalle (CRÍTICO)
- El segundo hermano sí abrió la página pero NO vio el overlay
  "¿Quién eres?".
- **Causa probable**: el overlay solo se muestra si vienes con
  `?join=1`. Sin ese flag, detalle.html muestra solo la vista normal.
  El usuario abre el link, pero el `?join=1` se PIERDE en algún punto
  (WhatsApp, redirect, etc).
- **Fix**: mostrar el flow de "Ese soy yo" **siempre** que el user no
  esté vinculado al match (no depender de query param). El query param
  solo cambiaría el énfasis visual, no la disponibilidad.

### Issue 3 — Solo jugadores disponibles
- Cuando alguien abre para vincularse, solo mostrar los slots SIN uid.
- Ya implementado en F98 pero no se está disparando porque el overlay
  no aparece (Issue 2).
- Si todos los slots están vinculados → mensaje "Este partido ya tiene
  todos los jugadores vinculados".

### Issue 4 — Aceptación del marcador
- Tras vincularse, mostrar review del marcador + 2 botones:
  - **Aceptar marcador**
  - **Sugerir corrección** (Item 6 del dictado anterior, parcial en F95)

### Issue 5 — Validación visible para ranking
- Estados claros en detalle.html y mi-nivel.html:
  - "Pendiente de validación del equipo rival."
  - "Invita a un rival para que este partido cuente en ranking."
  - "Marcador validado. Este partido ya cuenta para ranking."
- En F99 se hizo en mi-nivel. Falta en detalle.

### Issue 6 — Normalización de apodos
- Pendiente futuro. Helper `normalizeAlias(s)` (lowercase, trim, sin
  acentos, sin puntos) para evitar duplicados al hacer claim cruzado.
- No urgente.

### Issue 7 — Partido activo persistente
- Si tienes un match con `status="active"`, debe aparecer banner en
  el header (y en perfil) "Tienes un partido activo → Volver al partido".
- Query: `matches.where(userId == myUid).where(status == 'active').limit(1)`.

### Issue 8 — No permitir 2 partidos activos
- Al intentar crear nuevo match, si ya tienes uno active → bloquear con
  mensaje + opciones "Volver al partido activo" / "Terminar partido activo".
- Lugar lógico: en `PuntazoMatches.create()` o en entrada.html antes
  de redirigir a mi-partido.html?nueva=1.

### Issue 9 — Mi nivel: textos limpios, no debug
- Revisar `mi-nivel.html` para sacar cualquier copy técnico.
- El bloque "Disclaimer 🧪 versión preview" tiene jerga.
- Cambiar "Calibrando" → "Todavía no tienes suficientes partidos
  validados para calcular tu nivel."

### Issue 10 — Mis últimos partidos en Mi nivel
- Sección vacía cuando no hay partidos válidos.
- Mostrar mensaje contextual: "Tus partidos aparecerán aquí cuando
  estén validados por al menos un rival."

### Issue 11 — Flujo end-to-end review
- Revisar manualmente todo el flujo descrito por el usuario:
  1. A termina partido.
  2. A comparte link.
  3. B abre link en Android/iPhone.
  4. B ve partido.
  5. B login si hace falta (debe regresar al partido).
  6. B "Ese soy yo".
  7. B aceptar marcador.
  8. Estado cambia.
  9. Ranking se actualiza.

---

## 🔧 Plan de ejecución (en orden de impacto)

### F102 (este commit) — Imágenes de canchas ✅
- B1..B8 reemplazados con los nuevos.
- B-extern.png reservado para canchas fuera de Puntazo.
- Sin cambios de código (los HTML ya referencian B{n}.png).

### F103 — Issue 1 + 2: link robusto + "Ese soy yo" SIEMPRE visible
- En detalle.html, sin importar el query param `?join=1`:
  - Si el user NO está vinculado al match → mostrar overlay/sección
    "¿Eres uno de los jugadores?" con los slots disponibles.
  - Si SÍ está vinculado → vista normal.
- Revisar que el link sea fully-qualified (`https://puntazoclips.com/...`).
- Test manual en Android (yo no puedo, le pediré a Isaac).
- Si Firebase Auth da error en Android (popup blocked), fallback a
  redirect (`signInWithRedirect` en lugar de `signInWithPopup`).

### F104 — Issue 5: estados de validación visibles en detalle
- Bloque "Estado del partido para ranking" arriba del scoreboard:
  - 🟡 Pendiente: "Falta que un jugador del equipo rival se vincule."
  - 🟢 Validado: "Marcador aceptado por ambos equipos. Cuenta para ranking."
  - 🔵 Esperando otro rival: "1 rival ya aceptó. Falta el otro equipo."

### F105 — Issue 7+8: partido activo persistente
- Helper `PuntazoMatches.getActiveForUser(uid)` (ya existe en matches.js).
- Header banner global: si hay active → "🔴 Tienes un partido en curso → Volver".
- En entrada.html: bloquear crear nuevo si ya hay active.

### F106 — Issue 4 + 6: aceptar/sugerir corrección + apodos
- Botón "Sugerir corrección" en detalle.html (abre form con marcador
  editable + envía como sugerencia).
- normalizeAlias() en matches.js (low priority).

### F107 — Issue 9 + 10: cleanup textos mi-nivel
- Sweep de copy en mi-nivel.html.
- Reemplazar disclaimer técnico por mensaje user-friendly.
- "Mis últimos partidos" con mensaje contextual cuando está vacío.

---

## 🚫 Lo que NO se hace ahora (descartado del scope)

- Heartbeat NUCs (items 15-18 del dictado anterior).
- Herramientas dev (item 19).
- Reset/cleanup de datos prueba.
- Auto-discover de grupos.
- Notificaciones push.
- Privacy controls finos.

---

## 📌 Pendientes externos para Isaac

1. **Test del link compartido en Android real** (un hermano).
2. **Verificar dominios autorizados en Firebase Auth Console** (en
   Authentication → Settings → Authorized domains, debe estar
   `puntazoclips.com` Y `puntazoclips.github.io` si todavía aplica).
3. Reportar cualquier error específico que vea en Android (consola
   remota o screenshot).

---

## 🧭 Orden de prioridad final (del dictado item 12)

1. ✅ Link abre en Android — F103
2. ✅ "Ese soy yo" siempre visible — F103
3. ✅ Login no rompe regreso al partido — F103 (usar redirect)
4. ✅ Vincular jugadores pendientes — F103 (ya está, falta exposición)
5. ✅ Aceptar marcador — F104
6. ✅ Estado de ranking claro — F104
7. ✅ Recuperar partido activo — F105
8. ✅ No 2 partidos activos — F105
9. ✅ Textos mi-nivel limpios — F107
