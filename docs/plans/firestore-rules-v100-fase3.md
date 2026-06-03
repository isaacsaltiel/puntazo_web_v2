# Reglas Firestore — v100 Fase 3 (Sub-fases A → H)

> **Para Isaac**: este es el bloque COMPLETO de reglas que debes pegar
> en Firebase Console → Firestore → Rules. **Reemplaza** todo lo que
> tienes ahora con este bloque. Mantiene compatibilidad con lo anterior
> + agrega lo nuevo de Fase 3.
>
> Después de pegar, dale **Publicar**.

> **⚠️ ACTUALIZADO 2026-05-29 (F96)**: el set que pegaste antes tenía
> un bug. La query `collectionGroup('claims')` que usan perfil.html /
> mis-partidos.html / mi-nivel.html devolvía `permission-denied`
> porque el bloque anidado de claims SOLO cubre acceso por path
> explícito, NO collectionGroup. Por eso "Mis partidos" salía vacío
> y "Mi nivel" se quedaba en calculando. Este nuevo bloque agrega
> `match /{path=**}/claims/{claimUid}` y `match /{path=**}/members/{memberUid}`.
> **Re-pega el bloque completo de abajo.**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isMe(uid)  { return signedIn() && request.auth.uid == uid; }

    // ════════════════════════════════════════════════════
    // EXISTENTE — usuarios/{uid} (saved videos legacy)
    // ════════════════════════════════════════════════════
    match /usuarios/{uid} {
      allow read, write: if isMe(uid);
      match /guardados/{videoId} {
        allow read, write: if isMe(uid);
      }
    }

    // ════════════════════════════════════════════════════
    // EXISTENTE — Partidos (Etapa 15 + 15.6 'sin miedo')
    // ════════════════════════════════════════════════════
    match /matches/{matchId} {
      function statusValid(s) {
        return s == "active" || s == "ended" || s == "cancelled";
      }
      function fieldUnchanged(name) {
        return request.resource.data[name] == resource.data[name];
      }

      allow read: if true;

      allow create: if request.auth != null
                    && request.resource.data.userId == request.auth.uid
                    && request.resource.data.status == "active"
                    && request.resource.data.startedAt == request.time
                    && request.resource.data.createdAt == request.time
                    && statusValid(request.resource.data.status);

      allow update: if request.auth != null
                    && fieldUnchanged('userId')
                    && fieldUnchanged('loc')
                    && fieldUnchanged('can')
                    && fieldUnchanged('lado')
                    && fieldUnchanged('startedAt')
                    && fieldUnchanged('createdAt')
                    && statusValid(request.resource.data.status)
                    && (
                         resource.data.endedAt == null
                         || request.resource.data.endedAt == resource.data.endedAt
                       )
                    && (
                         request.auth.uid == resource.data.userId
                         ||
                         // F95 BLOQUE 5 (item 7): invitados pueden modificar
                         // jugadores Y scoreAcceptedBy (para aceptación bilateral
                         // del marcador). updatedAt es housekeeping.
                         request.resource.data.diff(resource.data).affectedKeys()
                           .hasOnly(['jugadores', 'updatedAt', 'scoreAcceptedBy'])
                       );

      allow delete: if false;

      // Claims de slot
      match /claims/{claimUid} {
        allow read: if true;

        allow create: if request.auth != null
                      && request.auth.uid == claimUid
                      && request.resource.data.slot in [0, 1, 2, 3]
                      && request.resource.data.claimedAt == request.time;

        allow update: if request.auth != null
                      && request.auth.uid == claimUid
                      && request.resource.data.slot in [0, 1, 2, 3];

        allow delete: if request.auth != null
                      && (
                        request.auth.uid == claimUid
                        || request.auth.uid == get(/databases/$(database)/documents/matches/$(matchId)).data.userId
                      );
      }
    }

    // ════════════════════════════════════════════════════
    // F96 CRITICAL FIX — collectionGroup('claims') para Mis partidos
    // ════════════════════════════════════════════════════
    // El bloque anidado match /matches/{matchId}/claims/{claimUid}
    // SOLO aplica a queries por path explícito. Las queries
    // collectionGroup('claims').where('uid','==',myUid) usadas en
    // perfil.html, mis-partidos.html y mi-nivel.html requieren UN
    // BLOQUE SEPARADO de collectionGroup. Sin esto: permission-denied
    // y los partidos terminados NUNCA aparecen en Mi Perfil aunque sí
    // estén guardados en Firestore.
    match /{path=**}/claims/{claimUid} {
      allow read: if true;
    }

    // ════════════════════════════════════════════════════
    // EXISTENTE — Estados de clip (R2)
    // ════════════════════════════════════════════════════
    match /clip_states/{clipId} {
      allow read: if true;
      allow write: if false;
    }

    // ════════════════════════════════════════════════════
    // EXISTENTE — Pulsos pendientes desde web (R4)
    // ════════════════════════════════════════════════════
    // R6 (Worker D, 2026-05-29): el listener de la NUC ahora escribe
    // los siguientes campos cuando consume o cierra un doc — sigue
    // bypaseado por el admin SDK, no afecta a reglas, pero documentado
    // para que una futura regla "fields-only" en update NO rompa el
    // listener:
    //   consumed_at, consumed_by, error_reason, processed_video_url
    match /pending_pulses/{pulseId} {
      allow create: if request.resource.data.club is string
                    && request.resource.data.club.size() > 0
                    && request.resource.data.club.size() < 64
                    && request.resource.data.cancha is string
                    && request.resource.data.source is string
                    && request.resource.data.client_pulse_id is string
                    && request.resource.data.consumed_at == null
                    && request.resource.data.consumed_by == null
                    && request.resource.data.created_at == request.time;

      allow read: if request.auth != null
                  && resource.data.uid_creator == request.auth.uid;

      // F130: el dueño de un pulso (uid_creator) puede borrarlo. Cubre
      // el caso "tengo pulsos de prueba colgados, quiero limpiar mi
      // lista" sin requerir admin manual desde Firebase Console.
      // El admin SDK del runner sigue pudiendo borrar bypaseando este check.
      allow delete: if request.auth != null
                    && resource.data.uid_creator == request.auth.uid;

      // Update sigue denegado para clientes (solo admin SDK).
      allow update: if false;
    }

    // ════════════════════════════════════════════════════
    // NUEVO R6 (Worker D, 2026-05-29) — Heartbeat del sistema del club
    // ════════════════════════════════════════════════════
    // Cada NUC escribe un doc por club (id=clubId) cada 30s con su
    // estado vivo: status, lastSeenAt, pendingQueue, nvrConnected,
    // version. La web lo lee para mostrar "sistema offline" cuando
    // lastSeenAt > 5min. Solo el admin SDK del runner escribe — desde
    // cualquier cliente queda denegado.
    match /nuc_heartbeat/{clubId} {
      allow read: if true;
      allow write: if false;
    }

    // ════════════════════════════════════════════════════
    // NUEVO v100 Fase 3.C — Perfiles extendidos users/{uid}
    // ════════════════════════════════════════════════════
    match /users/{uid} {
      // Lectura pública (privacy se aplica client-side a las
      // queries; v1 conservador, futuro: query-level filtering)
      allow read: if true;

      // Create: solo el propio user crea su perfil.
      allow create: if isMe(uid)
                    && request.resource.data.uid == uid;

      // Update: solo el propio user actualiza su perfil.
      // uid es inmutable.
      allow update: if isMe(uid)
                    && request.resource.data.uid == resource.data.uid;

      allow delete: if false;  // soft-delete via flags.isDeleted

      // Subcollection: recentPlayers (autocomplete)
      match /recentPlayers/{otherKey} {
        allow read, write: if isMe(uid);
      }

      // Subcollection: notifications
      match /notifications/{notifId} {
        allow read: if isMe(uid);
        allow create: if false;  // solo SA / Cloud Function (futuro)
        allow update: if isMe(uid)
                      && request.resource.data.diff(resource.data).affectedKeys()
                         .hasOnly(['read','readAt']);
        allow delete: if isMe(uid);
      }

      // ────────────────────────────────────────────────────
      // F114 — Torneo 5 jugadores (modo de juego standalone)
      // docId="active" guarda el torneo en curso del usuario.
      // Si en el futuro quiere historial, basta crear otros docId
      // sin cambiar reglas. Sub-path ya scoped por {uid}, no hay
      // riesgo cross-user. bgPhoto se queda en localStorage —
      // foto custom puede pasarse del límite 1MB de Firestore.
      // ────────────────────────────────────────────────────
      match /torneos5/{docId} {
        allow read, write: if isMe(uid);
      }
    }

    // ════════════════════════════════════════════════════
    // NUEVO v100 Fase 3.C — Handles únicos
    // ════════════════════════════════════════════════════
    match /handles/{handle} {
      allow read: if true;  // todos pueden verificar disponibilidad

      // Create: solo si el doc no existe y mi uid es el solicitante.
      allow create: if signedIn()
                    && request.resource.data.uid == request.auth.uid
                    && request.resource.data.handle == handle;

      // Update: nadie (handles son inmutables; cambiar handle = delete + create)
      allow update: if false;

      // Delete: solo el dueño del handle.
      allow delete: if signedIn() && resource.data.uid == request.auth.uid;
    }

    // ════════════════════════════════════════════════════
    // NUEVO v100 Fase 3.F — Grupos / Ligas
    // ════════════════════════════════════════════════════
    match /groups/{groupId} {
      allow read: if signedIn();

      // Create: cualquier user logueado puede crear grupos.
      // Debe figurar como creator + admin inicial.
      allow create: if signedIn()
                    && request.resource.data.creatorUid == request.auth.uid
                    && request.resource.data.admins is list
                    && request.auth.uid in request.resource.data.admins
                    && request.resource.data.createdAt == request.time;

      // Update: solo admins del grupo (validamos contra el doc actual).
      allow update: if signedIn()
                    && request.auth.uid in resource.data.admins;

      // Delete: solo el creador original.
      allow delete: if signedIn()
                    && request.auth.uid == resource.data.creatorUid;

      // Members subcollection
      match /members/{memberUid} {
        allow read: if signedIn();

        // Create: tu propio uid (te unes solo) o admin te agrega.
        allow create: if signedIn() && (
          request.auth.uid == memberUid
          || request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.admins
        );

        // Update: tu propio doc o admin
        allow update: if signedIn() && (
          request.auth.uid == memberUid
          || request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.admins
        );

        // Delete: tú mismo (te sales) o admin (te kickea)
        allow delete: if signedIn() && (
          request.auth.uid == memberUid
          || request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.admins
        );
      }
    }

    // F96: collectionGroup('members') para grupos.html "Mis grupos".
    // Sin esto, la query .collectionGroup('members').where('uid','==',myUid)
    // de listMyGroups falla con permission-denied.
    match /{path=**}/members/{memberUid} {
      allow read: if signedIn();
    }

    // ════════════════════════════════════════════════════
    // NUEVO v100 Fase 3.G — Amistades
    // ════════════════════════════════════════════════════
    match /friendships/{friendshipId} {
      allow read: if signedIn() && (
        resource.data.uidA == request.auth.uid
        || resource.data.uidB == request.auth.uid
      );

      // Create: status="pending", requesterUid = yo, y mi uid es A o B.
      allow create: if signedIn()
                    && request.resource.data.status in ["pending", "blocked"]
                    && request.resource.data.requesterUid == request.auth.uid
                    && (
                         request.resource.data.uidA == request.auth.uid
                         || request.resource.data.uidB == request.auth.uid
                       );

      // Update: cualquiera de los dos puede aceptar/rechazar/bloquear.
      allow update: if signedIn()
                    && (
                         resource.data.uidA == request.auth.uid
                         || resource.data.uidB == request.auth.uid
                       )
                    && request.resource.data.status in ["accepted","rejected","blocked"];

      // Delete: cualquiera de los dos puede borrar (unfriend / unblock).
      allow delete: if signedIn() && (
        resource.data.uidA == request.auth.uid
        || resource.data.uidB == request.auth.uid
      );
    }

    // ════════════════════════════════════════════════════
    // RESERVADO PARA FUTURO (Fase 3.B Cloud Function de ranking)
    // Cuando se active, se completan estas reglas:
    //
    // match /ratings/{uid}                    { allow read; allow write: if false; }
    // match /head_to_head/{pairKey}           { allow read: if signedIn(); allow write: if false; }
    // match /groups/{groupId}/rankings/{uid}  { allow read: if signedIn(); allow write: if false; }
    // match /invites/{inviteId}               { ... }
    // match /claim_requests/{reqId}           { ... }
    // match /disputes/{disputeId}             { ... }
    // match /reports/{reportId}               { ... }
    // ════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════
    // NUEVO R8 — Cola de ediciones de clip (render en la nube / GitHub Actions)
    // ════════════════════════════════════════════════════
    // La web encola specs de edición (trim + encuadre dinámico / sacar puntazo
    // de un partido largo). Un workflow en la nube (admin SDK) los procesa con
    // ffmpeg, sube a Dropbox y actualiza status/result. El cliente solo crea y
    // lee SUS propios docs; nunca actualiza (eso es del workflow vía admin SDK).
    match /clip_edits/{editId} {
      allow create: if request.resource.data.kind in ['edit', 'puntazo']
                    && request.resource.data.source_video_id is string
                    && request.resource.data.status == 'pending'
                    && request.resource.data.created_at == request.time;
      allow read: if request.auth != null
                  && resource.data.uid_creator == request.auth.uid;
      allow update, delete: if false;
    }

    // ════════════════════════════════════════════════════
    // Catch-all denegado
    // ════════════════════════════════════════════════════
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## Lo que cambia respecto a tu set actual

**Mantenido tal cual** (no toco):
- `usuarios/{uid}` + `guardados/` (saved videos)
- `matches/` + `claims/`
- `clip_states/`
- `pending_pulses/`

**Agregado nuevo**:
- `users/{uid}` + `recentPlayers/` + `notifications/` + `torneos5/` (F114)
- `handles/{handle}`
- `groups/{groupId}` + `members/`
- `friendships/{friendshipId}`
- `nuc_heartbeat/{clubId}` (R6, Worker D — read público, write solo admin SDK del runner)

**Catch-all**: queda al final (DENY por default para colecciones no listadas).

---

## Validación rápida después de pegar

1. Login a tu cuenta y entra a `/perfil-editar.html` → guarda algún cambio
   → debería persistir sin error de permisos.
2. Crea un grupo en `/grupos.html`.
3. Busca a un amigo por handle en `/amigos.html` y mándale solicitud.

Si algo falla con "permission-denied", la consola del navegador te
dirá qué colección y línea. Reportas y ajustamos.

---

## Índices compuestos que pueden requerirse

Firestore te pedirá estos índices automáticamente la PRIMERA vez que
una query los necesite. Aparece un link en `console.error` del
navegador. Solo 1 click para aprobar:

| Colección | Campos | Para qué |
|---|---|---|
| `pending_pulses` | `uid_creator ASC, created_at DESC` | Mis puntazos pendientes (perfil) |
| `claims` (collectionGroup) | `uid ASC, claimedAt DESC` | Mis partidos (perfil + mis-partidos) — probablemente ya creado |
| `friendships` | `uidA ASC, status ASC` | Lista de amigos (parte 1) |
| `friendships` | `uidB ASC, status ASC` | Lista de amigos (parte 2) |
| `members` (collectionGroup) | `uid ASC` | Mis grupos |

Cuando Firestore lo pida, click → "Crear índice" → esperas 1–3 min.

---

## Pendientes que NO requieren rules nuevas todavía

- **Ranking calculado** (mi-nivel.html) usa colecciones existentes
  (`matches/`, `claims/`). Funciona sin rules nuevas.
- **Autocomplete jugadores** (mi-partido sheets) lee de
  `matches/` + escribe en `users/{uid}/recentPlayers` que ya
  está cubierto.
- **Cloud Function de ranking** cuando llegue: requiere reglas
  para `ratings/{uid}` (write solo SA). Pendiente, no urgente.
