# Worker #1 — ETAPA E1: Tablero global de ranking + número en perfil

## Título de etapa
E1 — Tablero global de ranking (leaderboard) + mostrar el número de ranking global del usuario en su perfil.

## Objetivo
Hacer VISIBLE el ranking que el backend ya calcula. Dos entregables:
1. Una pantalla de **tablero global** que lista a los jugadores ordenados por su nivel (1.0–7.0), leyendo `leaderboards/global:padel/entries`.
2. En `perfil.html`, mostrar **el número de ranking global del propio usuario** de forma destacada.

Es trabajo de **frontend de solo-lectura**. El motor de ranking ya corre en producción; NO se calcula nada aquí, solo se lee y se pinta.

## Contexto
Puntazo tiene un ranking server-authoritative (Cloud Function Glicko-2, ya LIVE). Cuando se confirma un partido, la función escribe:
- `ratings/{uid}` = `{ uid, displayName, byContext: { "global:padel": {nivel, rating, reliability, wins, losses, matchCount, isCalibrating}, "club:{loc}:padel": {...}, "group:{groupId}:padel": {...} } }`
- `leaderboards/{ctx}/entries/{uid}` = `{ uid, displayName, nivel, rating, reliability, wins, losses, matchCount, isCalibrating, updatedAt }` donde `ctx` es p.ej. `"global:padel"`.

`nivel` es la escala pública **1.0–7.0** (mayor = mejor). `isCalibrating: true` = pocos partidos (mostrar como "calibrando"). `matchCount` = partidos contados.

Reglas Firestore (ya deployadas): `ratings` y `leaderboards` son **lectura para cualquier usuario con sesión** (`signedIn`), escritura denegada desde cliente. → El tablero **requiere login**.

## Arquitectura relevante / cómo se hace en este repo
- Web estática servida por **GitHub Pages** (deploy = push a `master`). El JS del navegador habla **directo con Firestore** (SDK compat v9.23.0).
- **Sistema de diseño**: `assets/estilo.css` (tokens CSS: `--blue #004FC8`, `--blue2 #0B7CFF`, verde pelota `#c8e835`, `--card`, `--border`, `--muted`, `--radius`), fuente **Montserrat**. Mira `registrar-min.html` y `confirmar.html` como ejemplos recientes del estilo + del patrón de carga de Firebase.
- **Shell de página**: `<div id="nav-root" data-nav-variant="internal"></div>` + `assets/header.js` inyecta el nav. Auth vía `window.PuntazoAuth` (`currentUser`, `signIn()`, eventos `puntazo:auth-ready` / `puntazo:auth-changed`). Firestore vía `window.PuntazoFirebase.db()`.
- Orden típico de scripts: firebase-app/firestore/auth compat → `assets/firebase-core.js` → `assets/auth.js` → `assets/identity.js` → (lo que ocupes) → `assets/header.js`.
- Query del tablero global: `db.collection("leaderboards").doc("global:padel").collection("entries").orderBy("nivel","desc").limit(100).get()`. (orderBy de campo único → índice automático; si Firestore pide índice, sigue el link del error.)
- El número del propio usuario: léelo de su entry `leaderboards/global:padel/entries/{miUid}` o de `ratings/{miUid}.byContext["global:padel"].nivel`.

## Archivos a LEER primero
- `mi-nivel.html` (ya existe una página "Mi nivel" — **entiéndela antes de decidir**: si es el hogar natural del tablero, **mejóralo**; si no, crea `tablero.html`. No la rompas).
- `perfil.html` (ahí va el número del usuario; mira cómo carga auth/firestore y su estructura).
- `assets/header.js`, `assets/auth.js`, `assets/identity.js` (globals disponibles).
- `assets/estilo.css` (tokens y clases utilitarias).
- `registrar-min.html` y `confirmar.html` (ejemplos del estilo + patrón Firebase compat + manejo de login/gate).

## Alcance (SOLO esto)
1. **Tablero global**: página (mejorar `mi-nivel.html` o nueva `tablero.html`) que:
   - Requiere sesión (si no hay, muestra CTA de login, no rompe).
   - Lista entries de `leaderboards/global:padel/entries` ordenadas por `nivel` desc.
   - Por fila: posición (#), nombre (displayName; fallback handle/uid corto), **nivel** (2 decimales), W/L (`wins`-`losses`), y marca "calibrando" si `isCalibrating`.
   - **Resalta la fila del usuario actual.**
   - Estado vacío decente ("aún no hay partidos rankeados").
2. **Número en perfil**: en `perfil.html`, bloque destacado con el **nivel global** del usuario (ej. "Tu nivel: 3.52"), con fallback elegante si aún no tiene (sin partidos → "Juega y confirma un partido para tener tu nivel").

Puedes añadir un enlace de entrada al tablero desde `mi-nivel.html`/`perfil.html` si es natural, pero **no reestructures el nav** (eso es otra etapa).

## FUERA de alcance (NO tocar)
- Nada de backend: `functions/`, `firestore.rules`, `firebase.json`, `firestore.indexes.json`.
- El motor de ranking: `assets/ranking.js`, `assets/ranking-read.js`, `assets/matches.js`, `assets/match-actions.js`, `assets/match-confirmation.js`.
- Flujo de registro/confirmación: `registrar-min.html`, `registrar.html`, `confirmar.html` (solo léelos como referencia).
- Ligas, claiming, dummies, head-to-head, nav restructure → otras etapas.
- NO cambiar reglas ni desplegar nada de Firebase.

## Riesgos / cuidados
- **El leaderboard de producción puede estar casi vacío** (pocos partidos confirmados aún). Construye contra el SCHEMA y prueba el **estado vacío** + un estado poblado. Si necesitas datos de prueba, **pídeselos al maestro** (puede sembrar 3–4 entries demo con la service account y borrarlas después). No siembres tú producción.
- Lectura requiere login → maneja logout sin romper.
- `displayName` puede venir vacío → fallback a handle/uid corto.
- Cuidado con **CRLF** y caracteres corruptos (mojibake) en los `.html` (el repo mezcla EOL). Verifica que no introduces `�`.
- No regresiones en `perfil.html` (es página pesada y central).

## Validaciones (tests reales)
- Logueado: el tablero carga, ordena por nivel desc, resalta tu fila, muestra W/L y "calibrando".
- `perfil.html`: aparece tu número global destacado; sin partidos → mensaje de fallback.
- Deslogueado: CTA de login, sin errores de consola.
- Consola del navegador sin errores; features existentes de `perfil.html` intactas.
- Verificación de sintaxis de los `<script>` (compila) y cero mojibake.

## Definition of Done
- Tablero global funcional leyendo `leaderboards/global:padel/entries`, con fila propia resaltada y estados vacío/login.
- `perfil.html` muestra el nivel global del usuario, con fallback.
- Respeta el sistema de diseño (Montserrat, tokens, mobile-first) y no rompe nada existente.
- Cambios commiteados de forma quirúrgica y pusheados a `master` (GitHub Pages) siguiendo la convención del repo (commit acotado → `git stash` → `fetch` → `rebase origin/master` → `push` → `stash pop`), o reportados como "listos para push" si no tienes permiso.

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA E1
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
