# Dossier de investigacion tecnica — ranking/partidos/ligas (2026-06-07)

Insumo: 5 reportes de investigacion comparada (con fuentes) para el rediseno de ranking/partidos/ligas. Este documento condensa las decisiones, formulas, trade-offs y alertas para alimentar el spec de implementacion. No reescribe decisiones de producto; cuando la investigacion las contradice, lo marca como ALERTA.

---

## 0. Decisiones en una tabla

| Tema | Decision | Alternativa descartada principal | Por que (1 linea) | Fuente clave |
|---|---|---|---|---|
| Motor de rating | MANTENER `assets/ranking.js` (Glicko-2 propio) + tests contra vector de Glickman + fix MOV | Migrar a npm `glicko2` / OpenSkill | Ninguna libreria trae junto MOV+anti-farm+decay+conservative+buckets; migrar obliga a reimplementar el 60% igual | glicko.net/glicko/glicko2.pdf |
| Dobles | Equipo = promedio de ratings; cada jugador corre Glicko-2 vs rating promedio rival; deltas individuales (no iguales) | Reparto individual OpenSkill / delta igual UTR | Es el estandar UTR/DUPR (promedio de equipo) y Glicko-2 ya da deltas por-jugador segun su RD | support.universaltennis.com (doubles) / pickleheads.com/guides/how-dupr-works |
| Live vs batch | Update por-partido (1 match = mini rating-period) | Batch periodico | Correcto para trigger `onMatchConfirmed`; practica comun en juegos live (Lichess) | lichess.org/forum (glicko-2 rating-periods) |
| Doble rating global+local | Pools Glicko-2 INDEPENDIENTES, local sembrado desde global con RD inflado (~200) | Offset lineal (B) / bayesiano jerarquico real (C) | A es la aproximacion barata y online del shrinkage de C; cero motor nuevo, reusa ranking.js N veces | glicko2.pdf / chess.com pools |
| Limite de contextos | 1 GLOBAL/deporte + LOCALES lazy-init solo con >=1 partido | Precrear todos los contextos | Coste lineal (~<10/usuario), evita explosion de estado Firestore | en.wikipedia.org/wiki/Glicko_rating_system |
| Gen Cloud Functions | 2nd gen (`onDocumentUpdated` matches/{id}) | 1st gen / GitHub Action como ruta caliente | 1st gen congelado; Action mete latencia de minutos y no es autoritativo event-driven | firebase.google.com/docs/functions/version-comparison |
| Idempotencia | Flag `ratingProcessed` re-chequeado DENTRO de la transaccion (por matchId, no eventId) | Dedup por eventId | at-least-once: sin flag transaccional el delta se aplica 2x e irreversible | cloud.google.com/blog (idempotent functions) |
| Tx vs batch | Firestore `runTransaction` (no writeBatch) | writeBatch | Hay que LEER ratings+flag antes de decidir escribir; batch es write-only | firebase.google.com/docs/firestore/manage-data/transactions |
| CF vs GitHub Action | CF 2nd gen para ruta caliente; Action SOLO para recompute masivo offline | Action para todo | A escala chica CF cuesta ~$0 (2M inv/mes free); Action no ahorra dinero real y empeora UX | firebase.google.com/pricing |
| Confirmacion de partido | Modelo Playtomic: unilateral 1-rival + auto-confirm 24h + DISPUTED->VOID sin admin | DUPR unanimidad-4 / esports admin-resuelve | Unanimidad mata la "jornada estrella"; admin no escala social. Playtomic = baja friccion + veto real | playerhelp.playtomic.com (invalid match results) |
| Anti-trampa | Reusar lo de ranking.js (calibracion 3, conservativeRating, anti-farm, MOV cap, decay) + cap vs rival debil + dedup colusion | Evidencia/screenshot por partido | Mover la defensa al RATING, no a mas friccion en el flujo | dupr.com/post (match validation) |
| UX nivel | Numero 1.0-7.0 grande + % fiabilidad derivado de RD + "Calibrando n/3" | Auto-evaluacion de rival (Playtomic) | Numero claro estilo DUPR/UTR; auto-eval es toxica y Puntazo ya es autoritativo server-side | dupr.com/post (reliability score) |
| Global/Local UI | UN leaderboard filtrable con selector [Global / Mi grupo / Mi club] | Dos pantallas separadas | Mismo dato, un selector = patron mas limpio (Chess.com) | support.chess.com/articles/8705280 |
| Ligas / retencion | Liga de cohorte ~20-30 con ascenso/descenso, ventana QUINCENAL/mensual, puntos por jugar+ganar | Liga semanal pura (Duolingo) | Padel no es diario; aversion-a-la-perdida retiene (+25% medido) pero hay que alargar ventana | duolingo.deconstructoroffun.com/mechanics/leagues |
| Viralidad | Tarjeta 9:16 estilo Wrapped + titulo local inclusivo estilo Strava Local Legend | Solo numero (utility) | El numero no retiene; tarjeta = crecimiento organico, Local Legend incluye al no-top | support.strava.com/articles/360043099552 |

---

## 1. Motor de rating (libreria vs propio, dobles, live/batch, MOV)

**Decision: mantener `assets/ranking.js` (Glicko-2 hand-rolled). NO migrar.**

Trade-off central: ninguna libreria off-the-shelf cubre junto lo que Puntazo necesita (MOV + anti-farm + decay RD por inactividad + conservative rating + buckets transparentes 1.0-7.0 + idempotencia + audit trail). Migrar no elimina trabajo, lo desplaza.

- **npm `glicko2` (mmai):** BATCH por diseno (su doc dice "you should NOT update after each match"). Sin equipos/dobles. Sin MOV/anti-farm/decay/buckets. Migrar = reimplementar ~60% de ranking.js alrededor + hacer el promedio de equipo por fuera igual. Mantenimiento flojo (~2 anios sin publicar). **Cero ganancia.**
- **OpenSkill:** tecnicamente superior para multi-team (Weng-Lin/Plackett-Luce, nativo 2v2, ~20x mas rapido que TrueSkill, update por-partido). PERO cambia el MODELO (Bradley-Terry, no Glicko-2): rompe continuidad de ratings y obliga a remapear la escala desde cero. Su unica ventaja real (reparto individual en dobles) es justo lo que la industria de raqueta NO hace.

**Acciones concretas (en orden):**

1. **TEST DE CORRECTNESS (bloqueante, gate de CI antes de tocar nada).** Reproducir el ejemplo canonico de Glickman (glicko2.pdf): jugador R=1500, RD=200, sigma=0.06, TAU=0.5 vs 3 oponentes `[(1400,30,W),(1550,100,L),(1700,300,L)]`. Esperado: **R≈1464.06, RD≈151.52, sigma≈0.05999**. Valida `_updatePlayer/_g/_E/_toGlicko2/_fromGlicko2` de un golpe. Es el mismo vector con el que validarias cualquier libreria → obtienes la garantia de la libreria SIN la libreria. Riesgo real hoy: NO existe este test (regresion silenciosa posible en `newVolatility` o en `SCALE=173.7178`).

2. **Dobles (formalizar lo que ya hace `teamRating`/`processTeam`):**
   - `R_team = promedio(R_i)`.
   - RD de equipo: hoy usa RMS `rd_team = sqrt(mean(RD_i^2))`. Defendible, pero considerar `mean(RD_i)` para no parecer mas incierto de lo real. **Documentar la eleccion.**
   - Cada jugador corre un update Glicko-2 contra UN oponente sintetico `(R_team_rival, rd_team_rival, score)` = "jugador vs rating promedio del rival". Estandar de industria (UTR: "compares the average rating of Team A to Team B"; DUPR: "your team rating is the average of each player").
   - Resultado: **ambos companeros NO reciben forzosamente el mismo delta** (a diferencia de UTR) porque cada uno parte de su propio R/RD/sigma; quien tiene mas RD se mueve mas. Es mejora legitima y coherente con Glicko-2. Mantenerlo.

3. **Fix MOV (autocorrelacion — el unico gap real).** Hoy `mult = 1 + ln(1+diffGames)*0.12`, cap 1.3, aplicado por igual → infla al favorito que gana palizas esperadas. Adaptar FiveThirtyEight (NBA/NFL Elo): encoger el termino log cuando el ganador ya era favorito.
   - Calcular `eloDiffFavor = R_ganador_team - R_perdedor_team` (con signo, positivo si gano el favorito).
   - Multiplicar el coeficiente log por `2.2 / (eloDiffFavor*0.001 + 2.2)`.
   - Mantener el cap 1.3. Asi una paliza esperada aporta MENOS que una del underdog.

4. **Live/batch:** conservar update por-partido (1 match = mini rating-period). Correcto para `onMatchConfirmed`, comun en juegos live (Lichess). Documentar: RD no baja de ~60 y la volatilidad es ruidosa con poca muestra; la calibracion de 3 partidos (`MIN_MATCHES_FOR_RANKED`) ya cubre el ruido inicial.

5. **Escala transparente:** el mapeo `conservativeRating (rating - 0.5*RD) → nivel 1.0-7.0` (BUCKET_BASE 800, STEP 250) es 100% control propio — ninguna libreria lo da. Refuerza no migrar.

**Riesgos:** sin tests, una refactor rompe `newVolatility`/`SCALE` sin avisar (mitigado por accion 1); MOV sin fix infla al dominante de una liga chica; RD piso ~60 + volatilidad ruidosa hace "temblar" el nivel (conservativeRating amortigua en display, verificar que el bucket no oscile feo); el promedio de equipo penaliza al fuerte que carga a un debil en 2v2 (estandar UTR/DUPR pero genera quejas — comunicarlo).

---

## 2. Doble rating global + local

**Decision: GLOBAL y cada LOCAL (grupo/club) son POOLS Glicko-2 INDEPENDIENTES, reusando `ranking.js` tal cual N veces, sembrando cada local desde el global con RD inflado.**

Trade-off: rigor estadistico maximo (modelo bayesiano jerarquico real / shrinkage) vs coste de ingenieria y explicabilidad. La opcion A entrega ~90% del beneficio del modelo jerarquico (C) con CERO motor nuevo: **inicializar el local con `(rating=global, RD alto)` ES poner un prior gaussiano centrado en el global**, y dejar que Glicko-2 baje el RD con los partidos locales reproduce el shrinkage (poca data → local pegado al global; mucha data → diverge). Glickman avala bajar RD por debajo de 350 cuando la fuerza es aproximadamente conocida — el global la da.

Descartadas: **(B) offset lineal** — ningun producto grande de raqueta lo usa; un offset no captura inversiones de orden entre contextos (A>B global pero B>A en el club), que es justo lo que el producto quiere. **(C) bayesiano jerarquico real** — correcto pero exige motor nuevo (MCMC/variacional), caro por-trigger, opaco para audit partido-a-partido y para la escala 1.0-7.0.

Industria que valida A: chess.com/Lichess separan rating por pool ("only relevant to the particular pool"), Rocket League por modo, R6 por playlist.

**Formula de siembra (en terminos de ranking.js):**

Al crear el rating LOCAL por primera vez, NO usar `INITIAL_RATING/INITIAL_RD` (1500/350). Sembrar desde el global:

```
rating_local_0     = rating_global_actual
RD_local_0         = clamp( max(RD_global_actual, 150), 150, 250 )   // recomendado ~200
volatility_local_0 = volatility_global_actual                       // o INITIAL_VOLATILITY 0.06
```

Razonamiento del RD ~200: RD=350 = "no se nada" (intervalo 95% ≈ toda la escala); RD=50 = "lo se casi perfecto" (mataria la divergencia). El global da una estimacion puntual buena pero NO conoces el meta local → incertidumbre moderada-alta. RD~200 da intervalo 95% de ±400 Glicko: suficiente para que 3-6 partidos locales muevan el local de forma apreciable. Coherente con `MIN_MATCHES_FOR_RANKED=3` y `MAX_RD=350`.

Funcion pura nueva (no toca el motor, solo el estado inicial):

```js
seedLocalFromGlobal(globalRating) => ({
  rating: globalRating.rating,
  RD: Math.min(Math.max(globalRating.RD, 150), 250),
  volatility: globalRating.volatility,
  matchCount: 0, lastMatchAt: null, recentOpponents: {},
  seededFrom: 'global', seededAt: <ts>
})
```

**Decay:** reusar `decayRDForInactivity` tal cual POR CONTEXTO. Los locales se juegan menos → su RD infla mas rapido (correcto: menos certeza local). No hace falta decay distinto por contexto.

**Limite de contextos:** 1 GLOBAL/deporte (canonico) + N LOCALES con lazy-init solo donde haya >=1 partido. No precrear vacios. Coste real lineal en (clubes*grupos jugados), tipico <10/usuario. Almacenar como subcoleccion: `users/{uid}/ratings/{sport_global}`, `.../ratings/{club_<id>}`, `.../ratings/{grupo_<id>}` (o `ratings/{contextId}` con campo `scope`).

**Idempotencia/coherencia (pieza critica):** la CF `onMatchConfirmed`, en UNA transaccion Firestore por partido:
1. leer `processedMatches/{matchId}`; si existe → return.
2. leer estados de TODOS los contextos afectados (global de los 4 + club + cada grupo).
3. llamar `applyMatchToRatings(match, ratingsGlobal)`, luego `(match, ratingsClub)`, luego `(match, ratingsGrupo)` — mismo match, 3 estados → 3 resultados independientes.
4. escribir los N newRatings + `processedMatches/{matchId}` con audit por contexto, todo en el batch/tx. Si falla, Firestore revierte → nunca estado parcial.

La idempotencia vive en `processedMatches/{matchId}` chequeado DENTRO de la tx (no por contexto): 1 partido = 1 unidad atomica que alimenta los 3 pools.

**UI ("cual es mi nivel real"):** patron UTR/DUPR/Playtomic.
- UN numero por defecto = GLOBAL del deporte, grande, 1.0-7.0 (`bucketForRating` sobre conservativeRating global). Ese es "tu nivel".
- Locales como CHIPS/PESTANAS etiquetadas ("En Club Padel Norte: 4.6", "Grupo Martes: 4.1"), nunca numeros sueltos compitiendo con el global.
- Fiabilidad SIEMPRE pegada al numero (estilo DUPR Reliability 1-100%, umbral 60%) derivada de RD/matchCount.
- Mientras `matchCount_local < 3`: MOSTRAR el global etiquetado "estimado aqui" en vez del local crudo (= "(P) projected" de UTR). Nunca mostrar nivel local con RD>~250 como firme.
- Tooltip honesto: "Tu nivel global resume todo tu juego. Los niveles por club/grupo reflejan como rindes en ese contexto y pueden diferir."

**Riesgos:** explosion si no se limita (techo + lazy-init); estado parcial si la tx se reintenta a medio camino (mitigado por tx unica + clave en processedMatches); local crudo enganoso con <3 partidos; siembra mal calibrada (RD muy bajo → no diverge; 350 → oscila salvaje); drift global vs suma de locales (ESPERADO, es feature — documentar, no "arreglar"); recompute toca N pools, no 1 (versionar `ALGORITHM_VERSION` por contexto).

---

## 3. Arquitectura Cloud Functions

**Decision: Cloud Functions 2nd gen (`onDocumentUpdated('matches/{matchId}')`), idempotencia por flag `ratingProcessed` transaccional, Firestore `runTransaction` para escribir match + <=4 ratings atomicamente. GitHub Action SOLO para recompute masivo offline.**

**Veredicto CF vs GitHub Action, con datos:** el trade-off es latencia/autoritatividad vs costo cero. La decision de producto YA tomada (ranking autoritativo server-side, numero que el jugador ve subir al confirmar) exige actualizacion en segundos y escritura atomica en el momento. El Action mete latencia de minutos, su cron no es puntual ni garantizado, y no es event-driven autoritativo. **El argumento de costo a favor del Action se cae con datos:** 2M invocaciones/mes gratis en Blaze + los writes diarios caen dentro de los 20k writes/dia gratis de Firestore → costo efectivo ~$0 a cientos de partidos/mes. No se ahorra dinero real; solo se evita poner tarjeta, a cambio de peor UX y peor garantia.

**2nd gen sobre 1st gen:** 1st gen esta congelado (Google recomienda 2nd gen para nuevo desarrollo); la concurrencia de 2nd gen (default 80/instancia) absorbe rachas de confirmaciones sin multiplicar cold starts.

**Tx sobre batch:** hay que LEER ratings actuales + flag antes de decidir escribir ("procesa solo si no procesado") → caso de uso exacto de `transaction`. `writeBatch` es write-only, no lee estado previo. Limite de 500 no es problema: 1 match + max 4 ratings = 5 writes.

**Snippet de integracion** (ranking.js ya es puro: `applyMatchToRatings(match, currentRatings, opts) -> {newRatings, audit}`):

```js
const { onDocumentUpdated } = require('firebase-functions/firestore');
exports.onMatchConfirmed = onDocumentUpdated({ region:'...', retry:true }, 'matches/{matchId}', async (event)=>{
  const after = event.data.after.data();
  if (after.estado !== 'confirmed' || after.ratingProcessed) return; // pre-check barato
  const matchRef = event.data.after.ref;
  await db.runTransaction(async (tx)=>{
    const fresh = await tx.get(matchRef);
    const m = fresh.data();
    if (m.ratingProcessed) return;                 // re-check DENTRO de la tx (gana la carrera at-least-once)
    const uids = m.jugadores.filter(j=>j.uid).map(j=>j.uid);
    const ratingSnaps = await Promise.all(uids.map(u=> tx.get(db.doc(`ratings/${u}`))));
    const currentRatings = {}; ratingSnaps.forEach((s,i)=> currentRatings[uids[i]] = s.exists ? s.data() : null);
    const { newRatings, audit } = PuntazoRanking.applyMatchToRatings({...m, id:event.params.matchId}, currentRatings, {});
    for (const uid of Object.keys(newRatings)) tx.set(db.doc(`ratings/${uid}`), newRatings[uid], {merge:true});
    tx.update(matchRef, { ratingProcessed:true, ratingAudit:audit, algorithmVersion: audit.algorithmVersion });
  });
});
```

El flag `ratingProcessed=true` se escribe en la MISMA tx que los ratings → at-least-once nunca aplica el delta dos veces. Encaja con que `applyMatchToRatings` ya emite `audit.matchId`, `audit.before/after`, `algorithmVersion`.

**Idempotencia por matchId (no eventId):** si re-deployas o cambias de trigger, el eventId cambia pero el matchId no; usar `ratingProcessed` en el doc del match evita reprocesar aunque Eventarc reentregue con otro id.

**Recompute masivo:** callable `onCall` (admin-only) o el GitHub Action; pagina matches por fecha, re-corre `applyMatchToRatings` en orden cronologico desde `INITIAL_RATING=1500`, persiste con `BulkWriter` (batches de ~20, retry de UNAVAILABLE/ABORTED hasta 10 intentos). Marcar la nueva `ALGORITHM_VERSION`. Antes de correr: **pausar el trigger o filtrar por version** para no colisionar (trigger + batch escribiendo ratings a la vez corrompe).

**Testing:** Firebase Emulator Suite (firestore + functions). Test de integracion con `firebase-functions-test`/mocha: crear match, ponerlo `confirmed`, asertar `ratings/{uid}` y el flag. **Caso clave: invocar el handler DOS veces con el mismo match y verificar que el rating cambia una sola vez.**

**Riesgos:** at-least-once sin flag corrompe ratings irreversiblemente (flag transaccional OBLIGATORIO); cold start firebase-admin+Firestore 3-12s (mitigar con `minInstances=1` si la UX lo exige); contention si 2 partidos de los mismos 4 jugadores se confirman casi simultaneos (Firestore reintenta hasta 5x — ordenar o aceptar retry); Eventarc 2nd gen tiene gotchas de deploy (service account, region nam5 sin firing — validar deploy real, no solo emulador); recompute con BulkWriter NO correrlo con el trigger vivo sin freeze; service_account.json en GitHub Secrets = misma deuda que el PAT, tratarlo con el mismo cuidado.

---

## 4. Confirmacion + anti-trampa

**Decision: modelo Playtomic como base (confirmacion unilateral-con-ventana 24h), endurecido con DISPUTED estilo Toornament pero SIN admin (disputa irresoluble → VOID), respaldado por el anti-trampa que ranking.js ya implementa.**

Trade-off central: FRICCION vs INTEGRIDAD. DUPR (unanimidad de los 4) maximiza integridad pero su friccion mata la "jornada estrella" ya decidida por Puntazo y, sin deadline, deja partidos colgados. El modelo esports (admin resuelve) da la mejor resolucion de disputas pero exige un humano por liga → no escala social. Playtomic resuelve la tension como Puntazo necesita: validacion instantanea con UN rival + auto-confirm 24h para el rival pasivo + derecho de disputa real en la ventana. Su debilidad (colar un marcador falso por timeout) NO se paga con mas friccion, sino moviendo la defensa al RATING.

**Maquina de estados** (`matches/{id}.status`):

```
pending_confirm → confirmed | disputed | voided
                   (disputed → confirmed si hay acuerdo | voided si no, +24h)
```

Campos: `registeredBy(uid)`, `jugadores[4]{uid|null, equipo, nombre}`, `marcador`, `confirmExpiresAt = endedAt + 24h`, `confirmedBy(uid|null)`, `disputedBy(uid|null)`, `proposedMarcador`.

- **Quien registra:** cualquiera de los 4.
- **Quien confirma:** basta 1 jugador con cuenta del equipo RIVAL (no del propio equipo del registrante). 1 click. Regla de seguridad Firestore v100: permitir `set status='confirmed'` solo si `request.auth.uid` esta en jugadores con `equipo != equipo de registeredBy`.
- **Confirmacion instantanea** al primer accept rival.
- **Auto-confirm por timeout:** CF programada (scheduler cada 5-15 min) busca `status=='pending_confirm' && confirmExpiresAt < now && !disputedBy` → pasa a `confirmed`. Reusa el match-expiration global ya existente.
- **Disputa → VOID sin admin:** rival pone `status='disputed'` con `proposedMarcador` en ventana; si `registeredBy` acepta el alterno → `confirmed` con nuevo marcador; si no hay acuerdo en +24h → `voided` (no puntua, = "nullify" de Playtomic).
- **Disparo del ranking:** el trigger llama `applyMatchToRatings` SOLO cuando pasa a `confirmed`. NUNCA en `pending_confirm`.

**Anti-trampa minimo viable** (la mayoria YA en ranking.js):
1. Calibracion provisional 3 partidos + RD inicial 350: limita el dano de un smurf porque su nivel publico usa `conservativeRating = rating - 0.5*RD` → no aparece como bajo creible hasta jugar.
2. Anti-farm: `antifarmWeight = 1/(1+0.5*n)` vs mismo oponente en 24h (ya implementado).
3. MOV cap 1.3 (palizas no inflan infinito).
4. Decay de RD por inactividad.
5. **AÑADIR — cap de ganancia vs rival debil:** el E() de Glicko ya da delta~0, pero guard explicito: "si `nivel_rival < nivel_tuyo - 1.5`, `delta_positivo *= 0.25`".
6. **AÑADIR — dedup de colusion:** contar pares `(uidA,uidB)`; si N partidos entre los mismos 4 uids en 7 dias supera umbral, marcar para revision/peso reducido (extiende el `recentOpponents` que ranking.js ya rastrea).

**Dummies reclamables:** jugadores sin uid → `{uid:null, nombre}`; ranking.js ya los excluye (`filtra j.uid`). El partido SI puntua para los uids reales. Al reclamar (Google Auth), marcar partidos pre-claim como no-ranked para evitar inyeccion de historial (como DUPR con merges).

**Riesgos:** auto-confirm permite colar marcadores falsos contra rivales que no usan la app (mitigar: push+email fiable + dano por-partido capado); colusion 1-de-rival (mitigar: anti-farm por par de uids + cap vs debil + flag de pares anomalos); disputa irresoluble → VOID puede perjudicar al honesto (registrar reputacion de "disputas perdidas/void"); dummies como vector de identidad (no puntuar dummies hasta reclamar, exigir >=1 uid real por equipo); merge/claim puede inyectar historial (recalcular o marcar pre-claim no-ranked); sandbagging por escala publica (mitigado por conservativeRating + provisional + flag de caida de winrate).

---

## 5. UX rating/ligas

**Decision: HIBRIDO en capas, no una sola fuente.** Cada lider resuelve UN problema distinto y Puntazo los tiene todos a la vez. Probada la hipotesis "una sola solucion basta" → NO: Playtomic solo = aburrido (utility, no retiene); Duolingo solo = infantil y no encaja con la frecuencia de padel.

**Capa 1 — Display del nivel (Playtomic/DUPR/UTR):**
- Cabecera: "Nivel 3.4" grande + bucket emoji (ya en BUCKETS) + chip de tendencia (flecha segun delta del ultimo partido, dato en `audit ratingsBefore/After`).
- Fiabilidad sin abrumar: `reliability = round(100 * (1 - (RD-50)/(350-50)))` clamp 0-100; mostrar pequeno ("Fiabilidad 72%") o como anillo alrededor del numero.
- Si `isCalibrating`: ocultar % y mostrar "Calibrando 2/3" con barra (empty-state gamificado). El conservativeRating ya hace el nivel bajo y conservador durante calibracion.
- **NUNCA exponer el ELO interno (1500).** Solo el nivel 1.0-7.0 + texto de fiabilidad.

**Capa 2 — Global/Local (Chess.com):** UN solo leaderboard con selector segmentado arriba `[Global · padel] [Mi grupo] [Mi club]`. Misma fila (avatar, nombre, nivel, tendencia), solo cambia el dataset. Nunca dos pantallas.

**Capa 3 — Ligas (Duolingo, ventana ajustada):** coleccion `ligas/{ligaId}/temporadas/{temporadaId}` con `cierraAt`; `puntos = f(partidos jugados, victorias, delta de nivel)`. Scheduled CF cierra temporada, calcula top N asciende / bottom M desciende, escribe nueva. Cohorte ~20-30/division (grupo del club). **Ventana QUINCENAL/mensual, no semanal** (padel no es diario; una liga semanal quedaria vacia). Aversion-a-la-perdida (miedo a descender) retiene mas que la esperanza de ascender (+25% medido en Duolingo).

**Capa 4 — Viralidad (Strava + Wrapped):**
- Tarjeta compartible 9:16 (1080x1920): nivel actual, delta de temporada, racha, badge → boton "Compartir mi temporada" → Web Share API nativa.
- Titulo local inclusivo estilo Strava Local Legend: badge mensual "Mas activo de [grupo]" por partidos JUGADOS (no ganados) + "Racha" de victorias consecutivas → retiene al que no es top.

**ALERTA (contradice un patron de Playtomic):** NO copiar la auto-evaluacion de rival de Playtomic ("votar si el rival es higher/lower"). Genera disputas y acusaciones de inflado, y Puntazo YA es autoritativo server-side. La autoridad es la CF, no el voto.

**Microcopy ES (confirmacion = la friccion clave):**
- Primario: "Registrar partido".
- Resultado: "¿Quien gano?" con los dos equipos y nombres pre-rellenados.
- Al guardar: "Confirma el resultado — basta que 1 de cada equipo lo valide".
- Pendiente: "Esperando que el otro equipo confirme".
- Jugador no registrado: chip "Invitado · reclamar luego".
- Empty state ranking: "Juega 3 partidos para desbloquear tu nivel" + barra.
- Botones de victoria/derrota NUNCA con lenguaje humillante.

**Movil-first:** targets tactiles min 48x48dp (Material) con 8dp de separacion — critico para botones de marcador tocados con el movil sudado en pista; contraste WCAG AA en el numero; selector Global/Local como segmented control >=48dp; filas del leaderboard tappables completas.

**Las 5 microinteracciones de mayor ROI:**
1. **Chip de tendencia (flecha ±) en la cabecera de nivel** tras cada partido — feedback inmediato de "subi/baje", dato ya disponible en audit, costo casi nulo, alto refuerzo.
2. **Barra "Calibrando n/3"** en empty-state — convierte la espera inicial (sin nivel) en progreso visible, reduce abandono del nuevo usuario.
3. **Selector segmentado Global/Mi grupo/Mi club** — resuelve la confusion global-vs-local en una sola pantalla con un toque.
4. **Boton "Compartir mi temporada" → Web Share** sobre tarjeta 9:16 — motor de crecimiento organico gratis (la tarjeta muestra al usuario, no a la marca).
5. **Aviso de descenso de liga visible toda la temporada** ("Estas en zona de descenso") — aversion-a-la-perdida, el driver de retencion mas fuerte medido en Duolingo.

**Riesgos:** frecuencia de juego (ventana quincenal + racha de "semanas con partido"/victorias, no dias); confusion nivel-mostrado vs ELO interno (nunca exponer 1500); toxicidad por auto-eval (descartada); farming de titulos de consistencia (reusar anti-farm + cap por dia/rival); friccion de confirmacion (2 toques con nombres pre-rellenados — si falla, todo lo demas muere); scheduled CF de cierre de liga (idempotente y recalculable, ranking.js ya lo es).

---

## 6. Cambios que esto implica sobre el plan previo

Ajustes concretos al roadmap del audit, a la luz de la investigacion:

**SE CONFIRMA (la investigacion respalda lo ya decidido):**
- Mantener `assets/ranking.js` propio en vez de adoptar libreria. No hay accion de migracion en el roadmap; eliminar cualquier spike de "evaluar OpenSkill/glicko2 npm".
- Ranking autoritativo server-side via Cloud Function trigger `onMatchConfirmed`. Confirmado contra el GitHub Action con datos de costo (CF ~$0 a esta escala).
- Numero transparente 1.0-7.0 con conservativeRating + isCalibrating como base de UX. Ya correcto.
- Doble eje GLOBAL/LOCAL como direccion de producto. Confirmado, con arquitectura definida (pools independientes).
- Flujo de confirmacion ligero "1 de cada equipo" (jornada estrella). Confirmado: coincide exactamente con el modelo Playtomic.

**QUE CAMBIA / SE PRECISA:**
- **Gen de Cloud Functions: fijar 2nd gen** explicitamente en el spec (no 1st gen). Anadir `minInstances=1` como opcion si la UX de "nivel sube al instante" lo exige (costo idle pequeno).
- **Idempotencia: por matchId con flag `ratingProcessed` transaccional, NO por eventId.** Y usar `runTransaction` (no writeBatch) — escribir esto como requisito duro en el spec por riesgo de corrupcion irreversible.
- **Doble rating: NO precrear contextos.** Cambiar cualquier diseno que cree locales de entrada → lazy-init solo con >=1 partido. Techo: 1 global/deporte + locales con partidos.
- **Local con <3 partidos: mostrar el GLOBAL etiquetado "estimado aqui"**, no el local crudo. Ajustar el diseno de la vista de perfil/leaderboard local.
- **Ligas: ventana QUINCENAL/mensual, NO semanal**, y racha de "semanas con partido"/victorias en vez de dias. Corregir si el plan asumia cadencia tipo Duolingo semanal/diaria.
- **Dobles: documentar formalmente** que ambos companeros reciben deltas DISTINTOS (no iguales como UTR) y que el promedio de equipo penaliza al fuerte que carga a un debil — preparar microcopy/FAQ para la queja esperada.

**QUE SE AGREGA (no estaba o estaba implicito):**
- **Test del vector de Glickman como gate de CI bloqueante** antes de cualquier otra tarea de ranking. Primer item del backlog.
- **Fix de MOV por autocorrelacion** (FiveThirtyEight: `2.2/(eloDiffFavor*0.001 + 2.2)`). Nuevo item, unico gap algoritmico real.
- **Funcion pura `seedLocalFromGlobal`** (RD ~200) en `window.PuntazoRanking`.
- **Coleccion/clave de idempotencia** `processedMatches/{matchId}` + escritura atomica de los N contextos en una sola tx.
- **CF programada de auto-confirm 24h** (scheduler 5-15 min) reusando el match-expiration global existente.
- **Estado `disputed` + flujo DISPUTED→VOID sin admin** en la maquina de estados de matches.
- **Dos reglas anti-trampa nuevas:** cap de ganancia vs rival debil (`delta_positivo *= 0.25` si diff de nivel > 1.5) y dedup de colusion por pares de uids en ventana de 7 dias.
- **Backfill de claim:** marcar partidos pre-claim como no-ranked al reclamar una cuenta.
- **Indicador de fiabilidad derivado de RD** (`reliability = 100*(1 - (RD-50)/300)`) en la UI, estilo DUPR.
- **Tarjeta compartible 9:16 + titulo local inclusivo** (Strava Local Legend) como fase de viralidad (fase 2, no MVP).

**ALERTA explicita (investigacion vs producto):**
- NO adoptar la **auto-evaluacion de rival** de Playtomic ("votar higher/lower"). Es toxica y redundante con la autoridad server-side ya decidida. Si algun mockup la incluye, eliminarla.
