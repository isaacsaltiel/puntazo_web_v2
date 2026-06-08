# Roadmap Maestro — Plataforma Social Puntazo (8-jun-2026)

> **Modelo operativo: maestro → workers.** Este chat (maestro) conserva contexto, diseña
> roadmap, escribe prompts+briefs para workers efímeros, revisa reportes, decide siguiente
> etapa. Los workers ejecutan UNA etapa, sin improvisar scope. Fuente de verdad del estado:
> este doc + `estado-y-roadmap-plataforma-social-2026-06-07.md` + memoria
> `project-social-platform-spec-2026-06-07`.

---

## Estado actual (qué está LIVE)

- **Backend ranking**: 3 Cloud Functions v2 (onMatchConfirmed, expireUnconfirmed, recompute) —
  LIVE y probadas en prod. Escriben `ratings/{uid}` y `leaderboards/{ctx}/entries/{uid}`.
- **Reglas Firestore reconciliadas** (v100 + ranking + matches 2 flujos, anti-autoconfirmar) —
  LIVE, probadas en emulador 15/15.
- **F4 registro sin hardware**: `registrar-min.html` (registra→link), `confirmar.html`
  (rival confirma→ranking), búsqueda global (`identity.searchUsers`), watcher de "partido por
  confirmar", banner de "clip listo" mejorado. Pusheado. **NO enlazado en nav** (solo URL).
- **DEUDA**: backend (`functions/`, `firestore.rules`, `firebase.json`) **sin commitear en git**.

---

## Etapas (con dependencias)

| Etapa | Qué | Depende de | Tipo |
|---|---|---|---|
| **E0** | Hygiene: commitear backend a git (`functions/`, `firestore.rules`, `firebase.json`, tests) | — | Quick |
| **E1** | **Tablero global de ranking + tu número en perfil** (UI read-only sobre backend live) | — | Quick |
| **E2** | Enlazar `registrar-min`/`confirmar` en el nav + pulir entradas | E1 | Quick |
| **E3** | **Claiming v1**: registrar con puros dummies + dummies persistentes + link + "yo soy X" + auto-amistad + declinar. Reglas claim/decline (emulador→deploy reconciliado) | F4 (hecho) | Profundo |
| **E4** | Claiming v2: sugerencias retroactivas (mismo guest en otros pendientes) + merge/borrar invitados | E3 | Medio |
| **E5** | **Head-to-Head** en perfil de jugador (historial, victorias, games, sets) | matches (existe) | Medio |
| **E6** | **Ligas — estructura + miembros**: crear liga (modo indiv/parejas), agregar miembros (buscador + link "únete") | groups (existe), E3 (link/invite) | Profundo |
| **E7** | **Ligas — juego**: registrar a la liga (desde liga o registrar-min), tabla multi-período (sem/mes/año), desempates Torneo 5, % , últimos enfrentamientos, campeón | E6, E1 (patrón leaderboard) | Profundo |

### Dependencias clave
- E3 (claiming) desbloquea el crecimiento real y el invite-link que reusa E6.
- E1 establece el patrón de leaderboard que reusa E7.
- E5 (head-to-head) es independiente → buen relleno paralelo.

---

## A. Quick wins vs Arquitectura profunda

**Quick wins (visibles, bajo riesgo, sin tocar data model):**
- **E0** — git hygiene (protege lo construido). ~30 min.
- **E1** — tablero global + número en perfil. Motor ya corre; es leer y pintar. **Mejor primer fruto visible.**
- **E2** — enlazar en nav.
- **E5** — head-to-head (lectura/agregación de matches; medio pero aislado).

**Arquitectura profunda (data model + reglas + identidad):**
- **E3/E4** — claiming + dummies persistentes: nuevo modelo `guests`, reglas nuevas (claim/decline)
  con emulador + deploy reconciliado, página de claim, declinar. Es el corazón del wedge.
- **E6/E7** — ligas: motor de standings multi-período + desempates + membresía + invites.

**Regla de oro de orden:** primero lo que da valor visible sin deuda (E0→E1→E2), luego el
refactor de identidad (E3/E4) que TODO lo social necesita, luego ligas (E6/E7). E5 se puede
intercalar en paralelo.

---

## B. Orden recomendado de workers

1. **E1** — Tablero global + número en perfil (worker #1). Aislado, valida el flujo maestro→worker.
2. **E0** — git hygiene (worker corto, o se hace junto a E1).
3. **E3** — Claiming v1 (worker grande; el maestro parte en sub-etapas si conviene: 3a reglas+modelo, 3b UI).
4. **E5** — Head-to-head (paralelizable).
5. **E6 → E7** — Ligas.

---

## Bitácora de etapas
- **E1 ✅ (commit 90197df45)** — `clasificacion.html` (tablero global) + número global en `perfil.html`
  + link desde `mi-nivel.html`. Validado con datos reales. OJO: replica thresholds nivel→emoji de
  ranking.js inline (deuda menor). `tablero.html` ya existía (marcador en vivo) → por eso `clasificacion.html`.
- **E0 (backend) ✅ (commit efb20b237)** — consolidado en git: `functions/`, `firestore.rules`,
  `firebase.json`, `firestore.indexes.json`, `.firebaserc`, `tests/`, docs de spec/roadmap.
  PENDIENTE E0b: revisar+commitear los JS web read-side (`matches.js` −108, `ranking.js` ±, `ranking-read.js`
  untracked) — cambian el sitio en vivo, requieren validación en navegador. Deuda aislada, no urgente.

- **E5 ✅ (commit 56c6fcfaa)** — `jugador.html?uid=` (perfil público + Head-to-Head con totales V/games/sets,
  rivales vs compañeros) + filas de `clasificacion.html` enlazadas. Frontend read-only. Deudas que dejó:
  privacy (`users.privacy`) no respetada en la vista pública; falta botón "amigo" (→ E6); más entry points
  (linkear nombres en scoreboard-cards). Sin validación visual en navegador aún.

## GATE de validación (pendiente Isaac)
E1 + E5 + F4 sin validar en navegador con datos reales. Recomendado: Isaac registra 1 partido real
(registrar-min → confirmar con un amigo) → enciende clasificacion + jugador + perfil con datos reales.
Alternativa: maestro siembra demo con service account (requiere autorización explícita de Isaac;
el clasificador lo bloquea sin ella).

## GATE de validación — ✅ PASADO (8-jun)
Isaac sembró demo (autorizado) + validó en navegador: tablero con 6 jugadores ordenados, fila
propia resaltada, perfil público OK. "Me encanta, todo." Demo limuiada (leaderboard de vuelta a 2 reales).

- **E3a ✅ (commit cfb59a341, reglas DEPLOYADAS por el maestro 8-jun)** — reglas claim/decline + modelo
  `guests`, invariante por diferencia de conjuntos sobre `playerUids` (delta == exactamente el caller),
  doble candado (affectedKeys + fieldUnchanged), `status` inmutable. Emulador 22/22 (reconfirmado por
  maestro) → `firebase deploy --only firestore:rules` LIVE. Riesgo abierto anotado: decline-del-registrante
  deja `userId` fuera de playerUids (inofensivo; capa-app en E3b no lo expone, usa cancelar/delete).

- **E3b ✅ (commit 9e6f8d94a, en origin/master, SIN deploy)** — loop de claiming cerrado en cliente:
  `match-actions.register` relajado (registra con puros dummies; sigue exigiendo registrante+marcador),
  `claim(matchId, slot)` y `decline(matchId)` nuevos (transacción + revalidación adentro contra doble-claim;
  patches verificados por el maestro contra `isClaimAction`/`isDeclineAction` vivas — solo tocan
  jugadores/playerUids/updatedAt/version, delta == exactamente el caller), auto-amistad best-effort,
  `confirmar.html` con path "¿Cuál eres?" (match-by-name del displayName de Google) + botón "No jugué"
  (compañero=decline, rival=dispute). `registrar-min.html` copy actualizado. Validó node --check + test de
  seguridad replicando los transforms vs predicados de reglas (pasó) + bestDummyMatch. NO hizo E2E real
  (requiere siembra + 2da cuenta en navegador). Deudas que dejó: aviso al registrante cuando un compañero
  declina (sin canal aún), botón "No jugué" en el watcher (opcional, no puesto), claim-a-slot-equivocado
  no verificable en reglas (mitigado: la UI muestra equipo/compañeros de cada opción).

## GATE de validación E2E claiming (pendiente)
El loop registrar-all-dummies → reclamar → confirmar → ranking-se-mueve NUNCA corrió E2E contra reglas vivas.
Necesita: Isaac registra un partido con puros nombres → abre el link en OTRA cuenta Google → "¿Cuál eres?" →
reclama el slot rival → confirma → verifica que clasificacion/perfil se mueven. (El maestro puede sembrar el
partido pending con service account con autorización, pero el claim+confirm reales necesitan 2da cuenta en
navegador — Admin SDK saltaría las reglas y no validaría nada.)

## GATE E2E claiming — ✅ PARCIAL (8-jun, prueba real de Isaac)
Maestro sembró match demo (autorizado) `a1Kg6PvIIMEZp8eosWMc` (pareja demo team1 aceptada + 2 dummies team2).
Isaac, con su sola cuenta, **reclamó el slot de Luis (team2) — el claim FUNCIONA** (su uid quedó grabado,
reglas vivas lo aceptaron, verificado en backend). Luego picó Disputar (para probar) → match `disputed`,
ranking NO se movió (correcto). **La mecánica del wedge sirve.** Pero la UX lo confundió → 6 hallazgos
reales (ver E3b.1). El path de CONFIRMAR (que mueve el ranking) aún no se validó E2E → re-test tras pulido,
reseteando el match demo a pending.

## 🏁 GATE E2E claiming — ✅ COMPLETO (8-jun, prueba real de Isaac, pantalla pulida)
Tras E3b.1 + hotfix, Isaac corrió el loop ENTERO con su sola cuenta contra infraestructura viva:
**registrar-con-dummies → "¿Cuál eres?" → reclamar (Mateo, team2) → Confirmar → trigger → ranking se movió**
(nivel 2.57→3.04, leaderboard actualizado, `processedMatches` idempotente). **El wedge de crecimiento está
PROBADO end-to-end en producción.** Bug cazado y arreglado en vivo por el maestro (hotfix `8f3df2ba1`):
renderClaim/terminales reemplazan `#state-box` y destruían `#ask`; el re-render en sitio tras claim reventaba
con "innerHTML of null" → se restaura `#ask` al inicio de cada `renderState`.
Limpieza post-prueba (autorizada): borrado match demo + club:DEMO_E2E + 2 pendientes de Isaac; recompute a la
verdad (1 partido real vs Juliette) → ratings limpios (Isaac 2.57 W/L 0/1, Juliette 3.87 1/0), fantasmas fuera.
DEUDA descubierta: `recomputeAllRatings` (callable prod) requiere índice compuesto `matches(status,endedAt)`
que NO estaba en `firestore.indexes.json` (estaba vacío) — lo agregué al archivo; FALTA `firebase deploy
--only firestore:indexes` para que el callable funcione en prod (el maestro lo corrió local saltando el orderBy).

## 🔧 Fix amistades (8-jun) — "insufficient permissions" al agregar amigo por 1ª vez
`sendFriendRequest` hacía `ref.get()` ANTES de crear; la regla de read de `friendships` referencia
`resource.data.uidA`, y en un doc INEXISTENTE `resource` es null → la regla revienta → permission-denied
en el `.get()` (antes de intentar el create, que SÍ está permitido). Reproducido + validado en emulador con
reglas vivas (`functions/itest/friends-rules.js`, 5/5: get-inexistente DENIED, create SUCCEEDS, read/accept por
participante OK, tercero DENIED). **Fix de CLIENTE** (cero deploy de reglas): envolver el `get()` en try/catch y,
si falla/no existe, ir directo a crear. Commiteado. Desbloquea agregar amigos en `amigos.html` y la auto-amistad
del claim. (La limpieza también dejó el backend en cero: 0 partidos confirmados, 0 ratings — todo era prueba.)

## C. Worker activo / siguiente
- Workers #1 (E1), #2 (E5), #3 (E3a), #4 (E3b), #5 (E3b.1) ✅ cerrados. Loop de claiming COMPLETO y validado E2E.
- **EN1 ✅ (commit 3c7518f76 + hotfix 88ec0855a)** — campana de notificaciones v1 (`assets/notifications.js`):
  consolida solicitudes de amistad + partidos por confirmar + clips listos, badge sin-leer en localStorage,
  sobrevive al re-render del auth-slot, reúsa las queries de los vigías (mismo `uid_creator`+`consumed_at`/
  `array-contains`), absorbe los banners flotantes (deja el verde "partido en curso"). Shape estable para v2.
  **Validado en vivo por Isaac (escritorio+móvil):** campana+badge=2(→3 con un clip real)+panel+accionables
  (aceptar amistad y confirmar partido) OK. Hotfix: título y subtítulo eran `<span>` en línea → se pegaban
  ("confirmarPablo…") → `display:block`. DEUDA menor: la notif de clip va a `perfil.html?pulse=<id>#mis-puntazos`
  pero NO resalta/scrollea al puntazo concreto (solo abre el perfil) — el deep-link de pulse en perfil.html no
  enganchó; arreglar al tocar perfil. Datos de prueba sembrados (match DEMO_NOTIF + solicitud Juliette→Isaac) →
  PENDIENTE limpiar.
- **Siguiente:** EN2 (notifs server-side v2: colección `notifications/{uid}/items` + onSnapshot + push) o el fork
  E3c (invitados persistentes) / E6 (ligas).
- **Fork de producto pendiente (Isaac decide):** (b) **E3c** invitados persistentes (`users/{uid}/guests` ya
  con reglas E3a → elegir invitado guardado al registrar + sugerencias/merge E4); (c) **E6** ligas
  (estructura+miembros, reusa invite-link).
  Deudas vivas: deploy índice `matches(status,endedAt)`; E0b (JS web read-side); E2 (nav); privacy en vistas
  públicas; entry points; aviso-al-registrante cuando un compañero declina; edge logout-a-mitad en confirmar.html.

---

## Cómo el maestro absorbe reportes
Worker entrega "REPORTE ETAPA X" → el maestro: (1) actualiza este doc + memoria, (2) verifica
contra Definition of Done, (3) decide siguiente etapa, (4) emite prompt+brief del siguiente worker.
