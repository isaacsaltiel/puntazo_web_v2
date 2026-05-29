# Torneo 5 — decisiones de integración (F114)

**Fecha**: 2026-05-29
**Contexto**: Otra sesión shipeó Torneo 5 (F109-F113) y dejó 9 decisiones de arquitectura para la sesión maestra. Este doc registra qué se decidió y por qué.

## Resumen de cambios F114

- Regla Firestore `torneos5/` integrada en bloque `users/{uid}` de [firestore-rules-v100-fase3.md](firestore-rules-v100-fase3.md). Bloque standalone original ([firestore-rules-torneo5.md](firestore-rules-torneo5.md)) marcado SUPERSEDED.
- Botón "Inicia sesión" inline en el welcome de [torneo5.html](../../torneo5.html) (en lugar de "ve a otra página"). Reusa `PuntazoAuth.signIn()` que ya carga torneo5. No se mete header.js → se respeta el diseño inmersivo.
- `puntazo:auth-changed` listener ahora re-renderiza siempre, para que el botón de sign-in desaparezca al loguearse aunque el cloud no haya cambiado nada.

## Decisiones (las 9 que dejó pendientes la otra sesión)

### 3.1 Choque con users/{uid} Fase 3.C — RESUELTO

**Decisión**: integrar dentro del bloque `users/{uid}` ya existente, como una subcollection más junto a `recentPlayers/` y `notifications/`. Una sola fuente de verdad de reglas para el namespace `users/`.

**Por qué**: las reglas de v100 Fase 3 son el set canónico. Tener un bloque separado para Torneo 5 crearía dos lugares donde tocar al modificar `users/{uid}` y abre la puerta a inconsistencias.

### 3.2 Choque con sessions/{sessionId} de Capa 2 — NO MIGRAR

**Decisión**: Torneo 5 se queda en `users/{uid}/torneos5/active`. NO se migra a `sessions/`.

**Por qué**: Torneo 5 es feature single-user (1 user = 1 torneo activo, dato personal, sin compartir). `sessions/` top-level (planeado para Capa 2 / King of Court / Americano) será para sesiones multi-user compartidas con leaderboard global. Son casos distintos. Torneo 5 cabe mejor scoped por usuario. Cuando llegue Capa 2 (E17+), `sessions/` se crea como colección nueva sin tocar Torneo 5.

**Trade-off aceptado**: si en el futuro Glicko-2 (E20) quiere alimentarse con resultados de Torneo 5, tendrá que parsear `users/{uid}/torneos5/active.matches[]` (no triggable como collectionGroup eficiente). Para una feature opcional de ranking eso es aceptable; si llega a ser cuello de botella, se duplican los matches a `matches/` con flag `sourceMode: "torneo5"`.

### 3.3 Naming `torneos5` mezcla idiomas — DEUDA ACEPTADA

**Decisión**: dejar `torneos5`. No renombrar.

**Por qué**: ya está vivo en producción con datos. El costo de migración (refactor torneo5.html + script de mover docs en Firestore + comunicar a usuarios) supera el beneficio de naming coherente. Cuando llegue Capa 2 y se cree `sessions/`, evaluaremos si vale consolidar todo allí con `type: "torneo5"`. Por ahora, deuda documentada.

### 3.4 Historial de torneos pasados — NO POR AHORA

**Decisión**: mantener docId fijo `"active"`, sin historial. Al "Jugar otro" o "Abandonar" se borra y arranca limpio.

**Por qué**: nadie lo ha pedido. Si Isaac luego quiere ver torneos anteriores, basta cambiar el docId de `"active"` a un timestamp y agregar una lista en perfil. Sin cambio de reglas (la regla actual `torneos5/{docId}` ya acepta cualquier docId).

### 3.5 bgPhoto solo local — SE QUEDA LOCAL

**Decisión**: bgPhoto NO sube a Firestore ni a Storage. Solo localStorage.

**Por qué**: subir a Firestore choca con límite de 1MB/doc (un dataURL grande lo revienta). Subir a Storage requiere agregar Firebase Storage SDK + setup de reglas + manejo de blob upload. Es trabajo significativo (~30+ líneas + reglas + test) para una foto de fondo opcional. El usuario solo pierde la foto si cambia de dispositivo — degrada bien (sigue funcionando, foto custom se restablece eligiendo una nueva).

### 3.6 Vinculación jugador → uid — NO IMPLEMENTAR

**Decisión**: respetar la instrucción original de Isaac de "módulo paralelo, no lo mezcles". Los jugadores siguen siendo `{idx, name}` sin uid.

**Por qué**: Torneo 5 funciona casual entre 5 personas que comparten un torneo via un solo dispositivo (el del organizador). No tiene caso pedirles login a los 5. Si en el futuro se quiere alimentar a Glicko-2 (E20), eso requeriría primero resolver Capa 2 completa con `sessions/` compartidas multi-user — y para ese caso Torneo 5 ya no aplica como módulo standalone, sería un modo más dentro de `sessions/`.

### 3.7 Login desde torneo5.html — BOTÓN INLINE EN WELCOME

**Decisión**: agregar botón "Iniciar sesión" inline en la nota del welcome, que llama `PuntazoAuth.signIn()`. NO meter header.js (rompería el diseño inmersivo).

**Por qué**: header.js es la nav global con muchos estilos. Insertarla en torneo5 sumaría peso visual y rompe la sensación de modo de juego standalone. Lo mínimo viable es habilitar el sign-in en el único lugar donde la falta de sesión es fricción real (el welcome cuando ya hay progreso y se quiere portabilidad). Para sign-out, el usuario va a otra página — uso poco frecuente.

### 3.8 Conflict resolution (`_updatedAtMs` con client time) — DEUDA ACEPTADA

**Decisión**: dejar como está. No urge.

**Por qué**: el caso de uso real es 1 dispositivo + refresh/cierre. Multi-device colaborativo (los 5 jugadores con la app abierta al mismo tiempo escribiendo) NO es el flujo planeado — Torneo 5 está pensado para que el organizador lleve el marcador desde un solo dispositivo. Si llegáramos ahí, habría que implementar conflict resolution con `serverTimestamp()` y batched writes — trabajo significativo sin caso de uso comprobado.

### 3.9 Numeración F## — F114

**Decisión**: este commit de integración es F114.

**Por qué**: F108 (fix sets trim), F109 (Torneo 5 reasignada de "fix vinculación" a "torneo 5"), F110 (fix vinculación movido aquí), F111 (selector visual encontrar clip + fondos lado/boton), F112 (dictado fase 5 herramientas), F113 (cloud sync Torneo 5). Siguiente número libre.

## Lo que NO se hizo y por qué

- **NO se probaron los 7 escenarios E2E** del hand-off. Requieren browser real con cuenta de Firebase logueada y reglas desplegadas. Solo se verificó que el código de `syncAfterAuthChange` y el listener de `puntazo:auth-changed` son consistentes, y se reforzó el re-render post-auth para que el botón inline funcione visualmente.
- **NO se migró `bgPhoto` a Storage** (3.5 aceptado como deuda).
- **NO se renombró colección** (3.3 aceptado como deuda).
- **NO se agregó historial** (3.4 aceptado).
- **NO se agregó vinculación jugador→uid** (3.6 aceptado).
- **NO se metió header.js** (3.7 aceptado).
- **NO se ajustó conflict resolution** (3.8 aceptado).

## Acción pendiente para Isaac

1. **Re-pegar** [firestore-rules-v100-fase3.md](firestore-rules-v100-fase3.md) (bloque completo) en Firebase Console → Firestore → Rules → Publicar. Ahora incluye `torneos5/`.
2. Si quieres validar que el sign-in inline funciona: entra a `/torneo5.html` deslogueado, juega 1 match, dale "Continuar →" (creará welcome al refrescar), refresca, en el welcome aparece botón "Inicia sesión". Click → Google sign-in popup → al volver, botón desaparece y el doc empieza a sincronizar a `users/{tu uid}/torneos5/active`.
