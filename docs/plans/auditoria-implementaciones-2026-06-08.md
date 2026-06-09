# AUDITORÍA MAESTRA — implementaciones recientes (8-jun-2026, noche)

> 12 auditorías independientes (4 implementaciones × 3 lentes: **UX**, **Mercado**, **Integración**),
> ejecutadas por agentes especializados en paralelo, sintetizadas por el chat maestro. Cada hallazgo
> lleva severidad (🔴 ALTA / 🟡 MEDIA / ⚪ BAJA) y archivo:línea. Las recomendaciones de crecimiento
> citan comparables reales (Playtomic, Strava, Splitwise, MileSplit, Duolingo).
>
> Implementaciones auditadas: **(1) Reclamar partidos (claiming)**, **(2) Invitados + fusión**,
> **(3) Campana de notificaciones**, **(4) Ligas E6**.

---

## 0. EL HALLAZGO RAÍZ (cruza 4 auditorías) — el "nivel duplicado" de Isaac
🔴 **Dos pipelines de ranking coexisten.** `mi-nivel.html` recalcula en cliente (`status==="ended"`);
`perfil.html` lee el servidor (`ratings/{uid}`, alimentado solo por `status==="confirmed"`). En prod hay
**0 partidos `confirmed`** → los dos números divergen. Es exactamente lo que reportó Isaac.
→ **Decisión + plan completo:** [decision-unificacion-nivel-2026-06-08.md](decision-unificacion-nivel-2026-06-08.md).
→ **Parte 1 (display unificado, server-authoritative) YA implementada** (commit 277b95c7). **Parte 2 (alimentar
el servidor + recompute) staged, requiere OK de Isaac** (toca ranking en prod).

---

## 1. TEMAS TRANSVERSALES (aparecen en varias implementaciones) — máxima prioridad

### 🔴 T1. El "loop de crecimiento" no existe: claim e invitados son SUMIDEROS, no FUENTES
*(claiming-mercado, invitados-mercado)* Cada partido tiene típicamente 3 slots dummy = 3 invitaciones
desperdiciadas. El claim trae 1 usuario por casualidad (alguien manda el link) y termina; la auto-amistad es
invisible; `claimedByUid` está modelado pero muerto (el dueño nunca sabe que su invitado se volvió usuario).
**Comparables:** MileSplit "Claim Your Profile" (pre-crea el perfil y caza al atleta), Strava "invite to activity"
(la actividad ya te pertenece = anzuelo), Splitwise (merge invite→cuenta + notifica).
**Jugada #1 (la más valiosa de todas las auditorías):** botón **"Invitar a [nombre] por WhatsApp"** con
link de claim pre-cargado *("Te registré 3 partidos en Puntazo con tus clips y tu nivel, reclámalos 👉 link")*,
en `amigos.html#invitados` y tras registrar un partido. Cierra con `claimedByUid` + notif al dueño. Convierte
cada partido en **k>1**. Reutiliza infra existente (claim, links, sugerencia retro E4) — es UI + deep-link.

### 🔴 T2. Diálogos nativos (`prompt`/`confirm`/`alert`) rompen el sistema de diseño
*(claiming-UX, invitados-UX)* `confirmar.html:522,554` (declinar/disputar), `amigos.html:302,307,334`
(renombrar/borrar/fusionar invitado), `mi-nivel.html:503,507`. En una app dark/Montserrat mobile-first, el
diálogo del navegador es feo, inconsistente y hostil en iOS. La disputa además es un momento delicado.
**Fix:** bottom-sheets/modales in-page reutilizando los estilos existentes (`.cf-*`, pills).

### 🔴 T3. La recompensa es contable, no emocional; falta el cierre del loop
*(claiming-mercado, notif-mercado)* "Cuenta para el ranking" / "Tu nivel ahora: 3.5" es el *mecanismo*, no la
*recompensa*. Falta: delta con estatus ("+0.18, subes a Intermedio, por encima de [rival]"), y la notificación
**"tu rival confirmó tu partido"** (hoy abres el loop "confirma" y nunca lo cierras). **Comparable:** Strava
kudos, Playtomic level-as-identity, Duolingo status signals. `match_confirmed` al registrante es casi gratis
(el trigger `onMatchNotify` ya existe).

### 🟡 T4. "Marcar leído al abrir" y falta de estado de novedad
*(notif-UX, notif-mercado, notif-integración)* La campana marca TODO leído al abrir (`notifications.js:270`),
el panel no distingue leído/no-leído, no muestra tiempo relativo (`createdAt` existe, no se renderiza), y no
registra CTR por-ítem (no sabes qué notificación funciona). **Fix:** separar *seen* (baja badge) de *read*
(por-ítem al click), clase `.is-unread`, tiempo relativo, `clickedAt`.

---

## 2. POR IMPLEMENTACIÓN

### (1) RECLAMAR PARTIDOS — veredicto: **aceptable con reservas**, con 1 agujero de correctness
- 🔴 **Disputar tras confirmar NO revierte el ranking** *(integración)*. `match-confirmation.js:130-151` permite
  disputar un `confirmed`, pero `functions/index.js:125-143` solo tiene handler `becameConfirmed`, no
  `becameDisputed`. La UI promete "no cuenta hasta resolverse" — **mentira farmeable**. **Fix mínimo:** quitar
  `CONFIRMED` de `canDispute` (solo disputar en `pending`). **Fix completo:** handler `becameDisputed` +
  recompute acotado (Glicko-2 no permite "restar" un match; obliga a reprocesar).
- 🔴 **El claim no verifica QUÉ slot recibió el uid** *(integración)*. Las reglas solo checan el delta de
  `playerUids` (`firestore.rules:105-148`); dos cuentas cómplices pueden farmear un partido entre ellas. Deuda
  estructural aceptada pero subdimensionada; la única defensa (disputa) además no revierte (ver arriba).
- 🔴 **Pared de login sin contexto** *(UX)*. `confirmar.html:270-274`: se pide login antes de mostrar el valor.
  Para un link de WhatsApp es la mayor fuga del embudo. **Fix:** mostrar marcador + "Aparece *Nombre* sin
  cuenta, ¿eres tú?" ANTES del login (la data ya está cargada).
- 🔴 **Falta auto-confirmación** *(mercado)*. El partido del registrante queda rehén de que un rival se
  registre; si nadie reclama, nunca cuenta y caduca a 7 días. **Playtomic auto-confirma a las 24h.**
- 🟡 Identificación frágil por nombre de Google (`bestDummyMatch`), `claims/{uid}` subcolección abierta a
  spoofing de UI (`firestore.rules:172-188`), pending vencido confirmable en la ventana del scheduler,
  `confirmedAt` vs `confirmedAtMs` (campo muerto). Sugerencia retroactiva E4 = la mejor pieza, pero enterrada.

### (2) INVITADOS + FUSIÓN — veredicto: **sólido (mecánica), UX de panel-admin**
- 🔴 **`ensureGuest` no es idempotente** *(integración)*. `guests.js:151-173` hace `where+get` luego `set()` sin
  transacción → dos registros simultáneos del mismo nombre crean guests duplicados imposibles de fusionar.
  **Fix #1 (mayor ROI):** doc id determinista derivado de `searchName` + `set({merge:true})`.
- 🔴 **Función invisible** *(UX)*. Nadie llega a `amigos.html#invitados` (enterrado al fondo); "fusionar" no
  comunica nada a un novato; sin línea de ayuda. **Fix:** texto guía permanente + toast post-registro con link.
- 🔴 **Riesgo de fusionar al equivocado, sin deshacer** *(UX)*. El `<select>` solo muestra nombres (dos "Gabo"
  reales son indistinguibles), `confirm()` nativo, y NO hay `unmerge`. **Fix:** mostrar dato discriminante
  ("usado hace 2d · 3 partidos"), advertir irreversibilidad, idealmente `unmergeGuest`.
- 🟡 Punteros `mergedInto`: cadenas largas / lote de 200 sin orderBy rompen `aliasGuestIds` silenciosamente
  (`guests.js:237`); `deleteGuest`/`renameGuest` ignoran `mergedInto` (punteros colgantes); dedup case-fold
  colapsa dos "Carlos" distintos (under-merge, el riesgo real). La degradación de privacidad del claimer es
  **correcta** (no lee guests ajenos — verificado no-bug).
- 🟡 **Mercado:** el modelo "nombres reclamables" es el punto óptimo (entre Americano-apps y Playtomic), pero la
  fusión es ingeniería del problema #2 antes que el #1 (conversión). No invertir más en fusión; sí en el loop.

### (3) CAMPANA DE NOTIFICACIONES — veredicto: **infra sólida, retención floja sin push**
- 🔴 **`ensureNotif` get-then-set NO atómico** *(integración)*. `functions/index.js:243-253`: dos triggers
  concurrentes pueden duplicar/resucitar un notif leído. **Fix:** `ref.create()` (atómico, captura
  ALREADY_EXISTS code 6, 1 op vs 2). *(Código listo, requiere deploy de functions.)*
- 🔴 **Solo notifica a quien ya volvió** *(mercado)*. Sin push, la campana no recupera usuarios dormidos —
  justo donde se gana retención (benchmarks: push ≈ +190% retención a 90d). **Jugada:** FCM web push sobre
  `clip_ready` ("tu puntazo está listo" = máxima dopamina + viral) y `match_confirmed`, empezando por
  Android/desktop (iOS web push exige "añadir a inicio").
- 🔴 **Faltan las notifs del loop de pádel** *(mercado)*: "tu rival confirmó", "subiste en el ranking", "te
  retaron", "tu liga tiene partido". Las actuales son todas reactivas.
- 🟡 **Clip_ready huérfano** *(integración)*: `refId=pulseId` efímero → el notif muere cuando el pulso expira por
  TTL aunque el clip exista (colisiona con el pendiente de MEMORY "Mis clips durable"). Deep-link del clip va a
  perfil genérico (deuda conocida). Límite de 30 sin paginación (badge subcuenta). `markAllRead` sin batch.
- 🟡 **UX:** sin tiempo relativo, sin estado leído/no-leído, sin animación del badge, `scroll→cierra` molesto en
  mobile, tap target 38px (<44), error de red se ve igual que "todo al día". **Seguridad de reglas: verificada
  OK** (update solo `['read','readAt']` bajo tu propio uid, no falsificable).

### (4) LIGAS E6 — veredicto: **esqueleto sólido y bien reutilizado; faltan 4 piezas antes de E7**
- 🔴 **`memberUids` NO existe** *(integración #1, mercado)*. El diseño de E7 (heurístico ≥3 server-side) lo da por
  hecho, pero `groups.js` nunca lo escribe (solo subcolección `members` + `memberCount`). El trigger de E7 tendría
  que hacer 4 `get()` por partido SIN índice inverso. **Bloquea/encarece E7.** **Fix (E6.1):** añadir `memberUids`
  (array) al doc, mantenido atómicamente en create/join/leave/kick/addMember.
- 🔴 **Colisión liga-vs-grupo** *(UX #1)*. `grupos.html` ofrecía "🏆 Liga formal" → creaba `type:"liga"` SIN bloque
  `league` → liga rota sin tabla. Dos puertas a "crear liga", una rota. **✅ ARREGLADO esta noche** (quitada la
  opción + tipos renombrados a "Grupo de…", commit pendiente). `liga.html` aún debe avisar si llega una liga sin
  `league` en vez de mostrar "👤 Individual" por defecto (`liga.html:263`).
- 🔴 **`mode` inmutable es SOLO cliente** *(integración #2)*. `sanitizeLeagueConfigChanges` lo descarta, pero
  `firestore.rules:310-311` deja a cualquier admin hacer `update({"league.mode":...})` y corromper la historia de
  standings de E7. **Fix (E6.1, reglas):** exigir `league.mode` y `type` unchanged en el update de grupos-liga.
- 🔴 **Parejas con `uids:[]` vacío** *(integración, mercado, UX)*. `ligas.html` captura solo `name`; el modo
  "pairs" nace sin uids → **no-funcional para standings** (E7 necesita saber quién es cada pareja). **Fix:** armar
  parejas seleccionando miembros reales (buscador → 2 uids), no texto libre.
- 🔴 **La tabla sola NO retiene — falta el LOOP** *(mercado #1, el norte de E7)*. Standings pasivos no hacen volver;
  lo que engancha es **ritmo + notificación de movimiento + rival nombrado**. E7 debe entregar primero el bucle:
  tras cada partido contado → notif "Ganaste 3 pts, subiste al #2, a 1 victoria del líder [nombre]"; resumen
  semanal automático; cierre de temporada como EVENTO social (notif a todos + tarjeta de campeón animada con la
  skill `puntazo-logo-animation` + arranque automático de la siguiente temporada). **Comparables:** Playtomic
  Manager/Padelio (jornadas programadas), Ranked Padel (streaks/winrate), reconocimiento recurrente.
- 🟡 `memberCount` se desincroniza (increments best-effort sin transacción; carrera en `addMember` doble-cuenta);
  `createGroup` de liga no atómico (season en 2º paso → `activeSeasonId` colgante posible); self-join no checa
  `inviteCode` (cualquier signedIn con el groupId entra — más laxo que la decisión LOCKED "solo miembros");
  reglas de `seasons` no protegen `closed`/`championRef` (deuda para el cierre de temporada de E7).
- 🟡 **Mercado:** mostrar "tabla record-based" + "nivel Glicko del grupo" lado a lado confundirá; la tabla debe ser
  la ÚNICA estrella en `liga.html` (Glicko escondido en perfil). Record-based 3/0 puro premia VOLUMEN, no calidad
  → subir la columna **% (winrate)** a vista de primer nivel o exigir mínimo de partidos. Compartir debe llevar la
  TABLA ("Voy #1 🏆 ¿te atreves?"), no un link vacío — el standing es el contenido viral.
- ✅ **Retrocompat verificada:** la rama liga es puramente aditiva; grupos genéricos intactos. Auto-amistad al unir
  cumple la decisión LOCKED #5. El truco de crear la season en 2º paso (regla `get()` en batch) bien razonado.

---

## 3. PLAN DE ACCIÓN PRIORIZADO (qué hago / qué requiere Isaac)

**YA HECHO esta noche (seguro, client-only):**
- ✅ Unificación del nivel (Parte 1) — `mi-nivel` lee del servidor. Commit 277b95c7.

**STAGED — código listo + probado, requiere aprobar deploy (toca backend/datos):**
- Parte 2 del nivel: limpiar ranking semilla + recompute desde partidos reales.
- `ensureNotif` → `create()` atómico (functions).
- Disputa: quitar `CONFIRMED` de `canDispute` (mínimo) o handler `becameDisputed` (completo).

**E7 y siguientes (briefs de worker):**
- 🏆 **Loop de crecimiento (T1)** — "Invitar por WhatsApp" + `claimedByUid` + notif al dueño. *La de mayor ROI.*
- Notif `match_confirmed` (cierre del loop) + FCM web push (clip_ready, match_confirmed).
- Auto-confirmación a 24-48h (claiming).
- Sustituir diálogos nativos (T2) por bottom-sheets.
- Campana: seen vs read + tiempo relativo + unread visual (T4).
- `ensureGuest` idempotente (doc id determinista).

**Decisiones que necesito de Isaac:**
1. ¿Apruebas la **Parte 2** del nivel (limpiar + recompute)? (te dejo el listado de 16 "ended" clasificados).
2. ¿Priorizamos el **loop de crecimiento (WhatsApp claim)** como siguiente etapa grande, o seguimos con **E7
   (tabla de ligas)**? Mi recomendación: E7 cierra ligas (ya invertido), pero el loop de crecimiento es la
   palanca #1 de las 12 auditorías — quizá merece colarse antes.
