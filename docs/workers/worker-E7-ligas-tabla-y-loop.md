# Worker #12 — ETAPA E7: LIGAS · tabla (standings) + EL LOOP + hardening del modelo

## Título de etapa
E7 — Darle CORAZÓN a las ligas: (Fase 0) endurecer el modelo de E6 que la auditoría detectó frágil;
(Fase 1) la **tabla de posiciones** record-based multi-período; (Fase 2) **EL LOOP** — lo que hace volver:
notificación de movimiento tras cada partido + resumen + campeón como evento. Toca **cliente + backend
(functions) + reglas**; el backend se prueba en emulador y lo **despliega el maestro**.

> Lee primero: `docs/plans/diseno-ligas-2026-06-08.md` (diseño + decisiones LOCKED §12) y
> `docs/plans/auditoria-implementaciones-2026-06-08.md` (§2 (4) LIGAS — los hallazgos que originan esta etapa).
> E6 (estructura+miembros) ya está en master. Esta etapa construye encima.

## Decisiones LOCKED (no las re-litigues)
1 liga por partido (reusar `groupId` singular del match). Tagging server-side al confirmar (≥3 de 4 miembros).
Visibilidad solo-miembros. Parejas las define el creador. Auto-amistad al unirse. Record-based 3/0, sin empates.

---

## FASE 0 — Hardening de E6 (PRE-requisito; la auditoría lo marca como bloqueante de E7)

### 0.1 `memberUids` (array espejo) — **bloquea el heurístico ≥3**
Hoy NO existe; el server tendría que hacer 4 `get()` por partido sin índice inverso. Añádelo:
- `groups.js#createGroup`: incluir `memberUids: [u.uid]` en el doc.
- `joinGroup`/`addMember`: `memberUids: arrayUnion(uid)` **en la misma operación** que el member doc (no best-effort aparte).
- `leaveGroup`/`kickMember`: `arrayRemove(uid)`.
- Mantén `memberCount` pero deja de confiar en él para lógica (deríva conteo de `memberUids.length` o `members`).
- **Backfill**: script (pídeselo al maestro para correr con Admin SDK) que rellene `memberUids` en las ligas/grupos existentes desde la subcolección `members`.
- Reglas: el self-join debe permitir agregar **exactamente tu uid** a `memberUids` (invariante de conjunto, mismo
  patrón blindado que el claim: `request.resource.data.memberUids` difiere de `resource.data.memberUids` en solo
  `request.auth.uid`). Pruébalo en emulador.

### 0.2 Reglas: `mode` y `type` INMUTABLES (hoy solo cliente)
En `firestore.rules`, en el `update` de `groups/{groupId}` para docs con `league`: exigir
`request.resource.data.league.mode == resource.data.league.mode` **y** `request.resource.data.type == resource.data.type`.
Sin esto, cualquier admin corrompe la historia de standings. Emulador: admin NO puede cambiar mode/type; sí otros campos.

### 0.3 Parejas con uids reales (hoy `uids:[]` vacío → modo pairs no-funcional)
Las parejas necesitan los uids de los 2 jugadores para que E7 cuente "pareja vs pareja". Como al **crear** la liga
aún no hay miembros, **mueve la definición de parejas a `liga.html`** (admin, una vez que los miembros se unieron):
UI "Definir parejas" → por cada pareja, buscador/selector de 2 miembros reales → `updateLeagueConfig(groupId,
{pairs:[{pairId, uids:[a,b], name}]})`. En `ligas.html` (crear), si `mode==="pairs"`, NO pidas nombres sueltos:
explica "Define las parejas dentro de la liga cuando se unan los jugadores". Mantén `mode` fijo al crear.

### 0.4 `liga.html` robusto ante liga sin `league`
Si llega un grupo `type:"liga"` sin bloque `league` (legacy), mostrar aviso "Esta liga necesita configuración"
(o, si eres admin, un botón para inicializarla) en vez de pintar "👤 Individual" por defecto (`liga.html:263`).

> Fase 0 cierra los huecos 🔴 de la auditoría. Pruébalo en emulador (suite `leagues-rules.js` extendida) antes de Fase 1.

---

## FASE 1 — La tabla (standings) record-based

### 1.1 Tagging server-side (functions) — un partido cuenta para UNA liga
Extiende `onMatchConfirmed` (o un trigger hermano) en `functions/index.js`: al pasar a `confirmed`, calcular si el
partido pertenece a una liga y escribir su `groupId` de liga (decisión LOCKED #1/#2):
- Tomar los uids reales de `jugadores[]`. Para cada liga candidata (las que comparten ≥3 de esos 4 jugadores en su
  `memberUids`), asignar. Si el registrante pre-eligió liga (`match.groupId` ya puesto por el cliente), validar que
  cumpla ≥3 y respetarla; si no, resolver la liga donde coinciden ≥3.
- **Modo pairs**: cuenta solo si ambos equipos son parejas registradas (`league.pairs[].uids`).
- Escribe el resultado en el match (reusa `groupId` singular; NO inventes `leagueIds`). Idempotente.
- Server-only (Admin SDK) → cero superficie de reglas.

### 1.2 `computeStandings()` — helper PURO, export dual (browser + Node), TESTEABLE
Como el motor de ranking. Entrada: lista de partidos `confirmed` de la liga + opts (período, mode, pairs). Salida:
filas ordenadas. Por unidad (jugador o pareja): **PJ, G, P, Pts (G·pointsWin+P·pointsLoss), % (G/PJ), ±sets, ±games**.
**Desempate en cascada (estilo Torneo-5):** Pts → dif. sets → dif. games → head-to-head → % → nombre.
**Multi-período:** filtrar por rango de fecha (semana lun–dom / mes / año / temporada). 14+ asserts en Node.

### 1.3 `liga.html` — la tabla es la ÚNICA estrella
- Tabla con tabs **Semana · Mes · Año · Temporada** (default: Temporada activa). Columnas PJ G P Pts % ±Sets ±Games.
  Fila propia resaltada. Reusa el estilo de `clasificacion.html`.
- **% como vista de primer nivel** (la auditoría: record-based puro premia volumen; ofrece "Por puntos / Por %" o
  exige mínimo de partidos para rankear). Decide y documenta.
- "**Últimos enfrentamientos**": feed de los N partidos recientes que contaron (marcador + ganador + fecha; reusa
  `summarizeScore` de confirmar.html).
- **NO** muestres el nivel Glicko del grupo aquí (la auditoría: confunde). El Glicko vive en perfil; la liga = tabla.
- Compartir debe llevar **la tabla/posición** ("Voy #1 en la Liga de los Jueves 🏆 ¿te atreves?"), no un link vacío.

---

## FASE 2 — EL LOOP (lo que hace volver — el norte de la etapa, no un extra)
> Hallazgo unánime de mercado: una tabla pasiva nadie la revisa. El gancho es **ritmo + movimiento notificado + rival nombrado**.

### 2.1 Notificación de movimiento (reusa EN2)
Tras escribir el partido contado (1.1), el server recomputa la posición de cada miembro afectado y dispara una
notif EN2 nueva: tipo `league_rank` → *"Ganaste 3 pts. Subiste al #2 de la Liga de los Jueves, a 1 victoria del
líder [nombre]."* (rivalidad concreta: nombra al rival inmediato). Reusa el patrón `ensureNotif` + un builder en
`notify.js`. Idempotente por `notifId`.

### 2.2 Resumen semanal automático (`onSchedule`, domingo PM)
A cada miembro activo: líder, su racha, su movimiento de la semana, próximo rival a alcanzar. Un solo trigger
programado que itera ligas activas. Cuida el costo (solo ligas con actividad en la semana).

### 2.3 Cierre de temporada = EVENTO social
`closeSeason(groupId)` (admin): congela la tabla, corona al #1 (`championRef`), notifica a **TODOS** los miembros
(`season_champion`: *"🏆 [Ana] ganó la Temporada 2026 de la Liga de los Jueves"*), genera una **tarjeta de campeón
compartible** (idealmente animada con la skill `puntazo-logo-animation`), y **arranca automáticamente la siguiente
temporada** (para que el loop no se rompa). Reglas: proteger `closed`/`championRef` (idealmente server-side).

---

## FUERA de alcance
- App nativa / push FCM (va aparte, ver auditoría notificaciones). E7 usa EN2 in-app.
- Standings materializados server-side (v2; E7 computa en cliente con `computeStandings`, decisión LOCKED §9).
- Descubrir ligas públicas, ascensos/descensos, divisiones (E8).

## Validaciones (tests REALES)
- `node --check` de todo lo tocado. **`computeStandings` con 14+ asserts** (individual/pairs, períodos, desempates
  en cascada, head-to-head, mínimo de partidos). Lógica de tagging ≥3 en Node (pura).
- **Emulador**: `leagues-rules.js` extendida (memberUids self-join invariante; mode/type inmutables; seasons
  closed/championRef). Tagging server-side: test de integración (≥3 miembros → groupId asignado; <3 → no).
- Smoke sembrado (pídeselo al maestro): liga con 4 miembros → registrar+confirmar partido → cuenta → tabla se
  actualiza → llega notif "subiste al #N". Modo pairs con uids → cuenta pareja vs pareja. Cierre de temporada → campeón + notif a todos.
- Cero mojibake. JS ajeno sin commitear → NO incluir.

## Definition of Done
- Fase 0 (memberUids + reglas mode/type + parejas con uids + liga.html robusto) probada en emulador.
- Tabla multi-período + `computeStandings` puro testeado + "últimos enfrentamientos" en `liga.html`.
- Tagging server-side (≥3) + el LOOP (notif de movimiento + resumen semanal + cierre/campeón).
- Backend probado en emulador; el maestro revisa y despliega functions+reglas. Commit quirúrgico + push.

## Formato del reporte (OBLIGATORIO)
```
## REPORTE ETAPA E7
### Resumen ejecutivo
### Archivos modificados
### Decisiones técnicas (con justificación)
### Bugs encontrados
### Riesgos detectados
### Qué quedó pendiente
### Validaciones (tests reales)
### Backend: qué cambió y qué falta desplegar (para el maestro)
### Resultado (qué quedó funcionando)
### Recomendación al arquitecto maestro
```
