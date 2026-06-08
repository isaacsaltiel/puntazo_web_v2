# Worker #4 — ETAPA E3b: Cerrar el loop de Claiming (UI)

## Título de etapa
E3b — Permitir registrar un partido con **puros nombres sin cuenta** (dummies) y que el rival, al abrir el link, **reclame su lugar ("yo soy X")**, se haga amigo y confirme. Más botón **"No jugué / declinar"**. Las reglas Firestore de claim/decline + guests YA están desplegadas (E3a); aquí va la UI/lógica de cliente.

## Objetivo
Hoy registrar **se traba** si ningún rival tiene cuenta (`match-actions.register` exige ≥1 rival con uid). Cambiarlo para que:
1. Puedas registrar con dummies (sin rival con cuenta). El partido queda `pending_confirmation`.
2. El rival abra el link (`confirmar.html?id=`), y si **aún no es jugador**, vea **"¿Cuál eres?"** con los nombres dummy, **reclame** su lugar (su uid entra al match) y, si es rival, **confirme**. Al reclamar se hace **amigo** de los demás jugadores.
3. Un **compañero** que no jugó pueda **declinar** ("No jugué") y removerse; un **rival** que no está de acuerdo **disputa** (ya existe).

## Contexto (lo que YA existe y debes reusar)
- **Reglas LIVE (E3a)**: en `matches`, un signedIn puede AGREGARSE a un match pending (claim: su uid entra a `playerUids` + a un slot de `jugadores`, sin tocar `marcador/userId/status/ratingProcessed`) y un player puede REMOVERSE (decline). Subcolección `users/{uid}/guests` (no la necesitas en E3b; es E3c). Detalle: `docs/plans/spec-registro-claiming-ligas-2026-06-08.md` §2/§6 y `firestore.rules` (funciones `isClaimAction`/`isDeclineAction`).
- **`assets/match-actions.js`** — `register/confirm/dispute` (web SDK, dentro de transacciones). AQUÍ relajas `register` y AGREGAS `claim` y `decline`.
- **`assets/match-confirmation.js`** — lógica PURA: `teamOf(match, uid)`, `teamUids`, `canConfirm`, `STATUS`, `registrantUid`. Reusar.
- **`registrar-min.html`** — flujo de registro (ya cableado a `register`). Relajar su validación.
- **`confirmar.html`** — página de confirmación del rival (ya hace confirm/dispute). AQUÍ agregas el path de **claim** + **declinar**.
- **`assets/friends.js`** — `sendFriendRequest(uid)` / `getFriendshipStatus(uid)` para la auto-amistad.
- **`assets/match-confirm-watcher.js`** — banner "tienes un partido por confirmar" (puedes añadir ahí el "No jugué").
- **`assets/identity.js`** — `getProfile(uid)` (nombre Google para el match-by-name al reclamar).

## Forma del match (recordatorio)
`matches/{id}` = `{ userId(registrante), status, jugadores:[{nombre,equipo:"team1"|"team2", uid?}], playerUids:[uids reales], marcador:{sets,ganador}, scoreAcceptedBy:{uid:true}, confirmation:{...}, ratingProcessed }`. Un **dummy** = elemento de `jugadores` SIN `uid`. Reclamar = ponerle `uid` a un dummy + agregar ese uid a `playerUids`.

## Alcance (SOLO esto)
1. **Relajar el registro** (`match-actions.register` + `registrar-min.html`): quitar el requisito de "≥1 rival con cuenta". Debe seguir exigiendo: registrante con uid (auto-acepta su lado), marcador con ganador. Si NO hay rival con cuenta, el partido se registra igual (pending). Ajustar el copy de la pantalla final: "Manda el link para que tu rival se una y confirme" (el botón de WhatsApp/copiar ya existe).
2. **`match-actions.claim(matchId, slotIndex)`** (NUEVO, web SDK, transacción): valida que el match esté pending, que el caller NO sea ya jugador, que el slot `jugadores[slotIndex]` sea un dummy (sin uid); setea `jugadores[slotIndex].uid = miUid` y agrega miUid a `playerUids` (+ updatedAt/version). Tras éxito, dispara **auto-amistad** (sendFriendRequest a los otros jugadores con uid que no sean ya amigos). Respeta la regla `isClaimAction` (delta de playerUids == exactamente yo).
3. **`match-actions.decline(matchId)`** (NUEVO): si soy COMPAÑERO del registrante → remueve mi uid de `jugadores` (mi slot vuelve dummy: `uid` fuera) y de `playerUids` (regla `isDeclineAction`). Si soy RIVAL → usa el `dispute` existente (no dupliques). Si soy el REGISTRANTE → no aplica (usa cancelar; no lo expongas).
4. **`confirmar.html` — path de CLAIM**: si hay sesión y `teamOf(match, miUid)` es null (no soy jugador) y el match está pending y hay slots dummy → mostrar **"¿Cuál eres?"** listando los dummies (nombre + equipo), **resaltando** el que mejor matchea mi `displayName` de Google. Al elegir uno → `claim(id, slot)` → re-render: ahora soy jugador; si soy del equipo RIVAL muestro **Confirmar**; si soy compañero, mensaje "quedaste asociado; falta que un rival confirme". Mantén intactos los estados actuales (confirmado/disputado/caducado, y el confirm/dispute para quien ya es jugador).
5. **Botón "No jugué / declinar"**: en `confirmar.html` (y opcional en el banner del watcher) para quien YA es jugador y no jugó: compañero→`decline`, rival→`dispute` (con su prompt de razón ya existente).

## FUERA de alcance (NO tocar / dejar para después)
- **Invitados persistentes / guestId / roster de guests / sugerencias retroactivas / merge** → E3c/E4. En E3b los dummies se siguen guardando como `{nombre, equipo}` (sin guestId); NO migres.
- Backend: `functions/`, `firestore.rules` (ya desplegadas), motor de ranking. NO `firebase deploy`.
- Ligas, head-to-head, nav restructure, tableros.
- NO cambiar la lógica de scoring de pádel (ya está) ni el cálculo de ranking.

## Riesgos / cuidados
- **Idempotencia/condiciones de carrera**: dos personas reclamando el mismo slot, o reclamar un slot ya reclamado → usa transacción y revalida dentro (slot sigue dummy; no estoy ya en playerUids). Si falla, mensaje claro.
- **Auto-amistad**: no dupliques solicitudes (revisa `getFriendshipStatus`); que un fallo de amistad NO rompa el claim (best-effort, captura errores).
- La regla exige que el delta de `playerUids` sea EXACTAMENTE tu uid: agrega solo el tuyo (no reordenes ni toques otros).
- Reclamar NO debe tocar `marcador/status/userId/ratingProcessed` (lo bloquea la regla, pero tu patch debe respetarlo).
- `confirmar.html` ya tiene estados; intégralos sin romper el flujo del rival con cuenta (que entra por el path normal, no por claim).
- CRLF/mojibake: cero `�`. Hay JS web sin commitear ajeno (`matches.js`, `ranking.js`, `ranking-read.js`) → NO lo incluyas, aíslalo con `git stash -u`.

## Validaciones (tests reales)
- Lógica pura (Node, si extraes helpers): match-by-name del claim, detección de dummies, equipo del claimer. 
- Sintaxis JS compila (vm/`node --check`).
- Razonamiento de seguridad: tu `claim`/`decline` producen patches que cumplen `isClaimAction`/`isDeclineAction` (delta de playerUids == solo yo; campos acotados). Documenta el patch exacto que envías.
- (Recomendado, pídeselo al maestro) prueba E2E real: registrar con dummy → abrir link con otra cuenta → reclamar → confirmar → el ranking se mueve. El maestro puede sembrar/validar con service account.
- No regresiones en el flujo actual de confirmar/disputar de un rival que YA tiene cuenta.

## Definition of Done
- Registrar con puros dummies funciona (no se traba); copy de la pantalla final actualizado.
- `confirmar.html` permite a un no-jugador reclamar su lugar y (si rival) confirmar; auto-amistad disparada; estados previos intactos.
- "No jugué / declinar" disponible (compañero=decline, rival=dispute).
- `match-actions.js` con `claim` y `decline` nuevos + `register` relajado.
- Commit quirúrgico + push a master siguiendo la convención (commit acotado → `git stash -u` → `fetch` → `rebase origin/master` → `push` → `stash pop`). SIN desplegar Firebase.

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA E3b
### Resumen ejecutivo
### Archivos modificados
### Decisiones técnicas tomadas (con justificación)
### Bugs encontrados
### Riesgos detectados
### Qué quedó pendiente
### Qué validaciones se hicieron (tests reales)
### Resultado (qué quedó funcionando)
### Recomendación al arquitecto maestro (siguiente etapa)
```
