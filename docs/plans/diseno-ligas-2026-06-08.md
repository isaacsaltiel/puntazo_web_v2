# Diseño de LIGAS — Puntazo (planteamiento maestro, 8-jun-2026)

> Documento de arquitectura para E6/E7. Objetivo: ligas que se sientan como una competencia
> seria (tabla, récords, temporadas, campeón) **reutilizando** lo ya construido, sin greenfield.

---

## 0. El insight que lo cambia todo

**Una liga NO es un sistema nuevo. Es un GRUPO + una capa de standings.** Ya existe:

- **`assets/groups.js`** completo: `groups/{groupId}` + subcolección `members/{uid}` (con `role`),
  `type` que YA incluye `"liga"`, `inviteCode`, `settings`, e invite-link `/g/{groupId}?invite=`.
  API: createGroup, joinGroup, leaveGroup, listMyGroups (collectionGroup), kick/addAdmin, updateGroup.
- **Motor de ranking server-side** ya computa, por cada match con `groupId`, un contexto
  **`group:{groupId}:padel`** (Glicko) → `leaderboards/group:{groupId}:padel/entries`. O sea: cada
  grupo YA tiene un ranking Glicko automático.
- **`register(opts)`** ya acepta `opts.groupId` y lo escribe en el match.

⇒ **E6 ("estructura + miembros") está ~70% hecho** por groups.js. Lo nuevo de ligas es:
1. Config específica de liga sobre el grupo (modo, temporadas, ajustes de tabla).
2. La **capa de standings record-based** (tabla de fútbol, multi-período, desempates) — E7.
3. El **heurístico de conteo** (≥3 de 4 miembros) y el tagging de partidos.

Filosofía: **el mismo partido confirmado alimenta TODO** — Glicko global, Glicko local del club,
Glicko del grupo, y ahora la **tabla record-based de la liga**. Un solo registro, cuatro vistas.

---

## 1. Concepto

Una **liga** es un grupo persistente de jugadores que llevan su **tabla de posiciones** a lo largo
del tiempo, por **temporadas**. Ej.: "Liga de los jueves", "Torneo de la oficina". A diferencia del
nivel Puntazo (Glicko, 1.0–7.0, suave), la liga es **récord puro**: ganas → 3 puntos, sumas, subes.
Es el "marcador social" simple y adictivo que la gente entiende sin explicación.

**Decisiones LOCKED por Isaac** (memoria `project-social-platform-spec`):
- El creador elige **modo: individual** (cada quien rankeado solo) **o parejas fijas**.
- **Record-based** (NO Glicko): puntos de fútbol (victoria=3, derrota=0).
- Tablas **multi-período**: semana / mes / año, dentro de **temporadas**.
- **Desempate estilo Torneo-5**: puntos → sets → games → head-to-head.
- Columna de **%** (winrate). Sección **"últimos enfrentamientos"**.
- Un partido **cuenta** si **≥3 de los 4** jugadores son miembros.
- Alta de miembros por **buscador + link "únete"**. **Cómputo client-side v1**.

---

## 2. Modelo de datos

### 2.1 La liga (extiende el grupo)
`groups/{groupId}` con `type: "liga"` + un bloque `league`:
```
groups/{groupId} = {
  name, type:"liga", createdBy, createdAt, inviteCode,
  memberUids: [..],                 // espejo para queries/reglas/heurístico ≥3 (además de la subcol members)
  league: {
    mode: "individual" | "pairs",
    sport: "padel",
    pointsWin: 3, pointsLoss: 0,
    countThreshold: 3,              // ≥3 de 4
    activeSeasonId,
    pairs: [                        // SOLO si mode=="pairs": parejas fijas
      { pairId, uids:[a,b], name }  // name = "Ana & Beto"
    ]
  }
}
groups/{groupId}/members/{uid}   = { uid, role:"owner|admin|member", joinedAt }   // ya existe
groups/{groupId}/seasons/{seasonId} = { name, startMs, endMs, createdAt, closed:false, championRef? }
```
> `memberUids` (array en el doc) es nuevo: lo necesitamos para el heurístico ≥3 y para reglas/queries
> rápidas. Se mantiene sincronizado con la subcolección `members` (en join/leave/kick).

### 2.2 El partido (cómo se liga)
Hoy el match tiene `groupId` (singular). Para ligas proponemos **`leagueIds: [groupId, ...]`** (array)
en el match → un partido puede contar para varias ligas. Se escribe en `register()`/al confirmar
(ver §4). Standings query: `matches where leagueIds array-contains {groupId} and status=="confirmed"`.
(`groupId` singular se mantiene para el contexto Glicko del grupo; `leagueIds` es para standings.
Alternativa minimalista v1: reusar `groupId` singular y aceptar "1 liga por partido". Recomiendo el array.)

---

## 3. Cómo cuenta un partido (el heurístico ≥3)

**Regla:** un partido confirmado cuenta para una liga si **≥3 de sus 4 jugadores (uids reales) son
miembros** de esa liga (modo individual). En **parejas**, cuenta si **ambos equipos son parejas
registradas** de la liga (los 4 son miembros en sus parejas fijas).

**¿Quién hace el tagging (escribir `leagueIds`)?** Tres opciones:

| Opción | Cómo | Pro | Con |
|---|---|---|---|
| **A. Cliente al registrar** | `register()` mira las ligas del registrante; para cada una con ≥3 miembros presentes, agrega su id a `leagueIds` (o sugiere "¿contar para Liga X?") | simple, sin backend | solo ve las ligas del registrante; partidos viejos no se re-taggean |
| **B. Servidor al confirmar** | extender `onMatchConfirmed`: al pasar a confirmed, calcula `leagueIds` consultando las ligas de los 4 jugadores | robusto, conoce membresías reales, escala | toca backend (deploy) |
| **C. Híbrido** | cliente sugiere/pre-taggea, servidor reconcilia al confirmar | lo mejor de ambos | más complejo |

**Recomendación:** **B (servidor al confirmar)** para robustez y porque ya tenemos el trigger.
Pero **v1 puede arrancar con A** (cliente) para no tocar backend en E7, y migrar a B después.
Decisión de Isaac (ver §12).

**Partidos previos al ingreso de un miembro:** no estarán taggeados. v1: solo cuentan los partidos
posteriores (aceptable). Futuro: un backfill server-side (recompute de leagueIds) o el claim retroactivo
(E4) los puede incorporar.

---

## 4. Modos: individual vs parejas

- **Individual:** la unidad de la tabla es el **jugador**. Cada partido que cuenta suma a los 2-3-4
  miembros que jugaron, según su resultado. Compañeros distintos cada vez — solo importa tu W/L.
- **Parejas fijas:** la unidad es la **pareja** (`pairId`). El creador define las parejas al armar la
  liga (o se auto-detectan de los partidos). Solo cuentan partidos **pareja-registrada vs pareja-registrada**.
  La tabla lista parejas ("Ana & Beto"), no individuos.

El `mode` se fija al crear y NO cambia (cambiarlo invalidaría la historia). La UI de standings se
ramifica por `mode`.

---

## 5. Standings (la tabla) — record-based

Para cada **unidad** (jugador o pareja), sobre el conjunto de partidos que cuentan en el período:

| Col | Cálculo |
|---|---|
| **PJ** | partidos jugados |
| **G / P** | ganados / perdidos (sin empates: pádel siempre tiene ganador) |
| **Pts** | G·`pointsWin` + P·`pointsLoss` (3/0 por defecto) |
| **%** | G / PJ · 100 |
| **Sets** | sets a favor − en contra (diferencia) |
| **Games** | games a favor − en contra (diferencia) |

**Orden (desempate estilo Torneo-5, en cascada):**
1. **Pts** desc
2. **Dif. de sets** desc
3. **Dif. de games** desc
4. **Head-to-head** (entre los empatados: pts directos entre ellos)
5. (fallback) % desc, luego nombre

**Multi-período:** el MISMO cómputo filtrando los partidos por rango de fecha:
- **Semana** (lun–dom actual), **Mes** (mes actual), **Año**, y **Temporada** (rango de la season).
- UI: tabs "Semana · Mes · Año · Temporada". Por defecto: Temporada activa.

**"Últimos enfrentamientos":** feed de los N partidos más recientes que contaron, con marcador,
ganador y fecha (reusa el render de marcador de `confirmar.html` summarizeScore).

**Campeón:** al cerrar una temporada (`closed:true`), el #1 de la tabla de temporada queda como
`championRef`. Se muestra con 🏆 en el historial de temporadas.

---

## 6. Temporadas

- Una liga tiene `seasons/{seasonId}` = `{ name, startMs, endMs, closed, championRef }`.
- `activeSeasonId` apunta a la vigente. El creador/admin abre y cierra temporadas.
- Cerrar una temporada: congela su tabla (snapshot opcional para historia) y corona al #1.
- Las tablas semana/mes/año son **vistas** dentro de (o cruzando) la temporada activa.

---

## 7. Integración con cada sistema (el "su integración" que pidió Isaac)

| Sistema | Cómo se integra |
|---|---|
| **Matches** | un confirmed con `leagueIds` alimenta standings. El registro ya existe; solo se agrega el tagging (§3). |
| **Ranking Glicko** | INDEPENDIENTE pero COMPLEMENTARIO: el mismo match ya da `group:{groupId}:padel` (Glicko del grupo). La liga muestra **dos números**: la **tabla** (récord, lo nuevo) y, opcional, el **nivel Glicko del grupo** (ya existe). "Posición en la liga" vs "tu nivel aquí". |
| **Claiming / guests (E3/E4)** | un partido de liga pasa por el mismo flujo registrar→reclamar→confirmar. Si un invitado (guest) reclama su cuenta y es miembro, sus partidos cuentan retroactivamente (cuando el tagging sea server-side / via E4). El "≥3 miembros" usa uids reales (los guests no cuentan como miembros hasta reclamar). |
| **Notificaciones (EN2)** | nuevo tipo `league_invite` ("Te invitaron a la Liga X") + `league_match_counted` opcional ("Tu partido contó para la Liga X") + `season_champion` ("¡Ganaste la temporada!"). Se suman como nuevos triggers/payloads al sistema EN2 ya vivo (shape estable). |
| **Invite-links** | reusa `generateInviteLink(groupId, inviteCode)` → `/g/{groupId}?invite=`. La página de la liga maneja el `?invite=` → joinGroup. Mismo patrón que el claim-link. |
| **Friends** | al unirte a una liga, auto-amistad best-effort con los co-miembros (como el claim auto-friend). Opcional. |
| **Perfil** | en `perfil.html`/`jugador.html`: sección "Mis ligas" con la posición actual en cada una. |
| **Búsqueda** | alta de miembros reusa `identity.searchUsers` (ya existe) + el invite-link. |

---

## 8. Reglas / seguridad (Firestore)

- `groups/{id}` y `groups/{id}/members/{uid}`: ya tienen reglas (reusar/extender). Añadir:
  - **memberUids**: solo el dueño/admin lo edita al gestionar miembros, O el propio usuario se
    AGREGA a sí mismo con el inviteCode (invariante por diferencia de conjuntos, como el claim:
    delta de `memberUids` == exactamente el caller). Mismo patrón blindado que ya dominamos.
  - `seasons/{id}`: read miembros; write owner/admin.
- `matches.leagueIds`: si el tagging es **server-side** (recomendado), `leagueIds` es server-only
  (Admin SDK) → cero superficie de abuso. Si es **client-side**, hay que permitir que el registrante
  escriba `leagueIds` solo con ligas donde es miembro (más reglas). ⇒ otro punto a favor del server-side.
- **Disciplina de reglas reconciliadas + emulador** (lección del incidente 7-jun): cualquier cambio
  de reglas se prueba en emulador y lo despliega el maestro.

---

## 9. Cliente vs servidor (qué se computa dónde)

- **Standings = CLIENTE v1** (decisión de Isaac): la página de la liga consulta
  `matches where leagueIds array-contains {groupId}, status==confirmed, endedAt>=seasonStart` y
  computa la tabla en el navegador (puro, testeable, reactivo a tabs de período). Escala bien para
  ligas chicas/medianas (decenas de miembros, cientos de partidos). Un helper PURO `computeStandings(matches, opts)`
  (export dual browser+Node) — testeable como el motor de ranking.
- **Tagging (leagueIds) = SERVIDOR** (recomendado): trigger lo escribe al confirmar.
- **Futuro (si crece):** materializar standings en `groups/{id}/standings/{seasonId}` vía Cloud
  Function (como leaderboards), para no recomputar en cliente. v2.

---

## 10. Pantallas (UI)

1. **`ligas.html`** — "Mis ligas": lista (reusa listMyGroups filtrando type=="liga") + botón "Crear liga"
   + "Unirme con link".
2. **Crear liga** (modal/página): nombre, modo (individual/parejas), deporte, primera temporada
   (nombre + fechas). En parejas: define las parejas. → createGroup(type:"liga", league:{...}).
3. **`liga.html?id={groupId}`** — home de la liga:
   - Header: nombre, temporada activa, # miembros, link "únete" (compartir).
   - **Tabla** con tabs Semana/Mes/Año/Temporada (PJ G P Pts % ±Sets ±Games), fila propia resaltada.
   - "Últimos enfrentamientos" (feed).
   - Miembros (avatars) + "agregar" (buscador) [owner/admin].
   - Maneja `?invite=` → unirse.
   - Selector de temporadas pasadas + campeón 🏆.
4. **Registrar a la liga**: en `registrar-min`/`mi-partido`, si ≥3 de los jugadores son de una liga,
   se sugiere/auto-taggea (chip "Cuenta para: Liga de los jueves").

Diseño visual: reusar tokens/estilo de `clasificacion.html` (tabla) y `confirmar.html` (marcador).

---

## 11. Fases

- **E6 — Estructura + miembros** (mayormente sobre groups.js):
  - `ligas.html` (mis ligas) + crear liga (modo/temporada/parejas) escribiendo el bloque `league` +
    `memberUids` + primera season.
  - `liga.html` home con miembros + invite-link + join (`?invite=`) + alta por buscador.
  - Reglas: `memberUids` self-join (invariante de conjunto) + seasons write admin (emulador → deploy maestro).
  - SIN tabla todavía (placeholder "la tabla aparece cuando jueguen").
- **E7 — Juego + standings**:
  - Tagging de partidos (`leagueIds`, server-side recomendado) + sugerencia al registrar.
  - `computeStandings()` puro + tabla multi-período + desempates + % + "últimos enfrentamientos".
  - Cierre de temporada + campeón.
  - Notif `league_invite` (puede adelantarse a E6) + `season_champion`.
- **E8 (futuro):** standings materializados server-side, históricos de temporada, parejas auto-detectadas,
  ligas públicas/descubribles, ascensos/descensos entre divisiones.

---

## 12. Decisiones — LOCKED por Isaac (8-jun)

1. ✅ **Tagging = SERVIDOR al confirmar.** Extender `onMatchConfirmed`: al pasar a confirmed, el servidor
   calcula a qué liga pertenece el partido (≥3 miembros) y escribe el `groupId`. Robusto, server-only → cero
   superficie de abuso en reglas. (E7 toca backend; se prueba en emulador y despliega el maestro.)
2. ✅ **1 liga por partido** → **reusar el `groupId` singular que YA existe** (no se necesita `leagueIds` array).
   El match pertenece a UNA liga. Edge (un jugador en 2 ligas que califican): el registrante puede pre-elegir la
   liga al registrar; si no, el servidor toma la liga donde los 4/≥3 coinciden, o la que comparten todos.
3. ✅ **Visibilidad: solo miembros** (default de groups `members_only`). Públicas = futuro.
4. ✅ **Parejas: las define el creador** al armar la liga (no auto-detección).
5. ✅ **Auto-amistad al unirse a una liga:** SÍ, best-effort (como el claim).
6. (confirmado) Pádel sin empates → puntos 3/0, sin "E".

**Implicación de #1+#2:** el modelo se simplifica — el match sigue con `groupId` (singular, ya escrito por
`register` y ya usado por el contexto Glicko `group:{groupId}:padel`). Standings = `matches where
groupId == {ligaGroupId} and status=="confirmed"`. El servidor solo VALIDA/asigna el groupId por el ≥3 al
confirmar. **NO se agrega `leagueIds`.** Actualizar §2.2 y §3 en consecuencia (reusar groupId, no array).

---

## 13. Por qué este diseño es bueno

- **Reutiliza** groups.js + el contexto Glicko de grupo + invite-links + búsqueda + el flujo
  registrar/confirmar/claim + EN2. Casi nada es greenfield.
- **Un partido, cuatro vistas** (global, club, grupo-Glicko, liga-récord) sin doble registro.
- **Separa** lo simple-adictivo (tabla de fútbol) de lo sofisticado (Glicko) — cada uno donde brilla.
- **Escala por fases**: E6 casi gratis, E7 el corazón, E8 cuando duela.
- **Respeta la disciplina de reglas** (reconciliar + emulador + deploy maestro).
```
