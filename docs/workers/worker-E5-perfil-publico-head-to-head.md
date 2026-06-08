# Worker #2 — ETAPA E5: Perfil público de jugador + Head-to-Head

## Título de etapa
E5 — Página de perfil público de cualquier jugador (`jugador.html?uid=`) con sección **Head-to-Head** (historial de enfrentamientos entre el que mira y ese jugador), y enlazar las filas del tablero a ella.

## Objetivo
Hoy no existe forma de ver el perfil de OTRO jugador. Crear:
1. `jugador.html?uid=<uid>` — vista pública read-only de cualquier jugador: foto, nombre/@handle, **nivel global (1.0–7.0)**, V/D, "calibrando".
2. Dentro de esa página, si el que mira está logueado y NO es ese jugador: **Head-to-Head** — los partidos confirmados donde ambos jugaron, con marcador por partido y **totales**: victorias de cada uno (entre ustedes), **games** totales de cada uno y **sets** totales de cada uno, distinguiendo cuando fueron **rivales** vs **compañeros**.
3. Enlazar las filas de `clasificacion.html` a `jugador.html?uid=` (punto de entrada).

Frontend solo-lectura. NO se calcula ranking ni se toca backend.

## Contexto
Ranking server-authoritative ya LIVE. Lecturas relevantes (reglas: `matches` lectura pública; `ratings` lectura `signedIn`):
- `ratings/{uid}` = `{ uid, displayName, byContext: { "global:padel": {nivel, rating, reliability, wins, losses, matchCount, isCalibrating}, ... } }`.
- Perfil/identidad: `window.PuntazoIdentity.getProfile(uid)` → `{uid, displayName, handle, photoURL, ...}`.
- `matches/{id}` = `{ jugadores:[{nombre, equipo:"team1"|"team2", uid|null}], marcador:{sets:[{team1,team2}], ganador:"team1"|"team2"}, playerUids:[...uids reales...], status, deporte, endedAt, createdAt }`.

**Cómo sacar el Head-to-Head** (el que mira está logueado = `meUid`, mira a `targetUid`):
- Query: `db.collection("matches").where("playerUids","array-contains", meUid).limit(200).get()` (array-contains de un solo campo → NO requiere índice compuesto).
- Filtra client-side: `status === "confirmed"` **y** `playerUids` incluye `targetUid`.
- Por cada match: ubica el `equipo` de `meUid` y de `targetUid` en `jugadores`.
  - **Rivales** si están en equipos distintos; **compañeros** si en el mismo.
  - Ganador del partido = `marcador.ganador`. Suma victoria a quien corresponda (en modo rivales, gana el equipo del ganador; cuenta para el que estuvo en ese equipo).
  - **Games** de cada quien = suma de games de SU equipo en todos los sets. **Sets** de cada quien = sets ganados por su equipo.
  - Acumula totales: V de me / V de target (head-to-head, solo cuando fueron rivales), games me/target, sets me/target. (Cuando fueron compañeros, no hay "victoria entre ustedes"; cuéntalo aparte como "jugaron juntos: N, ganaron X".)

## Arquitectura / convenciones del repo
- Web estática (GitHub Pages, deploy = push a master). JS del navegador habla directo con Firestore (SDK compat v9.23.0).
- **Usa `clasificacion.html` como plantilla de referencia** (recién creada en E1): mismo sistema de diseño (`assets/estilo.css`, Montserrat, tokens `--blue/--blue2/--card/--border/--muted`), mismo patrón de auth (`puntazo:auth-ready/changed`, `PuntazoAuth`, `PuntazoFirebase.db()`), y su mapeo **nivel→emoji de bucket** (replícalo igual para consistencia visual; está inline en clasificacion.html).
- Shell: `<div id="nav-root" data-nav-variant="internal"></div>` + `assets/header.js`. Orden scripts: firebase compat → firebase-core → auth → identity → (lo tuyo) → header.

## Archivos a LEER primero
- `clasificacion.html` (plantilla principal: estilo + auth + bucket emoji + render de jugadores).
- `perfil.html` (cómo muestra el nivel propio + estructura; NO lo conviertas en multi-uid, solo referencia).
- `assets/identity.js` (`getProfile`, `searchUsers`), `assets/header.js`, `assets/estilo.css`.

## Alcance (SOLO esto)
1. `jugador.html?uid=<uid>` nueva: header del jugador (foto/nombre/@handle/nivel global/V-D/calibrando) + sección Head-to-Head (si logueado y distinto). Estados: sin `uid` → mensaje; jugador inexistente → mensaje; sin partidos en común → "Aún no se han enfrentado"; deslogueado → muestra el header público pero el H2H pide login.
2. Si `uid` == el del que mira → ofrece ir a `/perfil.html` (es tu propio perfil).
3. En `clasificacion.html`: cada fila linkea a `jugador.html?uid=<uid>` (sin romper el resaltado de fila propia ni el orden).

## FUERA de alcance (NO tocar)
- Backend: `functions/`, `firestore.rules`, `firebase.json`. Motor: `assets/ranking*.js`, `assets/matches.js`, `match-actions/confirmation`. Flujos registrar/confirmar. Ligas/claiming/dummies. Nav restructure (header.js). NO desplegar Firebase ni cambiar reglas.
- NO agregar botón de "amigo" aquí (eso vive en amigos.html) — mantén el scope en perfil+H2H.

## Riesgos / cuidados
- **Datos escasos en prod** (pocos partidos confirmados → H2H casi siempre vacío). Construye contra el schema y maneja vacío con gracia. Si necesitas datos de prueba, pídeselos al maestro (siembra con service account y borra).
- `array-contains` necesita el `meUid` (logueado); si no hay login, el H2H no corre (muestra CTA). El header del jugador sí puede leerse logueado (ratings = signedIn).
- Cuidado con la lógica de equipos: un mismo par pudo ser rival un día y compañero otro — sepáralo.
- `displayName` puede venir vacío → fallback handle/uid corto. Foto puede faltar → placeholder.
- CRLF/mojibake: cero `�`, EOL consistente.
- No regresiones en `clasificacion.html` al añadir los links.

## Validaciones (tests reales)
- `jugador.html?uid=<uid real>` logueado: header correcto (nivel, V/D, emoji bucket) contra datos reales; H2H suma correcta vs los matches reales (verifica games/sets/victorias a mano con 1-2 partidos).
- Distinción rivales vs compañeros correcta en al menos un caso.
- Self-view (`uid` propio) → redirige/ofrece /perfil.html.
- Sin login → header visible o CTA; H2H pide login; sin errores de consola.
- Filas de `clasificacion.html` navegan a la página correcta.
- Sintaxis JS compila; cero mojibake.

## Definition of Done
- `jugador.html` LIVE: perfil público + Head-to-Head con totales correctos (V/games/sets, rivales vs compañeros), estados vacío/login/inexistente cubiertos.
- `clasificacion.html` enlaza filas a la página del jugador, sin romper E1.
- Respeta diseño (Montserrat, tokens, mobile-first), sin regresiones.
- Commit quirúrgico + push a master siguiendo la convención (commit acotado → `git stash -u` → `fetch` → `rebase origin/master` → `push` → `stash pop`), o reportado como "listo para push". OJO: hay JS web sin commitear en el árbol (`matches.js`, `ranking.js`, `ranking-read.js`) que NO son tuyos — NO los incluyas en tu commit; aíslalos con el stash.

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA E5
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
