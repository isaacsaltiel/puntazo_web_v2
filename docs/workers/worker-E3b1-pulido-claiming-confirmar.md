# Worker #5 — ETAPA E3b.1: Pulido del loop de claiming/confirmación (UX)

## Título de etapa
E3b.1 — Pulir `confirmar.html` (el flujo de reclamar lugar + confirmar/disputar) para que sea
clarísimo. El loop YA funciona mecánicamente (E3b, reglas E3a LIVE); aquí se arregla la
experiencia, detectada por Isaac probándolo de verdad el 8-jun.

## Contexto (qué pasó en la prueba E2E real)
Isaac registró-vía-siembra un partido pending con 2 jugadores reales (pareja "demo", equipo
team1, ya aceptados) y 2 dummies (team2: "Mateo", "Luis"). Abrió `confirmar.html?id=`, reclamó
el slot de Luis (su uid quedó grabado — el claim FUNCIONA), y luego picó Disputar. La mecánica
fue impecable; la UX lo confundió. Seis hallazgos concretos (todos reales) a continuación.

## Archivos a LEER primero
- `confirmar.html` — la pantalla completa (estados, render, claim path "¿Cuál eres?", confirm/dispute,
  setActions/nav). AQUÍ es casi todo el trabajo.
- `assets/match-actions.js` — `claim/decline/confirm/dispute` (NO cambiar su lógica de datos; sí puedes
  ajustar firmas para pasar el elemento del botón clickeado si ayuda al spinner).
- `assets/match-confirmation.js` — módulo PURO (`teamOf`, `teamUids`, `registrantUid`, STATUS). Si
  necesitas un helper de "quién ganó / mapa equipo→games por set", agrégalo aquí como función pura
  (export dual browser+Node) y testéalo en Node. NO metas lógica de Firestore aquí.
- `assets/estilo.css` y el resto de `confirmar.html` para tokens/estilo consistentes.

## Forma del match (recordatorio)
`matches/{id}` = `{ userId, status, jugadores:[{nombre,equipo:"team1"|"team2",uid?}], playerUids:[],
marcador:{sets:[{team1,team2},...], ganador:"team1"|"team2"}, scoreAcceptedBy:{uid:true}, confirmation }`.
Un dummy = jugador sin `uid`. El viewer logueado puede ser: no-jugador (ve "¿Cuál eres?"), o jugador
(ve confirmar/disputar). El "registrante" auto-aceptó su lado.

## Alcance — los 6 arreglos (SOLO esto)
1. **Bug del spinner en el botón equivocado.** Al reclamar un dummy, la ruedita aparece en otro botón.
   Causa: `loadingBtn` apunta al primer botón, no al clickeado. Arreglo: el spinner debe salir en el
   botón realmente clickeado (pasa el `event.currentTarget`/índice), y **deshabilitar TODOS los botones
   de "¿Cuál eres?"** mientras el claim está en vuelo (evita el doble-claim que confundió a Isaac).
2. **Marcar quién es el viewer.** Cuando el viewer YA es jugador (incl. justo después de reclamar),
   en la lista de jugadores del partido su propio nombre debe ir claramente marcado: **"(tú)"** +
   resaltado visual (mismo patrón de "fila propia" que usa `clasificacion.html`). Que nunca quede duda
   de cuál eres.
3. **Re-render después de reclamar (sin reabrir el link).** Hoy, tras reclamar, la pantalla deja al
   usuario sin avanzar y tuvo que reabrir el link en otra ventana. Arreglo: tras un `claim()` exitoso,
   re-leer el match y **renderizar de una el estado de jugador**: mensaje claro ("Listo, ahora eres
   **Luis** (equipo X). ¿El resultado es correcto?") + los botones Confirmar/Disputar (si es rival) o
   "Quedaste asociado; falta que un rival confirme" (si es compañero). Sin pantallas muertas.
4. **Marcador claro: quién ganó y quién hizo qué.** "3-6 4-6" es ambiguo. Mostrar:
   - una **etiqueta de ganador** (✓/🏆 + "Ganó el equipo de <nombres del team ganador>"), derivada de
     `marcador.ganador`;
   - el marcador **mapeado a equipos**: dos renglones (equipo A / equipo B) con sus games por set, de
     modo que se lea "mi equipo: 6 6 / rival: 3 4". Resaltar el lado del viewer. Compacto, sin saturar.
   Implementa el cómputo como helper PURO en `match-confirmation.js` (p.ej. `summarizeScore(match)` →
   `{winnerTeam, rows:[{team, games:[...], isWinner}], ...}`) y testéalo en Node.
5. **Copy del claim.** Cambiar el texto confuso ("únete/…") por algo directo: encabezado "¿Cuál eres
   tú?" y cada opción como "**Soy <nombre>**" (mostrando su equipo/compañeros para elegir bien). Que se
   entienda que estás diciendo "yo soy esta persona del partido".
6. **Disputar NO debe ser callejón sin salida.** Tras disputar (y en CUALQUIER estado terminal:
   confirmado/disputado/caducado), mostrar un cierre claro + navegación: **"Ver mi ranking →"**
   (`/clasificacion.html` o `/perfil.html`) y **"Ir al inicio"**. Reusar el `setActions(...)` que ya
   existe para el caso confirmado; replicarlo en disputado y demás finales.

## FUERA de alcance (NO tocar)
- Reglas Firestore (LIVE), `functions/`, motor de ranking, scoring de pádel.
- La LÓGICA de datos de `claim/decline/confirm/dispute` en match-actions (los patches Firestore ya
  cumplen las reglas; NO cambiar qué escriben). Solo UX/render + (si hace falta) pasar el botón clickeado.
- Registro (`registrar-min.html`), ligas, head-to-head, nav, invitados persistentes (E3c).
- NO `firebase deploy`. NO sembrar datos (si necesitas un match de prueba, pídeselo al maestro).

## Riesgos / cuidados
- No romper los estados que YA jalan: rival con cuenta que entra por el path normal (no-claim),
  confirmado/caducado/no-encontrado, el banner del watcher.
- El helper de marcador debe tolerar sets faltantes/marcador raro sin romper (degradar con gracia).
- Resaltado "(tú)" solo cuando hay sesión y el viewer es jugador; sin sesión, no.
- CRLF/mojibake: cero `�`. Hay JS web ajeno sin commitear (`matches.js`, `ranking.js`,
  `ranking-read.js`) → NO incluirlo; aislar con `git stash -u`.

## Validaciones (tests reales)
- Helper `summarizeScore` con test Node (varios marcadores: 6-3/6-4 → ganador correcto, mapeo a equipos
  correcto; sets faltantes degradan sin romper).
- `node --check` de los JS; parse de los inline `<script>` de confirmar.html.
- Repaso manual de los 6 flujos: spinner en el botón correcto + botones deshabilitados; "(tú)" marcado;
  re-render tras claim sin reabrir; marcador con ganador claro; copy "Soy X"; disputar con salida.
- (Recomendado, pídeselo al maestro) re-prueba E2E real con el match demo reseteado a pending.
- Cero mojibake; sin regresiones en el flujo del rival con cuenta.

## Definition of Done
- Los 6 arreglos implementados en `confirmar.html` (+ helper puro en `match-confirmation.js` si aplica).
- Sin pantallas muertas; viewer siempre sabe cuál es y puede avanzar/salir.
- Commit quirúrgico + push a master (commit acotado → `git stash -u` → `fetch` → `rebase origin/master`
  → `push` → `stash pop`). SIN desplegar Firebase. NO incluir el JS web ajeno.

## Formato del reporte de regreso (OBLIGATORIO)
```
## REPORTE ETAPA E3b.1
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
