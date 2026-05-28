# Puntazo v100 — Ranking + Social: Diseño Maestro

> **Documento de diseño greenfield.** No existe código previo en este repo
> que implemente ranking o social profundo. Este documento define la
> arquitectura completa de **Puntazo como plataforma**, no solo como
> capturador de clips. Investigado contra Playtomic, UTR, MyTennis,
> PadelMix, Strava. Optimizado para mobile-first, para Firestore como
> backend canónico, y para que NUNCA pierda datos sociales (la regla
> de oro del producto se extiende: nunca perder un pulso, nunca perder
> una identidad, nunca perder un ranking calculado).
>
> Fecha del diseño: **2026-05-28**. Aprobado por Isaac vía dictado del
> 26 de mayo. Implementación por sub-fases en branches separadas para
> no romper lo que ya funciona.

---

## 0. Tabla de contenidos

1. Resumen ejecutivo
2. Visión de producto (qué hace Puntazo diferente)
3. Arquitectura de identidad
4. Motor de ranking (Glicko-2 + extensiones)
5. Grupos y ligas
6. Amigos
7. Invitaciones multi-target
8. Notificaciones
9. Autocomplete y memoria de jugadores recientes
10. Privacy + manejo de cuentas
11. Disputas y edición post-cierre
12. Research: lecciones de otros sistemas
13. Esquema completo de Firestore
14. Reglas Firestore consolidadas
15. Roadmap de implementación
16. Riesgos y mitigaciones
17. Métricas de éxito

---

## 1. Resumen ejecutivo

Puntazo hoy es una herramienta de captura de clips en clubes con cámara
instalada. La meta de v100 es transformarlo en una **plataforma social
de pádel** donde:

- Cada jugador tiene **identidad persistente** que sobrevive cambios de
  device, claim cruzado de partidos viejos, y vinculación con su
  historial.
- Cada partido alimenta un **ranking serio** (Glicko-2 con extensiones)
  visible tanto globalmente como dentro de cada liga/grupo.
- Los jugadores forman **grupos** (liga de amigos, residencial, club) y
  compiten entre sí en rankings privados.
- Se construye una **red social** de pádel: amigos, perfiles públicos,
  head-to-head, invitaciones, notificaciones.
- Los partidos se pueden registrar **con o sin cámaras Puntazo**. Si hay
  cámaras → clips automáticos. Si no → solo marcador. Mismo ranking.

**El diferenciador irrepetible**: solo Puntazo combina **clips
automáticos** + **rotaciones sociales** (americano / rey de la cancha,
Fase 4 futura) + **ranking persistente serio**. Esa intersección es
inalcanzable para los apps existentes porque ninguno controla la
captura física.

---

## 2. Visión de producto

### 2.1 Tres "modos" de uso, una sola plataforma

| Modo | Captura | Ranking | Social | Hoy |
|---|---|---|---|---|
| **Club con Puntazo** | Clips automáticos | Sí | Sí | ✅ |
| **Club sin Puntazo** | Sin clips, solo marcador | Sí | Sí | 🚧 v100 |
| **Cancha pública / casa** | Sin clips, solo marcador | Sí | Sí | 🚧 v100 |

El ranking funciona idéntico en los 3 modos. Lo único que cambia es la
disponibilidad de clips.

### 2.2 Filosofía de identidad

- Un nombre NO es una identidad. "Pedro" puede ser 100 personas.
- Identidad = **uid + displayName**. uid es Firebase Auth (Google o
  anónimo); displayName es lo que el user elige mostrar.
- Cuando Pedro juega su primer partido y otro user (creador del match)
  lo agrega como "Pedro", se crea un **claim pendiente** (string suelto
  sin uid). Cuando el verdadero Pedro hace su cuenta, puede reclamar
  ese slot retroactivamente. El creador autoriza.
- Esto resuelve un problema enorme: el 90% de jugadores no se anotan
  en la app antes de jugar. Los anota el organizador. Después se
  vinculan al ver el resumen.

### 2.3 Filosofía de ranking

- **Glicko-2** (no Elo) porque modela incertidumbre. Tu rating es un
  rango, no un punto. UTR usa lo mismo.
- **Calibración** de 3 partidos antes de bucket oficial. Antes solo
  "🎯 Calibrando…" — evita que un afortunado de 1 win aparezca como
  experto.
- **Conservative rating** para el bucket: penaliza incertidumbre.
  Refleja la verdad ("si pierdes 5 seguidos te bajan rápido si tu RD
  es alto").
- **Margen de victoria** importa: ganar 6-0 sube más que ganar 6-4
  (suave, no exponencial).
- **Decay temporal**: si no juegas 30+ días, RD crece. El sistema
  "olvida" que tenía certeza de tu nivel.
- **Anti-farm**: ganar repetidamente al mismo rival decae 1.0 → 0.5
  → 0.25 (ventana 24h). Sin esto la gente infla su rating contra
  novatos.
- **Audit trail**: cada partido procesado guarda `ratingsBefore` /
  `ratingsAfter`. Si cambia el algoritmo, se reprocesa el histórico.
- **Idempotencia**: re-procesar el mismo partido NO duplica cambios.
  Cada partido tiene `ratingProcessedAt`; si está, no se vuelve a
  procesar.

---

## 3. Arquitectura de identidad

### 3.1 Estados de identidad

Un jugador puede estar en uno de estos estados:

1. **Anónimo sin nombre** (boton.html sin login): solo crea pulses. No
   tiene perfil. No tiene ranking.
2. **Anónimo con nombre suelto en partido** ("Pedro"): aparece en
   `match.jugadores[idx].nombre` sin `uid`. No tiene perfil. Su nombre
   está suelto, no vinculado a ninguna cuenta.
3. **Registrado calibrando** (3 partidos hasta ahora): tiene `uid` +
   `users/{uid}`. Su ranking dice "🎯 Calibrando · 1/3".
4. **Registrado calibrado**: ranking oficial. Bucket emoji activo.
5. **Registrado calibrado + claim retroactivo**: aceptó claims de
   partidos previos donde estaba como nombre suelto. Su ranking
   incorpora esos partidos retroactivamente.

### 3.2 Documento `users/{uid}` (perfil canónico)

```
users/{uid}
{
  uid: "firebase-uid-here",
  displayName: "Isaac Saltiel",           // editable
  realName: "Isaac Saltiel",              // opcional, solo visible amigos
  photoURL: "https://...",                // Firebase Storage o Google
  handle: "isaac",                        // único, lowercase, para deep links
  bio: "",                                // 140 chars max
  homeClub: "BreakPoint",                 // opcional
  createdAt: <Timestamp>,
  lastSeenAt: <Timestamp>,
  authProvider: "google" | "anonymous",   // tipo de cuenta Firebase
  privacy: {
    profile: "public" | "friends" | "private",    // default public
    clips: "public" | "friends" | "private",      // default public
    matches: "public" | "friends" | "private",    // default public
  },
  flags: {
    isBanned: false,
    isVerified: false,                    // verificación por phone
  },
  counts: {
    matches: 0,                           // partidos jugados (cached)
    wins: 0,                              // wins (cached)
    friends: 0,                           // cached
  }
}
```

### 3.3 Claim cruzado retroactivo

**Problema**: usuario nuevo se registra hoy, pero su nombre estaba en
50 partidos previos como string suelto. ¿Cómo se "adueña" de esos?

**Solución**: flujo de **claim cruzado**.

```
Pedro acaba de crear cuenta. Va a "Mis partidos" → vacío.
Va a "Buscar mi nombre en partidos sueltos".
La app busca matches.jugadores[].nombre que matchee "pedro"
fuzzily (Pedro / pedro / Pedrito / etc.) Y donde jugadores[i].uid
sea null.
Le muestra: "Encontramos 18 partidos con tu nombre. Reclámalos
para que cuenten en tu ranking."
Tap "Reclamar todos" → genera un claim_request por cada uno.
El creador del match recibe notificación: "Pedro reclama el slot
de Pedro en tu partido del 12 de mayo. ¿Confirmar?"
Si autoriza → match.jugadores[i].uid = pedro.uid + se dispara
recompute del ranking para ese match.
Si rechaza → el slot queda como nombre suelto, sin uid.
```

**Estructura**:

```
claim_requests/{requestId}
{
  matchId: "match-abc",
  slotIdx: 1,                             // posición en match.jugadores
  slotName: "Pedro",                      // nombre suelto que se reclama
  requesterUid: "uid-of-pedro",
  requesterDisplayName: "Pedro Sanchez",
  status: "pending" | "approved" | "rejected" | "expired",
  createdAt: <Timestamp>,
  resolvedAt: <Timestamp>,
  resolvedBy: "uid-del-creador",          // o auto si expira
  ownerUid: "uid-del-creador-del-match",  // copiado para acceso fácil
  matchDate: <Timestamp>,                 // para mostrar en notif
}
```

**Auto-aprobación opcional**: si la similitud del nombre es >85% Y el
match es de hace >7 días Y el creador no responde en 7 días, se
auto-aprueba (con audit log).

### 3.4 Prevención de impersonación

- **Google sign-in obligatorio para reclamos** (el slot suelto solo
  puede ser reclamado por uid de provider != "anonymous").
- **Verificación por phone opcional** para users con >20 claims
  aprobados (badge "Verificado").
- **Rate limit**: max 50 claim_requests por uid por semana.
- **Notificación al creador** siempre (no se aprueba sin su click,
  excepto auto-approval con condiciones estrictas).

### 3.5 Account merge

Caso: user empezó anónimo, jugó 10 partidos, después se logueó con
Google y tiene una segunda cuenta vacía. Quiere unirlas.

```
Account settings → Vincular cuenta anónima
Pega el código QR / link del device viejo
La cuenta anónima se "absorve" en la cuenta Google:
  - Todos sus matches/claims/ratings se reasignan al uid Google
  - Cuenta anónima queda marcada deleted_merged
  - Audit log: from_uid → into_uid
```

Implementación: Cloud Function (no se puede hacer client-side por
permissions cross-uid).

---

## 4. Motor de ranking — Glicko-2 + extensiones

### 4.1 Algoritmo base: Glicko-2

Cada user tiene 3 valores:
- `rating` (R): 1500 inicial. Es el "skill estimado" en escala Glicko.
- `RD` (rating deviation): 350 inicial. Mide incertidumbre.
- `volatility` (σ): 0.06 inicial. Mide cuánto fluctúa.

Después de cada match, se aplica una iteración Glicko-2:

```
g(RD_i) = 1 / √(1 + 3·RD_i²/π²)
E(R, R_i, RD_i) = 1 / (1 + exp(-g(RD_i)·(R - R_i)))
v = [Σ g(RD_i)² · E · (1 - E)]⁻¹
Δ = v · Σ g(RD_i) · (s_i - E)
σ' = iteración de volatilidad (Newton-Raphson)
RD' = √(1/(1/(RD² + σ'²) + 1/v))
R' = R + RD'² · Σ g(RD_i) · (s_i - E)
```

Donde `s_i ∈ [0, 1]` es el "score" contra el oponente i (1 = ganaste,
0 = perdiste, 0.5 = empate).

### 4.2 Adaptación a 2vs2 (pádel)

Pádel es team game. Decisión: el rating de la pareja para Glicko es el
**promedio** de los 2 ratings. Cada uno gana o pierde lo mismo
post-partido. Variante futura considerada: dar más peso al "miembro
más débil" (penaliza al fuerte si carga al débil), pero por ahora
simple.

```
team_rating = (player1.rating + player2.rating) / 2
team_RD = √((RD1² + RD2²) / 2)   // RD agregado conservadoramente
```

Cada player en el team gana el mismo `ΔR` calculado vs el otro team.

### 4.3 Margen de victoria (MOV)

Ganar 6-0 6-0 sube más que ganar 7-5 7-6. Aplicamos un multiplicador
suave al `s_i`:

```
diff_games = (games_ganados - games_perdidos) en todo el partido
mov_multiplier = 1 + log(1 + diff_games) × 0.12
s_adjusted = clamp(s × mov_multiplier, 0, 1.3)   // cap a 1.3 evita absurdos
```

Para empates (s=0.5), MOV no aplica.

### 4.4 Decay temporal

Si el usuario no juega por > 30 días, antes de procesar su próximo
partido, su RD se incrementa:

```
days_since_last_match = (now - lastMatchAt).days
if days_since_last_match > 30:
    weeks_extra = (days_since_last_match - 30) / 7
    RD = min(350, RD + weeks_extra × 5)   // +5 RD por semana de inactividad
```

Eso refleja "el sistema ya no está tan seguro de tu nivel".

### 4.5 Anti-farm

Para evitar que dos amigos jueguen 10 partidos seguidos para inflar el
rating mutuo: aplicar un weight decay cuando un mismo par juega
muchas veces en ventana corta.

```
matches_vs_same_opponent_24h = count of matches en 24h con MISMO oponente
weight = 1.0 / (1 + 0.5 × matches_vs_same_opponent_24h)
s_final = s_adjusted × weight + 0.5 × (1 - weight)   // se "neutraliza"
```

Resultado: el primer match cuenta full, el segundo 0.67, el tercero
0.5, etc. Después de 24h vuelve a full.

### 4.6 Calibración (los primeros 3 partidos)

- `match_count < 3` → bucket UI muestra "🎯 Calibrando · N/3".
- El rating SÍ se actualiza, pero NO aparece en rankings públicos.
- Después del 3er partido aparece con bucket oficial.

### 4.7 Conservative rating (bucket display)

El bucket mostrado al usuario NO es `rating`, es `rating - 0.5×RD`.
Eso castiga incertidumbre. Dos users con mismo `rating=1900`:
- Player A con RD=50 (muchos matches) → display 1875 → 🔥
- Player B con RD=200 (pocos matches) → display 1800 → 🦅

### 4.8 Buckets emoji (escala 1.0–7.0 estilo Playtomic)

Conversión Glicko (~500–2500) → escala visual (1.0–7.0):

```
nivel = 1.0 + (rating_conservative - 800) / 250    // clamp 1.0..7.0
```

Buckets:
- 1.0–1.9 🌱 Principiante
- 2.0–2.9 🐣 Aprendiz
- 3.0–3.9 🐥 Intermedio
- 4.0–4.9 🦅 Avanzado
- 5.0–5.9 🔥 Competitivo
- 6.0–6.9 ⚡ Élite
- 7.0+ 👑 Top

### 4.9 Audit trail

Cada match procesado guarda en `matches/{id}.ratingAudit`:

```
ratingAudit: {
  algorithmVersion: "glicko2-v1.2",
  processedAt: <Timestamp>,
  cloudFunctionVersion: "1.2.3",
  before: {
    "uid1": { rating: 1500, RD: 350, volatility: 0.06 },
    "uid2": { rating: 1600, RD: 200, volatility: 0.05 },
    ...
  },
  after: {
    "uid1": { rating: 1485, RD: 320, volatility: 0.06 },
    ...
  },
  movMultiplier: 1.12,
  antiFarmWeight: 1.0,
}
```

### 4.10 Idempotencia

`matches/{id}.ratingProcessed = true` después de procesar. Cloud
Function que aplica ranking verifica esto antes de re-procesar.

Para reprocesar todo el histórico (cambio de algorithmVersion): un
admin command que pone `ratingProcessed = false` en todos los matches
y borra `ratings/{uid}` para reset.

### 4.11 Cloud Function

```
exports.onMatchEnded = functions.firestore
  .document('matches/{matchId}')
  .onUpdate((change, context) => {
    const after = change.after.data();
    const before = change.before.data();
    if (after.status !== "ended") return;
    if (after.ratingProcessed) return;
    if (before.status === "ended") return; // ya estaba ended
    return applyRanking(after, context.params.matchId);
  });
```

Más una `recomputeAllRatings()` callable function (admin only) para
reprocesar histórico si cambia el algoritmo.

---

## 5. Grupos y ligas

### 5.1 Conceptos

- **Grupo** = colección de jugadores que comparten ranking interno.
- Tipos: amigos / residencial / club / liga formal.
- Un user puede estar en N grupos. Cada grupo tiene su ranking
  filtrado.

### 5.2 Documento `groups/{groupId}`

```
groups/{groupId}
{
  groupId: "grp-xyz",
  name: "Los Martes del Resi",
  description: "Liga del residencial, todos los martes 7pm.",
  photoURL: "https://...",                // opcional
  type: "friends" | "residencial" | "club" | "liga",
  createdAt: <Timestamp>,
  creatorUid: "uid-del-fundador",
  admins: ["uid-del-fundador", "uid-co-admin"],
  memberCount: 12,                        // cached
  matchCount: 47,                         // cached
  isPublic: false,                        // default false (privado)
  inviteCode: "grp-xyz-token",            // para link de invitación
  rules: {
    rankingScope: "members_only",         // ranking solo entre members
    matchVisibility: "members_only",      // members ven todos los partidos del grupo
    auto_join_by_geo: null,               // futuro: club por geolocalización
  }
}
```

### 5.3 Membresía `groups/{groupId}/members/{uid}`

```
groups/{groupId}/members/{uid}
{
  uid: "uid-del-member",
  joinedAt: <Timestamp>,
  invitedBy: "uid-del-inviter" | null,
  role: "admin" | "member",
  displayName: "Pedro Sanchez",           // snapshot al unirse
  photoURL: "https://...",                // snapshot
  isActive: true,
}
```

### 5.4 Ranking interno

`groups/{groupId}/rankings/{uid}` — calculado por Cloud Function como
agregado de matches donde TODOS los jugadores son members del grupo.

```
groups/{groupId}/rankings/{uid}
{
  uid: "...",
  displayName: "...",
  rating: 1620,                           // ranking interno al grupo
  RD: 180,
  volatility: 0.058,
  matchCountInGroup: 12,
  wins: 7, losses: 5,
  lastUpdated: <Timestamp>,
  rank: 3,                                // posición en el grupo
  bucket: "🦅 Avanzado",
}
```

### 5.5 Auto-descubrimiento de grupos

Si un user jugó 3+ partidos en 30 días con el mismo set de 3+ personas,
el sistema le sugiere: "¿Quieres crear un grupo con estas personas?"

Implementación: Cloud Function que corre semanalmente, busca clusters,
escribe sugerencias a `notifications/{uid}/items/{notifId}` con
`type: "group_suggestion"`.

### 5.6 Roles y admin

- **Creador** = primer admin. Tiene poder absoluto (kick, eliminar
  grupo, asignar otros admins).
- **Admins** = pueden kick, editar metadata, asignar otros admins.
- **Members** = pueden ver ranking + members. No pueden modificar.

### 5.7 Invitaciones

Link compartible: `https://puntazoclips.com/g/{inviteCode}`.
Abre `grupo.html?code=X` que pide auth (signInWithGoogle) y muestra
"Únete al grupo 'Los Martes del Resi'. ¿Confirmas?".

---

## 6. Amigos

### 6.1 Estructura

`friendships/{friendshipId}` donde `friendshipId = sorted(uidA, uidB)`
(clave determinística para evitar duplicados).

```
friendships/{friendshipId}
{
  uidA: "uid-menor-lex",
  uidB: "uid-mayor-lex",
  status: "pending" | "accepted" | "blocked",
  requesterUid: "uidA" | "uidB",
  createdAt: <Timestamp>,
  acceptedAt: <Timestamp>,
}
```

### 6.2 Flujo

1. Pedro busca a María por handle o por nombre.
2. Tap "Agregar amigo" → crea friendship con status "pending",
   requesterUid = Pedro.
3. María recibe notificación → tap "Aceptar" → status = "accepted",
   acceptedAt = now.
4. Ya son amigos. Cada uno puede:
   - Ver perfil completo (incluso si privacy=friends)
   - Ver matches del otro
   - Ver ranking
   - Ver head-to-head

### 6.3 Bloqueo

Status `"blocked"` impide ver perfil, recibir notificaciones, ser
invitado a partidos. Solo el bloqueador puede deshacer.

### 6.4 Búsqueda

- Por **handle**: `users where handle == "pedro"` (uno a uno).
- Por **nombre**: pre-computar índice de tipo Trigram en `users` para
  búsqueda fuzzy. Implementación inicial: simple `where displayName >=
  query AND displayName < query+` (prefix match).

### 6.5 Head-to-head

`head_to_head/{uidA_uidB_sorted}` — cached doc:

```
{
  uidA: "...",
  uidB: "...",
  matchesAsTeammates: 12,
  matchesAsOpponents: 8,
  winsByA: 5,           // sólo cuando son oponentes
  winsByB: 3,
  lastMatchAt: <Timestamp>,
  updatedAt: <Timestamp>,
}
```

Calculado por Cloud Function cuando se procesa un match.

---

## 7. Invitaciones multi-target

### 7.1 Tipos

| Tipo | Target | Acción | URL |
|---|---|---|---|
| `puntazo` | Cualquier persona | "Únete a Puntazo" | `/i/{code}` |
| `match` | Slot específico de partido | "Reclama tu slot" | `/p/{matchId}?invite={code}` |
| `group` | Grupo | "Únete al grupo" | `/g/{groupCode}` |
| `clip` | Clip individual | "Mira este clip" | `/c/{clipId}?from={uid}` |
| `friend` | Amistad directa | "Sé mi amigo" | `/u/{handle}?from={uid}` |

### 7.2 Documento `invites/{inviteId}`

```
invites/{inviteId}
{
  inviteId: "auto-id",
  type: "puntazo" | "match" | "group" | "clip" | "friend",
  fromUid: "uid-del-inviter",
  fromDisplayName: "Isaac Saltiel",
  target: {
    // según type
    matchId?: "...",
    slotIdx?: 1,
    groupId?: "...",
    clipId?: "...",
    toUid?: "..."                          // friend invites
  },
  toUid: "..." | null,                    // si está dirigido a alguien concreto
  toEmail: "..." | null,                  // alternativo a toUid
  toPhone: "..." | null,                  // alternativo
  status: "pending" | "accepted" | "rejected" | "expired",
  createdAt: <Timestamp>,
  acceptedAt: <Timestamp>,
  acceptedBy: "uid-del-aceptante" | null,
  expiresAt: <Timestamp>,                 // default +30 días
  message: "" | "string",                 // mensaje custom del inviter
}
```

### 7.3 OG tags (preview en WhatsApp)

Cada link de invitación renderiza una página con OG tags que muestra
preview lindo:

```html
<meta property="og:title" content="Isaac te invita a reclamar tu slot en el partido del 12 de mayo · Puntazo" />
<meta property="og:description" content="Marcador: 6-4 / 6-3. Toca para ver y confirmar tu participación." />
<meta property="og:image" content="https://puntazoclips.com/og/match-{matchId}.png" />
<meta property="og:url" content="https://puntazoclips.com/p/{matchId}?invite={code}" />
```

`og/match-{matchId}.png` se genera con una Cloud Function que pinta la
scoreboard-card en un canvas server-side y la sirve cacheada.

### 7.4 Deep links install

Si el invitado no tiene Puntazo instalado: la página de aceptación
detecta el referrer, muestra "Para usar Puntazo abre desde tu
navegador móvil" + link. Eventualmente: PWA install prompt.

---

## 8. Notificaciones

### 8.1 Eventos notificables

| Evento | Trigger | Destinatario |
|---|---|---|
| `claim_requested` | Alguien claimó tu slot | Creador del match |
| `claim_approved` | Tu claim fue aceptado | Requester |
| `friend_request` | Alguien quiere ser tu amigo | Targetee |
| `friend_accepted` | Tu solicitud aceptada | Requester |
| `group_invite` | Te invitaron a un grupo | Targetee |
| `group_joined` | Alguien se unió a tu grupo | Admins del grupo |
| `match_invite` | Te invitaron a partido | Targetee |
| `rating_bucket_up` | Subiste de bucket emoji | Tu mismo (celebración) |
| `rating_bucket_down` | Bajaste de bucket emoji | Tu mismo (alerta amable) |
| `clip_visible` | Tu puntazo está listo | Solicitante |
| `clip_error` | Tu puntazo tuvo error | Solicitante |
| `head_to_head_milestone` | "Has jugado 10 vs Pedro" | Ambos |

### 8.2 Estructura

```
users/{uid}/notifications/{notifId}
{
  notifId: "auto-id",
  type: "claim_requested" | ...,
  title: "string",                        // pre-renderizado
  body: "string",                         // pre-renderizado
  iconEmoji: "🎯",
  data: { ... },                          // payload específico al tipo
  createdAt: <Timestamp>,
  read: false,
  readAt: <Timestamp> | null,
  href: "/p/abc?focus=slot1" | null,      // tap → navega aquí
  expiresAt: <Timestamp>,                 // default +90 días
}
```

### 8.3 UI

- Badge en topbar: 🔔 con contador rojo si `unread > 0`.
- Tap → drop-down con últimos 10 + "Ver todas" → `notificaciones.html`.
- Tap notif individual → marca read + navega al `href`.

### 8.4 Push (Fase futura)

Firebase Cloud Messaging cuando esté pegado en PWA / WebPush. Por ahora
solo in-app.

---

## 9. Autocomplete y memoria de jugadores recientes

### 9.1 Pool de displayNames recientes

Por cada user, mantener un cache local + sync con Firestore de los
nombres con los que ha jugado.

```
users/{uid}/recentPlayers/{otherUid_or_nameHash}
{
  displayName: "Pedro",
  uid: "uid-of-pedro" | null,             // si está vinculado a una cuenta
  photoURL: "..." | null,
  lastPlayedAt: <Timestamp>,
  matchCount: 5,
  isFriend: true,                         // cached
}
```

Cloud Function actualiza esto cuando se procesa un match.

### 9.2 Autocomplete UX

En cualquier input de nombre de jugador (mi-partido, registrar-partido,
modal terminar, sheet de edición):

```
[__________]
  ↓ (dropdown al escribir 2+ chars)
  🟢 Pedro Sanchez · 👤 amigo · 5 partidos
  🔵 Pedro Lopez · 2 partidos
  🟡 Pedrito (suelto) · 1 partido
  ─────
  + Agregar "Pedro" como nombre suelto
```

- Verde 🟢 = amigo vinculado.
- Azul 🔵 = vinculado pero no amigo.
- Amarillo 🟡 = nombre suelto sin uid.

Tap → pre-llena nombre + (si tiene uid) lo asocia.

### 9.3 Implementación

Componente JS reusable `assets/player-autocomplete.js`:

```
PuntazoPlayerAutocomplete.attach({
  input: $myInput,
  onSelect: function(selected) {
    // selected = { displayName, uid?, photoURL?, isFriend?, isLoose? }
  },
});
```

Lee `users/{user.uid}/recentPlayers` ordenado por `lastPlayedAt desc`,
filtra por prefix, renderiza dropdown.

---

## 10. Privacy + manejo de cuentas

### 10.1 Privacy levels

- **public**: cualquiera (incluso anónimos) puede ver.
- **friends**: solo amigos aceptados.
- **private**: solo tú.

Configurable por: perfil, clips, matches.

### 10.2 Account actions

- **Logout**: limpia auth local.
- **Borrar cuenta**: soft-delete. `users/{uid}.deletedAt = now`,
  `flags.isDeleted = true`. Datos personales removidos. Matches quedan
  como "Usuario eliminado" (displayName redacted, photoURL borrado,
  ratings preservados como auditoría histórica). Después de 30 días,
  hard-delete vía Cloud Function batch.
- **Recovery**: si te logueas con el mismo Google email, te ofrece
  "Vimos que tenías una cuenta. ¿Restaurar?" antes de hard-delete.
- **Merge** (descrito en §3.5).

### 10.3 Borrado de matches/clips

- Borrar clip: no se puede (es captura histórica). Se puede REPORTAR
  para que admin revise.
- Borrar match: solo el creador, dentro de 24h del cierre. Después
  queda inmutable para preservar ranking.

---

## 11. Disputas y edición post-cierre

### 11.1 Ventana de edición

Después de cerrar un match (`status = "ended"`), el creador tiene **24h
para editar marcador + jugadores** libremente. Después de 24h, queda
locked.

### 11.2 Disputas

Si un user reclama "el marcador está mal" después de las 24h:

```
disputes/{matchId}_{requesterUid}
{
  matchId: "...",
  requesterUid: "...",
  reason: "string",
  proposedChange: { marcador: {...} },
  status: "pending" | "approved" | "rejected" | "abandoned",
  createdAt: <Timestamp>,
  resolvedAt: <Timestamp>,
  resolverUid: "...",                     // el creador resuelve
}
```

Flujo:
1. User abre dispute → notif al creador.
2. Creador ve la disputa, puede approve / reject / counter-propose.
3. Si approve → match se modifica + rating se reprocesa.
4. Si no responde en 7 días, status = "abandoned".

### 11.3 Audit log

Cada edición de match (post-cierre o vía disputa) registra:

```
matches/{matchId}/audit/{auditId}
{
  changedBy: "uid",
  changedAt: <Timestamp>,
  reason: "creator_edit" | "dispute_approved" | "admin_override",
  before: { ... snapshot del marcador ... },
  after: { ... },
  disputeId: "..." | null,
}
```

---

## 12. Research: lecciones de otros sistemas

### 12.1 Playtomic

✅ Buenas prácticas:
- Escala 1.0–7.0 fácil de entender.
- Buckets emoji que motivan a "subir".
- Calibración inicial obligatoria.
- Matchmaking sugerido por nivel.

❌ Anti-patterns a evitar:
- Algoritmo opaco, "feel-based".
- No publica fórmula. Frustra a los nerds.
- Reserve booking dentro del mismo app (scope creep).

✅ **Lección para Puntazo**: ser transparente. Publicar el algoritmo
en docs/. Mostrar al user el desglose: "Subiste 32 puntos porque
ganaste un partido ajustado (MOV +12) contra un rival más fuerte (RD
+20)".

### 12.2 UTR (Universal Tennis Rating)

✅ Buenas prácticas:
- Score-based (cuenta cada game, no solo win/loss).
- Range visible (rating ± margin of error).
- Rating reset opcional para tomarse en serio.

❌ Anti-patterns:
- Solo para tennis "serio" (torneos federados).
- No tiene social.

✅ **Lección**: incorporar MOV (margen de victoria) como UTR. Mostrar
rango como UTR. Pero MUCHO más social.

### 12.3 Strava

✅ Buenas prácticas:
- Resumen post-actividad compartible (lo tenemos: foto Strava).
- "Achievements" y "PRs" personales.
- Feed social con likes y comments.
- Segmentos (rutas con leaderboards).

❌ Anti-patterns:
- Premium feature creep.
- Notificaciones excesivas.

✅ **Lección**: feed social opcional (Fase 5 futura). Achievements
sí ("primer 6-0", "racha 10", "10mo partido"). Notificaciones con
control granular.

### 12.4 MyTennis / iTennis

✅ Buenas prácticas:
- Grupos privados con admin.
- Liga formal con calendario.

❌ Anti-patterns:
- UX 2010, mobile-second.
- Identity weak (cualquiera puede ser cualquiera).

✅ **Lección**: nuestro claim cruzado + Google auth obligatorio resuelve
identity. UX mobile-first nativa.

### 12.5 PadelMix

✅ Buenas prácticas:
- Torneos rápidos round-robin (Fase 4 futura).
- Americana / rotación de parejas.

❌ Anti-patterns:
- No persistencia entre torneos.
- No ranking serio.

✅ **Lección**: cuando hagamos formatos (Fase 4) reusar UX patterns
de PadelMix, pero alimentando el ranking persistente.

### 12.6 Síntesis: el diferenciador Puntazo

Puntazo gana porque combina **3 cosas que ningún solo competidor
tiene**:

1. **Clips automáticos** (Playtomic / UTR no tienen cámaras).
2. **Ranking serio + social** (PadelMix no tiene ranking persistente).
3. **Rotaciones sociales nativas** (MyTennis no las tiene).

El "ranking serio" por sí solo no convence al usuario casual. Los
"clips automáticos" sin ranking se quedan en novedad. Pero combinados:
"vine a jugar, mis clips son auto-mágicos, mi ranking sube, mi grupo
me ve subir, mi pareja me felicita en el chat del grupo, comparto
clip de mi puntazo a mi feed y mis amigos lo ven, retan al grupo
rival" — **eso es plataforma, no app.**

---

## 13. Esquema completo de Firestore

```
firestore/
├── users/{uid}                          # perfil canónico (§3.2)
│   ├── recentPlayers/{otherKey}         # autocomplete (§9.1)
│   ├── notifications/{notifId}          # notif in-app (§8.2)
│   └── preferences/                     # settings detallados
├── matches/{matchId}                    # ya existe; añadir ratingAudit (§4.9)
│   ├── claims/{claimUid}                # ya existe
│   └── audit/{auditId}                  # cambios post-cierre (§11.3)
├── claim_requests/{requestId}           # claim cruzado retroactivo (§3.3)
├── friendships/{friendshipId}           # amistades (§6.1)
├── head_to_head/{pairKey}               # cache H2H (§6.5)
├── groups/{groupId}                     # grupos/ligas (§5.2)
│   ├── members/{uid}                    # membresía (§5.3)
│   └── rankings/{uid}                   # ranking interno (§5.4)
├── invites/{inviteId}                   # invitaciones multi-target (§7.2)
├── ratings/{uid}                        # ranking GLOBAL del usuario
├── disputes/{disputeId}                 # disputas de marcador (§11.2)
├── reports/{reportId}                   # reports de abuse
├── pending_pulses/{pulseId}             # ya existe (R4)
└── clip_states/{clipId}                 # ya existe (R2)
```

`ratings/{uid}` schema:

```
{
  uid: "...",
  displayName: "...",                     // snapshot
  rating: 1620,
  RD: 180,
  volatility: 0.058,
  conservativeRating: 1530,
  nivel: 4.3,                             // 1.0..7.0
  bucket: "🦅 Avanzado",
  matchCount: 47,
  wins: 28, losses: 17, draws: 2,
  lastMatchAt: <Timestamp>,
  updatedAt: <Timestamp>,
  isCalibrating: false,                   // matchCount < 3
  sparkline7d: [1620, 1635, 1618, ...],   // últimos 7 puntos (cached)
}
```

---

## 14. Reglas Firestore consolidadas

Para que Isaac pegue cuando lleguemos a implementar Fase 3.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isMe(uid) { return signedIn() && request.auth.uid == uid; }
    function isAdmin() {
      return signedIn() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.flags.isAdmin == true;
    }

    // ── existentes (matches, claims, clip_states, pending_pulses) ──
    // ... (mantener bloques actuales)

    // ── users/{uid} ──
    match /users/{uid} {
      allow read: if true;  // perfil público (privacy se filtra client-side por ahora)
      allow create: if isMe(uid) && request.resource.data.createdAt == request.time;
      allow update: if isMe(uid)
                    && request.resource.data.uid == resource.data.uid;
      allow delete: if false;  // soft-delete via update.flags.isDeleted

      match /recentPlayers/{otherKey} {
        allow read, write: if isMe(uid);
      }

      match /notifications/{notifId} {
        allow read: if isMe(uid);
        allow create: if false;  // solo SA / Cloud Function
        allow update: if isMe(uid)
                      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read','readAt']);
        allow delete: if isMe(uid);
      }
    }

    // ── claim_requests ──
    match /claim_requests/{reqId} {
      allow read: if signedIn() &&
                  (resource.data.requesterUid == request.auth.uid ||
                   resource.data.ownerUid == request.auth.uid);
      allow create: if signedIn()
                    && request.resource.data.requesterUid == request.auth.uid
                    && request.resource.data.status == "pending"
                    && request.resource.data.createdAt == request.time;
      // Update: solo el owner (creador del match) puede resolver
      allow update: if signedIn()
                    && resource.data.ownerUid == request.auth.uid
                    && request.resource.data.status in ['approved','rejected'];
      allow delete: if signedIn() && resource.data.requesterUid == request.auth.uid;
    }

    // ── friendships ──
    match /friendships/{friendshipId} {
      allow read: if signedIn() &&
                  (resource.data.uidA == request.auth.uid ||
                   resource.data.uidB == request.auth.uid);
      allow create: if signedIn()
                    && request.resource.data.status == "pending"
                    && request.resource.data.requesterUid == request.auth.uid
                    && (request.resource.data.uidA == request.auth.uid ||
                        request.resource.data.uidB == request.auth.uid);
      // Update: cualquiera de los dos puede aceptar/rechazar/bloquear
      allow update: if signedIn()
                    && (resource.data.uidA == request.auth.uid ||
                        resource.data.uidB == request.auth.uid)
                    && request.resource.data.status in ['accepted','rejected','blocked'];
      allow delete: if signedIn()
                    && (resource.data.uidA == request.auth.uid ||
                        resource.data.uidB == request.auth.uid);
    }

    // ── head_to_head ──
    match /head_to_head/{pairKey} {
      allow read: if signedIn();  // los dos involucrados verifican client-side
      allow write: if false;       // solo Cloud Function
    }

    // ── groups ──
    match /groups/{groupId} {
      allow read: if signedIn();
      allow create: if signedIn()
                    && request.resource.data.creatorUid == request.auth.uid
                    && request.resource.data.admins is list
                    && request.auth.uid in request.resource.data.admins
                    && request.resource.data.createdAt == request.time;
      allow update: if signedIn()
                    && request.auth.uid in resource.data.admins;
      allow delete: if signedIn()
                    && request.auth.uid == resource.data.creatorUid;

      match /members/{memberUid} {
        allow read: if signedIn();
        allow create: if signedIn() &&
                      (request.auth.uid == memberUid ||
                       request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.admins);
        allow update: if signedIn() &&
                      (request.auth.uid == memberUid ||
                       request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.admins);
        allow delete: if signedIn() &&
                      (request.auth.uid == memberUid ||
                       request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.admins);
      }

      match /rankings/{uid} {
        allow read: if signedIn();
        allow write: if false;  // Cloud Function
      }
    }

    // ── invites ──
    match /invites/{inviteId} {
      allow read: if signedIn() &&
                  (resource.data.fromUid == request.auth.uid ||
                   resource.data.toUid == request.auth.uid ||
                   true);  // permitir read por inviteId (link-based access)
      allow create: if signedIn()
                    && request.resource.data.fromUid == request.auth.uid
                    && request.resource.data.status == "pending"
                    && request.resource.data.createdAt == request.time;
      allow update: if signedIn()
                    && request.resource.data.status in ['accepted','rejected']
                    && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['status','acceptedBy','acceptedAt']);
      allow delete: if signedIn() && resource.data.fromUid == request.auth.uid;
    }

    // ── ratings (global) ──
    match /ratings/{uid} {
      allow read: if signedIn();
      allow write: if false;  // Cloud Function
    }

    // ── disputes ──
    match /disputes/{disputeId} {
      allow read: if signedIn() &&
                  (resource.data.requesterUid == request.auth.uid ||
                   resource.data.ownerUid == request.auth.uid);
      allow create: if signedIn()
                    && request.resource.data.requesterUid == request.auth.uid
                    && request.resource.data.status == "pending";
      allow update: if signedIn()
                    && (resource.data.requesterUid == request.auth.uid ||
                        resource.data.ownerUid == request.auth.uid)
                    && request.resource.data.status in ['approved','rejected','abandoned'];
      allow delete: if false;
    }

    // ── reports ──
    match /reports/{reportId} {
      allow create: if signedIn();
      allow read, update, delete: if isAdmin();
    }

    // ── matches audit subcollection ──
    match /matches/{matchId}/audit/{auditId} {
      allow read: if signedIn();
      allow write: if false;  // Cloud Function only
    }

    // ── catch-all ──
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 15. Roadmap de implementación

Sub-fases ordenadas por dependencias. Cada una deployable independiente
sin romper lo anterior.

### Sub-fase 3.A — Motor de ranking (sin UI todavía)
- `assets/ranking.js`: Glicko-2 puro (sin Firestore).
- Tests unitarios (página `tests/ranking-test.html`).
- Validación contra casos conocidos del paper de Glickman.

### Sub-fase 3.B — Cloud Function de ranking
- `functions/onMatchEnded.js`: dispara al cerrar match.
- Aplica algoritmo, escribe `ratings/{uid}` + `matches/{id}.ratingAudit`.
- Idempotencia via `matches/{id}.ratingProcessed`.

### Sub-fase 3.C — Sistema de identidad mejorado
- Migrar `usuarios/{uid}` → `users/{uid}` (refactor de auth.js).
- Página `perfil-editar.html`: displayName, foto, privacy, handle.
- Validación de handle único.

### Sub-fase 3.D — Página "Mi nivel" (mi-nivel.html)
- Lee `ratings/{user.uid}`.
- Muestra: bucket emoji, rango (rating ± RD), posición global, percentil,
  matches recientes con desglose de cambios, sparkline 7d.
- Sticker compartible (html2canvas).

### Sub-fase 3.E — Claim cruzado retroactivo
- Página `mis-claims.html` (lista de pending claims hechos por el user).
- Búsqueda fuzzy de partidos por nombre del user.
- Notif al creador del match.
- Aprobación → recompute ranking del match afectado.

### Sub-fase 3.F — Grupos básicos
- Página `grupos.html`: lista de grupos del user + crear nuevo.
- Página `grupo/{groupId}.html`: detalle, members, ranking interno,
  invite link.
- Cloud Function `computeGroupRanking` semanal.

### Sub-fase 3.G — Amigos
- Página `amigos.html`: lista + búsqueda + solicitudes pendientes.
- `perfil/{uid}.html` o `u/{handle}`: perfil público con matches +
  ranking + H2H si autenticado.
- Notif friend_request.

### Sub-fase 3.H — Autocomplete jugadores recientes
- `assets/player-autocomplete.js`: componente reusable.
- Integración en mi-partido (slots), modal terminar (sheet).
- Cloud Function que actualiza `recentPlayers` al cerrar match.

### Sub-fase 3.I — Invitaciones multi-target + OG tags
- Helper `assets/invites.js`: crear invitación de cada tipo.
- Páginas de aceptación: `/i/{code}`, `/g/{code}`, `/p/{matchId}`.
- Cloud Function para generar OG image dinámica.

### Sub-fase 3.J — Notificaciones in-app
- Badge en header (header.js).
- Página `notificaciones.html`.
- Cloud Functions que escriben notifications/* en eventos.

### Sub-fase 3.K — Privacy + account merge + disputas
- Privacy filtros en queries del frontend.
- Cloud Function de account merge.
- Páginas de disputa.

### Sub-fase 3.L — Polish + métricas
- Achievements (badges).
- Sparkline animation, transitions.
- Analytics: cuántos users en cada bucket, MAU, etc.

---

## 16. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Algoritmo Glicko-2 mal implementado → rankings injustos | Tests unitarios contra casos del paper original. Audit trail permite reprocesar. |
| Claim cruzado abusado (gente reclama matches que no jugó) | Auth Google obligatorio + autorización del creador + límite 50/semana. |
| Spam de friend_requests | Rate limit 20/día por user. Bloqueo robusto. |
| Cloud Function caro al escalar | Batch processing nocturno para recompute, no real-time si volumen alto. |
| Privacy leaks (perfil privado pero aparece en H2H público) | Tests E2E de privacy. Cloud Function que aplica privacy al actualizar caches. |
| Notif overload | Settings granulares + agrupación ("3 friend requests"). |
| OG image bot abuse | Cloud Function rate-limited + cache CDN. |
| User con 2 cuentas se confunde | Account merge flujo claro. UI siempre muestra "Tu cuenta: X". |
| Borrar cuenta crea matches "huérfanos" | Soft-delete preserva matches con displayName redacted. |

---

## 17. Métricas de éxito

Después de 3 meses de v100 live:

- **Activación**: 70%+ de users que entran a entrada.html crean cuenta.
- **Identidad**: 80%+ de matches tienen ≥1 jugador con uid.
- **Ranking engagement**: 50%+ de users registrados ven mi-nivel.html al
  menos 1x/semana.
- **Social**: 30%+ de users tienen ≥1 amigo.
- **Grupos**: 20%+ de users están en al menos 1 grupo.
- **Claim cruzado**: 90%+ de claim_requests son resueltas en <7 días.
- **Disputas**: <5% de matches tienen disputa abierta.

Si alcanzamos esto, Puntazo dejó de ser "captura de clips" y se volvió
plataforma.

---

## Fin del documento

Próximo paso: **implementación sub-fase 3.A** (motor de ranking en
`assets/ranking.js`) + reglas Firestore consolidadas listas para pegar.
