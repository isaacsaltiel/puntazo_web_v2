# Schema de partidos — `matches/` (Etapa 3)

Documento de arquitectura para la capa de datos de "partidos" (sesiones
de juego) que introduce el rediseño del jugador en Puntazo. Producido
por la Etapa 3. **No incluye UI** — sólo el modelo de datos y el módulo
JS de acceso. Las pantallas que consumen este schema (entrada,
mi-partido, resumen) llegarán en etapas posteriores.

## 1. Lugar dentro del sistema

```
            ┌──────────────────────────────────────────┐
            │            Firebase Auth                 │
            │   usuario logueado vía Google Sign-In    │
            └──────────────────────┬───────────────────┘
                                   │ auth.uid
                                   ▼
   ┌───────────────────────────────────────────────────────────────┐
   │                       matches/{matchId}                       │
   │                                                               │
   │  userId, loc, can, lado, startedAt, endedAt, status,          │
   │  marcador, jugadores, clipCount, createdAt, updatedAt         │
   └────────────┬──────────────────────────────────────┬───────────┘
                │                                      │
                │ (asociación por                      │ (cruce futuro
                │  ventana temporal,                   │  con reactions
                │  ver §5)                             │  vía videoId)
                ▼                                      ▼
   ┌──────────────────────────────────┐    ┌──────────────────────────┐
   │   videos_recientes.json          │    │  reactions/{videoId}     │
   │   (data/Locaciones/.../          │    │  - counts (fuego/risa..) │
   │    videos_recientes.json)        │    │  - comments/             │
   │                                  │    │  - participants/         │
   │   videos[].nombre  →  parse →    │    └──────────────────────────┘
   │   videos[].url        timestamp  │                  ▲
   │                                  │                  │
   │   Generado por workflows         │                  │ claims hechos
   │   GitHub Actions a partir de     │                  │ desde lado.html
   │   uploads del pipeline Python    │                  │
   │   local del club.                │                  │
   └──────────────────────────────────┘                  │
                                                         │
   ┌──────────────────────────────────┐                  │
   │   usuarios/{uid}/...             │──────────────────┘
   │     guardados/{videoId}          │     (existente, no cambia
   │     apariciones/{videoId}        │      en esta etapa)
   └──────────────────────────────────┘
```

`matches/` es una colección **paralela** a `reactions/` y `usuarios/`.
No hay foreign keys explícitas — la unión clip↔partido se calcula en
cliente por ventana temporal (ver §5).

## 2. Tabla de campos

| Campo | Tipo | Nullable | Inmutable | Descripción |
|---|---|---|---|---|
| `userId` | `string` | no | sí | UID del dueño (Firebase Auth). Igual a `auth.uid` al crear. |
| `loc` | `string` | no | sí | ID del club. Ej. `"BreakPoint"`, `"Scorpion"`. Debe existir en `data/config_locations.json`. |
| `can` | `string` | no | sí | ID de la cancha. Ej. `"Cancha1"`. |
| `lado` | `string` | no | sí | ID del lado / cámara. Ej. `"LadoA"`. |
| `status` | `string` | no | no | Enum: `"active"` \| `"ended"` \| `"cancelled"`. Inicia en `"active"`. |
| `startedAt` | `Timestamp` | no | sí | `serverTimestamp()` al crear. |
| `endedAt` | `Timestamp` \| `null` | sí | "write-once" | Se setea con `serverTimestamp()` al llamar `end()`. Una vez no-null, las rules impiden modificarlo. |
| `marcador` | `object` \| `null` | sí | no | Forma sugerida: `{ sets: [[6,4],[3,6],[7,5]], ganador?: "team1" \| "team2" }`. No validado por rules. |
| `jugadores` | `array` | no | no | `[{ nombre: string, uid?: string }, ...]`. Longitud 0-4 (truncado por el cliente). |
| `clipCount` | `number` | no | no | Denormalización: cantidad de clips dentro de la ventana del partido. Se recalcula al hacer `end()` (best-effort). |
| `createdAt` | `Timestamp` | no | sí | `serverTimestamp()` al crear. |
| `updatedAt` | `Timestamp` | no | no | `serverTimestamp()` en cada write desde el cliente. |

`matchId` es el auto-ID de Firestore (`db.collection('matches').doc().id`).
**No** se construye a partir de fechas: evitamos colisiones cuando dos
partidos arrancan el mismo segundo, y dejamos abierto a que más
adelante haya migración de datos sin que el ID lleve información.

### Ejemplo de documento

```json
{
  "userId": "ABCDEF1234567890",
  "loc": "BreakPoint",
  "can": "Cancha1",
  "lado": "LadoA",
  "status": "ended",
  "startedAt": "<Timestamp 2026-05-20 14:00:00 UTC>",
  "endedAt":   "<Timestamp 2026-05-20 15:32:00 UTC>",
  "marcador": { "sets": [[6, 4], [3, 6], [7, 5]], "ganador": "team1" },
  "jugadores": [
    { "nombre": "Isaac", "uid": "ABCDEF1234567890" },
    { "nombre": "Pablo" }
  ],
  "clipCount": 14,
  "createdAt": "<Timestamp 2026-05-20 14:00:00 UTC>",
  "updatedAt": "<Timestamp 2026-05-20 15:32:00 UTC>"
}
```

## 3. API del módulo `assets/matches.js`

Patrón IIFE + `window.PuntazoMatches`. Requiere haber cargado antes:

1. Firebase compat SDK (`firebase-app`, `firebase-auth`, `firebase-firestore`).
2. `assets/firebase-core.js` (provee `window.PuntazoFirebase`).
3. `assets/auth.js` (provee `window.PuntazoAuth`).

| Método | Firma | Notas |
|---|---|---|
| `create` | `({ loc, can, lado, jugadores?, marcadorInicial? }) → Promise<matchId>` | Requiere usuario autenticado. Crea con `status: "active"`, `startedAt: serverTimestamp()`, `endedAt: null`. |
| `end` | `(matchId, { marcador? }) → Promise<void>` | Setea `status: "ended"`, `endedAt: serverTimestamp()`, opcionalmente `marcador`. Recalcula `clipCount` (best-effort, no falla el método si el JSON no carga). |
| `cancel` | `(matchId) → Promise<void>` | Setea `status: "cancelled"`. **No** toca `endedAt`. |
| `get` | `(matchId) → Promise<MatchDoc \| null>` | Lectura única. |
| `listByUser` | `(userId, { limit?=20, status?=null }) → Promise<MatchDoc[]>` | Orden: `startedAt desc`. Filtra por `status` si se pasa. |
| `getActiveForUser` | `(userId) → Promise<MatchDoc \| null>` | Helper: el partido más reciente con `status == "active"`, o `null`. |
| `findClipsForMatch` | `(matchDoc) → Promise<ClipMeta[]>` | Ver §5. |

`MatchDoc` es el shape de §2 más `id: string`.

`ClipMeta` tiene shape compatible con lo que `card.js` y `reactions.js`
esperan en producción:

```javascript
{
  videoId:  "BreakPoint_Cancha1_LadoA_19052026_135630.mp4",
  videoUrl: "https://www.dropbox.com/...",
  club:     "BreakPoint",
  cancha:   "Cancha1",
  lado:     "LadoA",
  fecha:    "2026-05-19",
  timestamp: 1747691790000,
  nombre:   "BreakPoint_Cancha1_LadoA_19052026_135630.mp4"
}
```

## 4. Firestore Security Rules

Ver [`firestore-rules-matches.txt`](firestore-rules-matches.txt) (draft,
**no desplegado**). Resumen:

- **read**: dueño siempre; cualquiera si `status == "ended"`.
- **create**: usuario autenticado, no falsifica `userId`, `status == "active"`, `startedAt` y `createdAt` son `serverTimestamp()`.
- **update**: solo dueño; `userId`/`loc`/`can`/`lado`/`startedAt`/`createdAt` inmutables; `endedAt` write-once; `status` válido.
- **delete**: denegado. Para "borrar" se usa `status = "cancelled"`.

### Índices compuestos requeridos

Crearlos en Firebase Console → Firestore → Índices antes de Etapa 4:

1. Colección `matches` — campos: `userId Asc`, `startedAt Desc`.
2. Colección `matches` — campos: `userId Asc`, `status Asc`, `startedAt Desc`.

## 5. Decisión clave: asociación clip↔partido por ventana temporal

### Por qué temporal y no escritura explícita

**Constraint duro:** el pipeline que produce los clips vive en el PC
del club (`Puntazo-release - copia/`, `core/main.py`) — sube el .mp4 a
Dropbox y dispara un workflow de GitHub Actions que regenera los
JSONs (`videos_recientes.json`, `videos_index.json`). Ese pipeline:

- No tiene autenticación de Firebase (no sabe quién es el dueño del
  partido en curso, ni siquiera sabe que existe el concepto "partido").
- Está empacado en build externos (`PUNTAZO_NEW_F1/`) — modificarlo
  obliga a redeployar a cada club.
- **Está fuera del scope de Etapa 3** (lista explícita en el brief).

Por eso, en lugar de que el clip escriba `matchId` cuando se crea, el
**cliente web** (etapa siguiente) une clip↔match al leer:

```
clip pertenece al match  ⇔
    clip.loc  == match.loc   ∧
    clip.can  == match.can   ∧
    clip.lado == match.lado  ∧
    match.startedAt ≤ clipTimestamp ≤ (match.endedAt ?? now)
```

`clipTimestamp` se extrae del nombre del archivo
(`Club_Cancha_Lado_DDMMYYYY_HHMMSS.mp4`) usando `parseFromName`
(implementación idéntica a la de `assets/script.js`).

### Limitaciones del enfoque temporal

| Limitación | Mitigación |
|---|---|
| Clip cuyo timestamp por error cae fuera de la ventana queda huérfano. | El partido se puede re-`end()` desplazando `endedAt`... pero las rules hacen `endedAt` write-once. **Para Etapa 3 se acepta**; si en producción aparece el caso, evaluar permitir un margen (ej. ±30s) en `findClipsForMatch`. |
| Dos partidos solapados en el mismo lado por usuarios distintos: ambos clips se asignarían a ambos. | Ver §6, caso edge "solape en el mismo lado". |
| Cambio de reloj del PC del club (zona horaria) descalibra `clipTimestamp`. | Fuera de scope. El PC del club corre en hora local de México; los timestamps Firestore son UTC. Si llegara a ser problema, normalizar en el pipeline (Etapa 11). |
| Clips de "vitrina" (más viejos que 24h) viven en `videos_vitrina.json`, no en `videos_recientes.json`. | Para partidos terminados hoy, basta con `videos_recientes.json`. Para resúmenes históricos, en una etapa futura `findClipsForMatch` puede caer al índice completo (`videos_index.json`). **Por ahora sólo se consulta `videos_recientes.json`** (lo que `lado.html` usa). |

## 6. Casos edge documentados

### a) Partido sin `endedAt` (quedó activo)

Si el usuario nunca pulsó "terminar", el documento queda con
`status: "active"`, `endedAt: null` indefinidamente.

- `getActiveForUser` lo seguiría devolviendo. Si el usuario abre la
  app de nuevo, ve "tienes un partido en curso" y puede terminarlo
  o cancelarlo (UI de Etapa 5).
- `findClipsForMatch` usa `now` como límite superior cuando `endedAt`
  es null. Por eso la ventana crece indefinidamente.
- **Pendiente para etapa futura (NO Etapa 3):** un job programado (Cloud
  Function) que cancele partidos `active` con más de N horas. Se evalúa
  en Etapa 11. Mientras tanto, el cliente puede ofrecer auto-cancel
  cuando detecte un `active` con `startedAt` muy viejo (ej. > 6h).

### b) Clip con timestamp fuera de la ventana

No queda asociado a ningún partido. Sigue existiendo en
`videos_recientes.json` y se puede ver normalmente vía `lado.html`.
Esto es esperado y correcto.

### c) Dos partidos del mismo usuario solapados en distintos lados

Permitido por el modelo: cada partido toma sus clips porque
`findClipsForMatch` filtra también por `loc/can/lado`.

`getActiveForUser` devuelve el más reciente (orden `startedAt desc`,
limit 1) — en Etapa 5 la UI debería permitir al usuario elegir cuál
"continuar". **No es problema de Etapa 3.**

### d) Dos partidos solapados en el mismo lado (ambigüedad)

Caso patológico: usuario A y usuario B juegan a la vez en `LadoA`
de la misma cancha, ambos con partido `active`.

**Resolución actual (Etapa 3):** *no se previene*. Los clips de ese
intervalo se asignan a ambos partidos (cada usuario ve los suyos al
abrir su resumen). Esto es aceptable porque:

- En la práctica, dos jugadores distintos no juegan a la vez en el
  mismo lado: el lado es una cámara fija.
- Más probable que el caso surja por error de usuario (alguien dejó
  un partido sin cerrar). El usuario "real" no se ve afectado.

**Si en producción aparece como problema**, opciones para etapas
futuras:

1. Validar en `create` que no exista otro partido `active` con el
   mismo `loc/can/lado` y `startedAt < now < endedAt` (requiere
   transacción + nuevo índice).
2. Al iniciar un partido en un lado donde ya hay otro `active` de un
   usuario distinto, mostrar advertencia en UI.
3. (Pesado) Resolver por orden de `claim`: el usuario que primero
   marca participación en el clip "gana" el clip.

Ninguna de las tres es necesaria en Etapa 3.

## 7. Lo que NO está en esta etapa (y por qué)

- Subcolección `matches/{matchId}/clips/{videoId}` con escritura explícita
  del pipeline → requiere modificar el pipeline Python, fuera de alcance.
- Cloud Functions para auto-cancel, contar clips por trigger, validar
  marcador, etc. → Etapa 11.
- Foto de fondo + html2canvas + Web Share API del resumen → Etapa 6.
- Cualquier UI que el usuario final vea (`entrada.html`,
  `mi-partido.html`, `resumen.html`) → Etapas 4, 5, 6.
- Integración con detección de visión (heatmap, golpes) → Etapa 8.
