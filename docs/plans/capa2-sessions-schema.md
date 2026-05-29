# Capa 2 — Schema `sessions/` (decisión arquitectónica)

**Fecha**: 2026-05-29
**Status**: PROPUESTA (no implementada en Firestore todavía)
**Contexto**: [[idea-puntazo-modos-juego-capa2]] propone una colección top-level `sessions/{sessionId}` para todo lo que sea sesión de juego social (King of the Court, Americano, Pick-a-finger, futuro torneo). Esta es la decisión madurada después del shipping de [king.html](../../king.html) (E17 MVP, F117).

## Por qué `sessions/` top-level y no subcollections de user

**Caso de uso real**: 1 dispositivo (el organizador) lleva el estado. Pero los demás jugadores quieren:
1. Ver el leaderboard live desde su teléfono.
2. Vincularse a su slot (claim su nombre → uid).
3. Que sus partidos cuenten para su perfil/ranking global.

Si `sessions/` vive como subcollection `users/{organizador}/sessions/`, los otros jugadores NO pueden suscribirse sin que el organizador les dé link específico + ellos lean docs de otro user. Las reglas se complican (need cross-user read with claim verification).

`sessions/{sessionId}` top-level resuelve esto: cualquiera con link/QR puede leer. Reglas simples: read public, write con claim.

## Schema propuesto

```
sessions/{sessionId} {
  type: "king" | "americano" | "torneo5" | "pickfinger" | "torneo",
  status: "active" | "ended" | "cancelled",
  ownerUid: string,                   // quien creó la sesión

  // Identificación (opcional, sesión puede ser libre)
  loc: string?,                        // club id si aplica
  can: string?,                        // cancha si aplica

  // Config del modo (forma libre por tipo)
  config: {
    // Para king: { target: 3, variant: "classic" }
    // Para americano: { rounds: 8, mini: 16 }
    // Para torneo5: { v: 2 } (compatible con torneo5.html actual)
  },

  // Jugadores: igual que en matches/{matchId}.jugadores
  // Algunos son uid-bound (claimed), otros son strings sueltos.
  jugadores: [
    { idx: 0, nombre: "Isaac", uid: "abc123" },
    { idx: 1, nombre: "Pedro" }
  ],

  // Estado del modo (forma libre por tipo)
  state: {
    // Lo que cada modo necesite (cola, scores, matches[], leaderboard).
    // Puede ser denormalizado para que reads sean cheap.
  },

  // Referencias a matches/{matchId} canónicos (cuando se quiere alimentar
  // a Glicko-2 + perfil). Cada mini-partido importante se duplica en
  // matches/ con sessionId apuntando aquí.
  matches: [matchId, matchId, ...],

  // Timestamps
  startedAt: timestamp,
  endedAt: timestamp?,
  updatedAt: timestamp,

  // Sync metadata (para conflict resolution multi-device, ver §Decisiones)
  _updatedAtMs: number,                // client time, opcional
}

sessions/{sessionId}/claims/{claimUid} {
  // Mismo patrón que matches/{matchId}/claims/{claimUid}
  uid: string,
  slot: number,
  claimedAt: timestamp,
}
```

## Modificaciones a `matches/{matchId}` (aditivas)

```
matches/{matchId} {
  ... (todo lo existente) ...
  sessionId?: string,        // NUEVO: link a sesión origen (King of Court mini-partido, americano round, etc.)
  sourceMode?: string,       // NUEVO: "king" | "americano" | "torneo5" — para que Glicko-2 sepa diferenciar
}
```

Esto permite que cuando un mini-partido de King of the Court se quiere "promover" a partido oficial (para Glicko-2), se cree un doc en `matches/` con `sessionId` apuntando a la sesión, y todo el ranking pipeline existente lo ve sin cambio.

## Reglas Firestore (propuestas)

Agregar dentro de `match /databases/{database}/documents` (después del bloque `matches/`):

```firestore
// ════════════════════════════════════════════════════
// Capa 2 — Sessions (modos de juego sociales)
// ════════════════════════════════════════════════════
match /sessions/{sessionId} {
  allow read: if true;

  // Create: cualquiera logueado puede crear una sesión.
  allow create: if signedIn()
                && request.resource.data.ownerUid == request.auth.uid
                && request.resource.data.status == "active"
                && request.resource.data.type in ["king", "americano", "torneo5", "pickfinger", "torneo"]
                && request.resource.data.startedAt == request.time;

  // Update: el owner SIEMPRE puede. Invitados con slot uid-bound pueden
  // actualizar SOLO ['jugadores', 'state', 'updatedAt', '_updatedAtMs']
  // (mismo patrón que matches/ para que validación bilateral del score funcione).
  allow update: if signedIn()
                && fieldUnchanged('ownerUid')
                && fieldUnchanged('type')
                && fieldUnchanged('startedAt')
                && (
                  request.auth.uid == resource.data.ownerUid
                  || request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['jugadores', 'state', 'updatedAt', '_updatedAtMs'])
                );

  allow delete: if signedIn() && request.auth.uid == resource.data.ownerUid;

  // Claims (mismo patrón que matches/{matchId}/claims)
  match /claims/{claimUid} {
    allow read: if true;
    allow create, update: if signedIn()
                  && request.auth.uid == claimUid
                  && request.resource.data.slot is int;
    allow delete: if signedIn() && (
      request.auth.uid == claimUid
      || request.auth.uid == get(/databases/$(database)/documents/sessions/$(sessionId)).data.ownerUid
    );
  }
}
```

NO se publica en F114/F115/F117. Se publicará cuando se decida implementar King of the Court con sync cloud (E17.5).

## Decisiones macro pendientes

### 1. ¿Migrar Torneo 5 (`users/{uid}/torneos5/active`) a `sessions/`?

**Recomendación**: NO migrar. Torneo 5 es single-user (1 organizador lleva todo, los demás no tienen vista propia). El costo de migración (refactor torneo5.html + script de mover docs en Firestore + comunicar a usuarios) supera el beneficio. Si en el futuro Torneo 5 quiere convertirse en sesión multi-user (que cada jugador vea live), se migra entonces.

**Trade-off**: queda como anomalía histórica. Documentar en [[reference-torneo5-arquitectura]].

### 2. ¿Mini-partidos de King of the Court van a `matches/`?

**Opciones**:
- (a) Cada mini-partido (game cerrado en King) crea un doc en `matches/` con `sessionId` y `sourceMode: "king"`. Alimenta Glicko-2 directo.
- (b) Solo el estado agregado se guarda en `sessions/{sid}.state`. Si Glicko-2 lo necesita, parsea `state` cliente o Cloud Function.

**Recomendación (a)**: simétrico con el resto del sistema. Glicko-2 ya tiene plumbing para `matches/`. King session se vuelve "sesión madre" + N matches hijos.

**Costo**: cada game cerrado en King escribe a `matches/`. Si la sesión dura 90 min con 12 jugadores rotando, son ~30 escrituras. Firestore puede manejarlo.

**Cuándo**: NO al MVP de King (king.html actual es 100% local, sin Firestore). Cuando E20 Glicko-2 entre, se agrega el write a matches/ en parallelo al local state.

### 3. ¿Snapshot live multi-device para King?

Caso: organizador con tablet en mesa, jugadores con teléfono viendo cola + leaderboard.

**Opciones**:
- (a) Solo cloud sync passive (igual que Torneo 5): organizador escribe, otros leen via `onSnapshot` a `sessions/{sid}`.
- (b) Multi-write con CRDT: cualquier jugador puede registrar resultado de su mini-partido.

**Recomendación (a)** al MVP. (b) abre puertas a conflictos sin valor probado.

### 4. Esquema `state` por tipo — ¿strict union o forma libre?

**Opciones**:
- (a) Forma libre: `state` es un object opaco, cada modo cliente lo interpreta.
- (b) Strict per type: validar en reglas que `state` cumple shape específico por `type`.

**Recomendación (a)** para velocidad de iteración. Strict validation post-MVP si surge problema real.

## Roadmap concreto

| Fase | Scope | Pre-req |
|------|-------|---------|
| **F117 (HECHO)** | King of the Court standalone (local-only, sin Firestore) | — |
| **F118** | Pick-a-finger V1 (sortear parejas, botón sortear, local) | — |
| **F119** | King multi-device cloud sync (read-only para no-owner) | Reglas `sessions/` desplegadas |
| **F120** | Americano standalone (local-only) | — |
| **F121** | Americano cloud sync | — |
| **F122** | Mini-partidos King → escribir a `matches/` con `sessionId` | F119 + integración matches |
| **F123** | Glicko-2 Cloud Function (E20) — lee `matches/` con `sourceMode` | F122 |
| **F124** | Grupos / ligas — `groups/{gid}/sessions[]` aggregator | F123 |

F118-F124 son grandes; cada uno es probablemente 1 worker dedicado (1-3 días).

## Lo que F117 deja preparado

[king.html](../../king.html) está construido con shape compatible con `sessions/{sid}` futuro:
- `S.players[]` con `{ name, gp, gw }` mapea directo a `jugadores[]` + leaderboard.
- `S.target`, `S.court[4]`, `S.queue[]` van a `state.*`.
- `S.gameNum` va a `state.gameNum`.

Cuando F119 entre, basta envolver `save()` con un `cloudSyncDebounced()` análogo al de Torneo 5 + agregar `subscribe()` para no-owner. El refactor es chico.
