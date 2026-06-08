# Spec canónico — Plataforma social Puntazo (ranking + partidos + ligas)

> **Fuente de verdad para implementar.** Consolida: el audit maestro
> (`auditoria-ranking-partidos-ligas-2026-06-07.md`), el diseño previo v100
> (`ranking-social-v100-design.md`), las decisiones de producto locked por Isaac
> (7-jun-2026), y el dossier de investigación (`investigacion-ranking-2026-06-07.md`).
> Donde haya conflicto, **este documento gana**. Fecha: 2026-06-07.
>
> Regla de oro del proyecto, extendida: *nunca perder un pulso, nunca perder una
> identidad, nunca perder ni corromper un ranking.*

---

## 1. Objetivo y forma de la experiencia

Puntazo deja de ser solo capturador de clips y se vuelve **plataforma social de
pádel/pickleball**. **Dos jornadas, un solo motor de datos**:

- **(A) En club con Puntazo** — sesión social premium (King/Americano) donde además
  caen clips automáticos. La confirmación del resultado es implícita (el organizador
  lleva el marcador en vivo).
- **(B) Sin hardware** — caballo de Troya de crecimiento. Dos parejas terminan su
  partido, uno lo **registra**, le **llega a los rivales**, **1 del equipo rival
  confirma**, y se actualiza ranking + record. El paso "confirmar" es el loop de
  adquisición de cuentas.

Ambas terminan en un `matches/{id}` que, al confirmarse, alimenta el **ranking
autoritativo server-side**. Sin cámara = sin clip; el ranking es idéntico.

---

## 2. Decisiones finales (tabla maestra)

| # | Decisión | Estado | Origen |
|---|---|---|---|
| D1 | Número de ranking **transparente**, escala **1.0–7.0** (conservativeRating), nunca el 1500 crudo | Locked | Isaac |
| D2 | **Global** (1 por deporte) **+ Local** (1 por grupo y 1 por club) | Locked | Isaac |
| D3 | Local = **pool Glicko-2 independiente**, sembrado del global con **RD inflado (~200)**, lazy-init solo con ≥1 partido | Final | Investigación |
| D4 | Local con **<3 partidos** muestra el **global etiquetado "estimado aquí"**, no el local crudo | Final | Investigación |
| D5 | **Confirmación activa "1 de cada equipo"**: cuenta solo si 1 rival confirma; sin confirmar **expira a 7 días** (no cuenta). **NO** auto-confirm | Locked + decisión consciente | Isaac (diverge de Playtomic, ver §6.4) |
| D6 | Registrar **siempre los 4 nombres**, dummies (`{nombre, equipo}` sin uid) reclamables después vía `claims/` | Locked | Isaac |
| D7 | Motor: **mantener `assets/ranking.js`** (no migrar a librería); validar contra vector de Glickman | Final | Investigación |
| D8 | Ranking autoritativo **server-side**: `ratings/{uid}` lo escribe **solo la Cloud Function**; cliente solo lee | Final | Arquitectura |
| D9 | **Cloud Function 2nd gen** `onMatchConfirmed` (trigger Firestore); idempotencia por `matchId` con flag transaccional en `runTransaction` | Final | Investigación |
| D10 | Grupos/ligas **persistentes desde v1**; ligas con ventana **quincenal/mensual** (no semanal) | Locked + Investigación | Isaac |
| D11 | Dobles: equipo = **promedio** de ratings; cada jugador corre Glicko-2 vs promedio rival y recibe **delta distinto** (no igual) | Final | Investigación |
| D12 | UI global/local = **un leaderboard filtrable** con selector `[Global · Mi grupo · Mi club]` | Final | Investigación |
| D13 | **NO** auto-evaluación de rival estilo Playtomic (tóxica, redundante con autoridad server-side) | Final | Investigación (alerta) |
| D14 | Deploy de Blaze y de reglas Firestore = **acción de Isaac** (gated). Yo construyo + pruebo en emulador | Locked | Isaac/ops |

---

## 3. Modelo de datos final (Firestore)

### 3.1 `matches/{id}` — campos nuevos/cambiados (aditivo)

```
matches/{id} {
  // ── existentes (no se tocan) ──
  userId, loc, can, lado, deporte, modo, jugadores[], marcador, clipCount,
  startedAt, endedAt, createdAt, updatedAt,
  scoreAcceptedBy: { uid: true },          // YA EXISTE — base de confirmación

  // ── nuevos ──
  status: "active"|"ended"|"pending_confirmation"|"confirmed"|"disputed"|"void"|"cancelled",
  version: <int>,                          // optimistic lock; +1 en cada update de datos
  confirmation: {                          // máquina de confirmación (jornada B)
    required: true,                        // false en sesiones in-club (auto)
    registeredBy: uid,                     // quién registró
    confirmedByUid: uid|null,              // el rival que confirmó
    confirmedAt: <Timestamp>|null,
    expiresAt: <Timestamp>,                // registeredAt + 7 días
    disputedByUid: uid|null,
    disputeReason: string|null,
  },
  groupId: string|null,                    // liga a la que pertenece (D10)
  sessionId: string|null,                  // sesión Capa 2 que lo originó
  sourceMode: "manual"|"king"|"americano"|"torneo5"|"club_button"|null,

  // ── escritos SOLO por la Cloud Function ──
  ratingProcessed: false,                  // idempotencia (§5.2)
  ratingProcessedAt: <Timestamp>|null,
  ratingAudit: { algorithmVersion, before:{}, after:{}, contexts:[], movMultiplier, ... },
}
```

### 3.2 `ratings/{uid}` — multi-contexto (D2/D3)

Un doc por usuario; los contextos viven en un mapa (lazy-init). Lectura pública
(signedIn); escritura **solo CF**.

```
ratings/{uid} {
  uid, displayName,                        // snapshot
  updatedAt,
  byContext: {
    "global:padel":      <RatingState>,
    "global:pickleball": <RatingState>,
    "club:BreakPoint:padel":        <RatingState>,   // lazy: solo si jugó ahí
    "group:grp-xyz:padel":          <RatingState>,   // lazy: solo si jugó ahí
  }
}

RatingState {
  rating, RD, volatility,                  // Glicko-2 crudo
  conservativeRating, nivel,               // 1.0–7.0 (lo que se muestra)
  bucket,                                  // emoji + nombre (secundario)
  reliability,                             // 0–100 desde RD (UI)
  matchCount, wins, losses,
  lastMatchAt, isCalibrating,              // matchCount < 3
  recentOpponents: { uid: [ts,...] },      // anti-farm PERSISTIDO
  sparkline: [nivel, ...],                 // últimos ~10 (UI)
  seededFromGlobal: bool,                  // true si es local recién sembrado
}
```

Claves de contexto: `global:{sport}`, `club:{loc}:{sport}`, `group:{groupId}:{sport}`.

### 3.3 `processedMatches/{matchId}` — guard de idempotencia (D9)

```
processedMatches/{matchId} {
  processedAt, algorithmVersion, contexts: [string], outcome: "applied"|"skipped",
}
```
Doc creado dentro de la **misma transacción** que actualiza los ratings. Si ya
existe → la CF no reaplica. (Doble guard: este doc + `matches/{id}.ratingProcessed`.)

### 3.4 Otras colecciones (del diseño v100, se mantienen)

`groups/{id}` + `/members/{uid}` + `/rankings/{uid}` (espejo del contexto local del
grupo, escrito por CF) · `groups/{id}/seasons/{seasonId}` (liga quincenal/mensual) ·
`claim_requests/{id}` · `disputes/{id}` · `sessions/{id}` (+ Torneo 5 migrado) ·
`friendships/`, `head_to_head/`, `invites/`, `notifications/`, `handles/`,
`users/{uid}` — schemas en `ranking-social-v100-design.md` §13.

---

## 4. Máquina de estados del partido + confirmación (D5/D6)

```
                 (jornada A: in-club)              (jornada B: sin hardware)
  active ──end──▶ confirmed                 active/registro ──▶ pending_confirmation
   (organizador lleva marcador;                 (registeredBy puso 4 nombres;
    confirmation.required=false;                 1+ con uid; required=true;
    cuenta directo)                              expiresAt = +7d)
                                                       │
                              rival con uid confirma ──┼──▶ confirmed ──▶ (CF aplica ranking)
                                                       │
                              nadie confirma en 7d ────┼──▶ void (expirado, no cuenta)
                                                       │
                              cualquiera de los 4 ─────┴──▶ disputed ──▶ resuelto: confirmed | void
                                                                          (sin admin; ver §6.4)
```

- Solo `status == "confirmed"` dispara y cuenta para ranking.
- **Quién puede confirmar**: cualquier jugador con uid del **equipo contrario** al de
  `registeredBy` (reusa `getScoreAcceptanceState().acceptedByTeam1/2`).
- **Quién puede disputar**: cualquier jugador con uid en el partido, hasta 7 días tras
  `confirmed`. `disputed` revierte el ranking aplicado (recompute) hasta resolver.
- **Reclamo de dummy** (D6): al reclamar un slot dummy, si el partido ya estaba
  `confirmed`, se marca para **recompute** (el nuevo uid entra al ranking). Backfill:
  partidos pre-claim de una cuenta recién creada entran como **no-ranked** salvo que se
  confirmen/reclamen explícitamente (evita inflar histórico de golpe).

---

## 5. Motor de ranking — cambios a `assets/ranking.js`

Mantener todo lo existente (Glicko-2, anti-farm, decay, conservative, buckets,
calibración). Agregar:

### 5.1 Fix de MOV (autocorrelación, FiveThirtyEight)
Hoy MOV es `1 + log(1+diff)*0.12`. Problema conocido (538): equipos fuertes ganan por
más margen → autocorrelación que infla. Multiplicador corregido que **amortigua según
la diferencia de nivel a favor del ganador**:
```
movMultiplier = log(1 + diffGames) * ( 2.2 / (eloDiffFavorWinner*0.001 + 2.2) )
s_adjusted = clamp(s * (1 + movMultiplier), 0, 1.3)
```
Donde `eloDiffFavorWinner = winnerTeamRating - loserTeamRating` (negativo si el ganador
era underdog → multiplicador mayor; positivo si era favorito → amortiguado).

### 5.2 `seedLocalFromGlobal(globalState)` — función pura nueva
```
seedLocalFromGlobal(g) → {
  rating: g.rating,            // hereda la habilidad estimada
  RD: Math.max(g.RD, 200),    // incertidumbre alta: "no sé cómo te va AQUÍ"
  volatility: g.volatility,
  matchCount: 0, isCalibrating: true, seededFromGlobal: true, recentOpponents: {},
}
```
Mata smurfing y es creíble desde el partido 1.

### 5.3 `reliability(RD)` — para UI (estilo DUPR)
```
reliability = clamp(100 * (1 - (RD - 50) / 300), 0, 100)   // RD 50→100%, RD 350→0%
```

### 5.4 Empaquetado dual browser+Node
`ranking.js` hoy es IIFE que cuelga de `window`. Refactor mínimo: exportar también vía
`module.exports` (UMD-lite) para que **la misma fuente** la use el navegador y la Cloud
Function. Cero lógica nueva, solo el wrapper de exports. Es la única fuente de Glicko-2.

### 5.5 Anti-trampa adicional (en el motor, no en fricción de UX)
- **Cap vs rival débil**: si `nivelDiff > 1.5` a favor del ganador, `deltaPositivo *= 0.25`.
- **Dedup de colusión**: el anti-farm existente (peso decreciente vs mismo rival 24h)
  se extiende a **ventana 7 días por par de uids**, persistido en `recentOpponents`.
- Calibración (3 partidos), conservativeRating, decay, MOV cap → ya existen, se conservan.

---

## 6. Cloud Function `onMatchConfirmed` (D8/D9)

### 6.1 Trigger
2nd gen `onDocumentUpdated('matches/{matchId}')`. Procesa cuando:
`before.status != "confirmed" && after.status == "confirmed" && !after.ratingProcessed`.
(También un path de recompute para `disputed→confirmed` y reclamos de dummy.)

### 6.2 Idempotencia (dura — riesgo de corrupción irreversible)
Todo dentro de **un `runTransaction`**:
1. Leer `processedMatches/{matchId}`. Si existe → return (skip).
2. Leer los `ratings/{uid}` de todos los jugadores con uid.
3. Determinar **contextos a actualizar**: `global:{sport}` siempre; `club:{loc}:{sport}`
   siempre; `group:{groupId}:{sport}` si `match.groupId`. Lazy-init los locales con
   `seedLocalFromGlobal` (D3) si no existen.
4. Para cada contexto: `applyMatchToRatings(match, ratingsDelContexto)` (mismo motor).
5. Escribir los N `ratings/{uid}.byContext[ctx]` + `matches/{id}.ratingProcessed=true` +
   `ratingAudit` + crear `processedMatches/{matchId}` — **todo atómico**.
6. (Fuera de tx, best-effort) espejar a `groups/{id}/rankings/{uid}`, `head_to_head/`,
   `users/{uid}.recentPlayers`, notificaciones `rating_bucket_up/down`.

> **NO** `writeBatch` (necesitamos leer antes de escribir). **NO** dedup por `eventId`
> (los reintentos at-least-once pueden traer eventIds distintos; el guard es por
> `matchId`). Límite 500 writes/tx: a 4 jugadores × ~3 contextos = ~12 writes, holgado.

### 6.3 Funciones acompañantes
- `recomputeAllRatings()` — callable admin: borra `ratings/`, `processedMatches/`,
  pone `ratingProcessed=false`, reprocesa cronológico (paginado, bulkWriter). Para
  cambios de `algorithmVersion`/TAU.
- `expireUnconfirmedMatches()` — **scheduled** (cada 15 min) reusando la lógica de
  `match-expiration.js`: `pending_confirmation` con `expiresAt < now` → `void`.
- `onDummyClaimed` / `onDisputeResolved` — marcan match para recompute.

### 6.4 Divergencia consciente vs investigación (auto-confirm)
La investigación recomienda el modelo Playtomic: **cuenta unilateral + auto-confirm 24h
+ dispute→void**. **No lo adopto**: auto-confirmar sin que un rival actúe reabre el
hueco "inventar un resultado solo", que es justo el anti-trampa que Isaac eligió y que
un número público vuelve crítico. Mantengo **confirmación activa** (D5). Conservo de la
investigación: el estado `disputed` y la resolución **sin admin** (si el disputante y el
registrador no concilian en 7 días → `void`). *Pendiente de veto de Isaac.*

---

## 7. UX (obsesión por el detalle)

- **Número grande 1.0–7.0** + bucket emoji secundario + **% de fiabilidad** (desde RD) +
  `🎯 Calibrando n/3` mientras `isCalibrating`. Nunca el 1500 crudo.
- **Global/Local**: un solo leaderboard con selector `[Global · Mi grupo · Mi club]`
  (D12). En perfil: global grande + lista de locales. **Regla anti-confusión**: dentro
  de grupo/club manda el local; en perfil manda el global; nunca dos números pelados sin
  etiqueta. Local con <3 partidos → muestra global con badge "estimado aquí" (D4).
- **Registro/confirmación (jornada B)**: pantalla express ≤20s (4 nombres con
  autocomplete de `recentPlayers`+amigos, marcador, listo). Microcopy: registrar =
  **"Registrar partido"**; al rival → **"¿Jugaste este partido? Confírmalo"** /
  **"Sí, jugué"** + **"El marcador está mal"** (dispute). Deep-link/QR para confirmar en
  un toque.
- **Desglose de cambio** por partido: "+0.08 — ganaste ajustado a un rival más fuerte".
  Transparencia total (lección Playtomic: publicar el algoritmo).
- **Ligas**: cohorte ~20–30, ascenso/descenso, ventana quincenal/mensual, puntos por
  jugar+ganar, racha de "quincenas con partido". H2H, badges/logros.
- **Viral (fase 2)**: tarjeta 9:16 estilo Wrapped + título local inclusivo estilo Strava
  Local Legend (reusa skill de overlays).
- **Móvil-first**: targets táctiles ≥44px, contraste AA, carga perezosa, accesible.

---

## 8. Plan de build por fases (cada fase auditada antes de avanzar)

> Camino crítico. Nada "social serio" converge sin F1–F2.

| Fase | Scope | Gate de salida |
|---|---|---|
| **F0** (gate) | Refactor export dual de `ranking.js` + **test del vector de Glickman** (página `tests/ranking-test.html` + `node --test`) + fix MOV + `seedLocalFromGlobal` + `reliability` | **Vector de Glickman pasa** (bloqueante). MOV no regresiona. |
| **F1** | CF `onMatchConfirmed` (global+local, `runTransaction` idempotente, lazy contextos, anti-trampa) + `processedMatches` + tests de emulador (idempotencia, multi-contexto, dummies) | Emulador: reprocesar 2× no duplica; 3 contextos correctos; vector replicado server-side |
| **F2** | `matches.js`: `version`+optimistic lock; máquina de estados + confirmación (reusar `scoreAcceptedBy`); `expireUnconfirmedMatches` scheduled | Emulador: estados transicionan; expira a 7d; solo `confirmed` procesa |
| **F3** | Cliente: `ranking-client.js` → **read-only de `ratings/`** (con fallback al cálculo viejo si el doc no existe aún); `mi-nivel.html` lee server | `mi-nivel` consistente entre devices |
| **F4** | Jornada B: pantalla registro express + flujo confirmar/disputar + autocomplete; reglas Firestore (ratings write:false, processedMatches, confirmation) probadas en emulador | Registro→confirmar→ranking E2E en emulador |
| **F5** | Ligas: `match.groupId`, ranking local por grupo/club, `groups/{id}/rankings` espejo, seasons quincenal, selector leaderboard, validar inviteCode en reglas | Liga con leaderboard real |
| **F6** | Sesiones: migrar Torneo 5 a `sessions/`; King/Americano escriben mini-partidos `confirmed` a `matches/` → alimentan ranking | Un King produce ratings |
| **F7** | Polish: desgloses, reliability UI, badges, tarjeta compartible, microcopy, a11y, móvil | Review de "ojos senior" |

**Gated a Isaac (no lo hago unilateral):** activar Blaze + `firebase deploy --only
functions`; deploy de reglas Firestore (lección del outage 06-03 → grep de todos los
`source`/colecciones + test de emulador + confirmación de Isaac antes de tocar prod).

---

## 9. Riesgos y mitigaciones clave

| Riesgo | Mitigación |
|---|---|
| CF corrompe ratings (doble proceso) | Idempotencia transaccional `processedMatches` + `ratingProcessed` (§6.2). Tests de emulador de reproceso. |
| Deploy de reglas tumba prod (como 06-03) | `firestore.rules` versionado + emulador + grep de `source`/colecciones + deploy gated por Isaac. |
| Local confunde ("¿mi nivel real?") | D4 + regla anti-confusión §7. |
| Número público invita a trampa | Confirmación activa (D5) + anti-trampa en el rating (§5.5), no más fricción. |
| Migrar a Blaze | Tier gratuito a esta escala; build+test en emulador; deploy = 1 clic de Isaac. |
| Algoritmo mal portado a Node | Vector de Glickman como gate F0; misma fuente browser+Node (§5.4). |

---

## 10. Qué se reusa (no reinventar)
- `assets/ranking.js` — Glicko-2 completo (solo extender §5).
- `matches.js` `scoreAcceptedBy`/`getScoreAcceptanceState` — base de confirmación.
- `matches.js` `claims/` + `mergeMatchWithClaims` — dummies/reclamo.
- `match-expiration.js` — base del scheduler de expiración.
- `groups.js`/`friends.js`/`identity.js` — esqueleto social (pulir).
- Reglas consolidadas de `ranking-social-v100-design.md` §14 — base a reconciliar.
- Toolchain Firebase ya andamiado + emulador validado.
```
```

Próximo paso: **F0** — refactor + test del vector de Glickman (gate bloqueante).
