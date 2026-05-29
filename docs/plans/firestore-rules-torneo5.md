# Firestore rules — Torneo 5 (F113)

**Fecha**: 2026-05-29
**Para pegar en**: Firebase Console → puntazo-clips → Firestore → Rules
**Bloque a agregar**: dentro de `match /databases/{database}/documents`

## Regla nueva (agregar antes del catch-all `/{document=**}`)

```firestore
// ═══════════════════════════════════════════════════════════
// F113 · Torneo 5 jugadores — persistencia por usuario
// El doc fijo "active" guarda el torneo en curso del usuario.
// Si quiere historial en el futuro, basta con crear otros docId.
// ═══════════════════════════════════════════════════════════
match /users/{uid}/torneos5/{docId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

**Por qué tan permisivo**: el subpath ya está scoped por `{uid}`. Solo el dueño puede leer/escribir lo suyo. No hay riesgo de cross-user, no necesita validación de schema en este nivel.

## Schema del doc

```js
users/{uid}/torneos5/active {
  // Game state (mismo que localStorage `pz.torneo5.activo.v2`)
  v: 2,
  startedAt: 1717100000000,
  shuffled: true,
  players: [
    { idx: 0, name: "Isaac", pg: 1, pp: 0, gf: 6, gc: 3, pts: 3 },
    ...
  ],
  matches: [
    { scoreA: 6, scoreB: 3, finishedAt: 1717100100000 },
    null, null, null, null
  ],
  order: [0, 1, 2, 3, 4],
  current: 1,
  view: "between",
  bgPhoto: null,    // SIEMPRE null en cloud (foto se queda local)

  // Metadata cloud
  userId: "abc123",
  _updatedAtMs: 1717100100000,                     // client time (para comparar)
  updatedAt: <serverTimestamp>,                    // fuente de verdad servidor
}
```

## Verificación post-deploy

1. Logueado en puntazoclips.com con tu cuenta.
2. Ir a `/torneo5.html`.
3. Meter 5 nombres y jugar M1 (6-3).
4. En DevTools → Application → IndexedDB → `firestoreClientPersistence` (o consultar consola Firebase): debe aparecer un doc en `users/<tu uid>/torneos5/active`.
5. Refrescar página con Ctrl+Shift+R (limpia caché y localStorage de la pestaña incluso).
6. La página `/torneo5.html` debe mostrar pantalla "Continuar torneo" con el match jugado intacto.
7. Click "Continuar →" debe llevarte a la vista exacta donde te quedaste.

## Notas de implementación

- **bgPhoto** queda excluido del sync porque puede ser un dataURL de 500KB+ y Firestore corta en 1MB/doc. La foto solo vive en localStorage. Si pierdes el localStorage (cambias de dispositivo), el torneo se recupera pero la foto de fondo arranca limpia.
- **Debounce 1500ms** entre escrituras al cloud para no saturar (cada incremento del stepper, cada movimiento en el modal, cada cambio de input no debería disparar una escritura).
- **Sin user**: torneo5 sigue funcionando solo con localStorage. El cloud sync es enhancement, no requisito.
- **Conflict resolution**: comparación por `_updatedAtMs` (client time). El más nuevo gana. No hay merge fino — un torneo es un torneo, gana el último guardado.
- **Cleanup**: cuando el usuario elige "Jugar otro Torneo 5" o "Abandonar", se ejecuta `cloudClear()` (delete del doc). El doc del torneo terminado NO se mueve a historial — feature futura si Isaac lo pide.

## Si hay error al pegar

Si la consola Firebase rechaza con sintaxis inválida, lo más probable es que copié algún caracter raro. La regla compila si pega tal cual está en el bloque ```firestore arriba.
