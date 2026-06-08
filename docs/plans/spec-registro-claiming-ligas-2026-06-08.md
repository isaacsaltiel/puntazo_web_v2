# Spec — Registro sin fricción, Claiming, Head-to-Head y Ligas (8-jun-2026)

> Documentación formal de los flujos dictados por Isaac (7–8 jun). LOCKED salvo nota
> explícita. Complementa: `spec-plataforma-social-2026-06-07.md`,
> `estado-y-roadmap-plataforma-social-2026-06-07.md` y la memoria
> `project-social-platform-spec-2026-06-07`.

---

## 1. Principio rector

**Registrar un partido NUNCA debe trabarse por falta de cuentas.** Puedes registrar con
puros nombres; las cuentas/confirmaciones llegan después vía link. El ranking solo se
mueve cuando un **rival con cuenta** confirma.

---

## 2. Identidad: usuarios, dummies persistentes, claiming

### 2.1 Tipos de jugador en un partido
- **Usuario** (uid real): tiene cuenta. Buscado en toda la base con el buscador único.
- **Dummy / invitado** (sin uid): un nombre. Puede reclamarse después.

### 2.2 Dummies PERSISTENTES (decisión Isaac #3)
Un dummy no es texto libre desechable: es una entidad reusable del que lo creó.
- Modelo: `users/{ownerUid}/guests/{guestId}` = `{ name, searchName, createdAt, lastUsedAt, claimedByUid|null }`.
- Al registrar, el dueño elige de **sus invitados guardados** o crea uno nuevo (el buscador
  muestra: usuarios de la base + mis invitados recientes + "+ crear invitado X").
- En el match, un dummy se guarda como `{ nombre, equipo, guestId, ownerUid, uid:null }`.
  Así "Gabo de ayer" y "Gabo de hoy" = **mismo guestId**.

### 2.3 Claiming ("yo soy Pedro")
1. El dummy abre el link → crea cuenta (Google) si no tiene.
2. La página de claim muestra el partido y pregunta **"¿cuál eres?"**, resaltando el dummy
   cuyo nombre se parece a su nombre de Google.
3. Al reclamar: el `jugadores[slot].uid` se setea a su uid, entra a `playerUids`, y el guest
   queda `claimedByUid = su uid`. **Se hace amigo de los 4** del partido (decisión #1).
4. **Si es del equipo RIVAL → puede confirmar.** Si es del equipo del registrante → solo
   queda asociado (no confirma).

### 2.4 Sugerencias retroactivas (decisión #3)
Cuando alguien reclama un guest con `guestId = G` (o crea cuenta), se buscan **otros partidos
pendientes** con ese mismo `guestId` y se le ofrecen como sugerencia: **"¿También eres tú en
estos?"** → reclama en lote. NO automático: siempre confirma el usuario.

### 2.5 Merge / borrar dummies (decisión #3)
El dueño del guest puede, desde su gestión de invitados:
- **Borrar** un invitado duplicado (no altera partidos pasados ya confirmados).
- **Asociar** un invitado a un usuario real (merge): aplica de aquí en adelante + ofrece
  reclamar los pendientes. *Fuera de v1:* re-calcular ranking de partidos YA confirmados
  (evitar recompute retroactivo en v1).

### 2.6 Declinar invitación (decisión #1, nuevo)
Si te agregaron a un partido **directo a tu cuenta** (te buscaron, no por link) y **no jugaste**,
puedes **DECLINAR**:
- Si eres del equipo rival → declinar = no confirmar / disputar ("yo no jugué esto").
- Si eres compañero → "no fui yo" te **remueve** del partido (tu uid sale de jugadores/playerUids;
  el slot vuelve a dummy). El registrante recibe aviso.
- Notificación: el watcher de "partido por confirmar" ya cubre el aviso; se le agrega botón
  **"No jugué / declinar"**.

---

## 3. Flujo de registro (sin hardware) — final

1. Login (registrante siempre tiene cuenta).
2. Mete jugadores: por cada campo, el buscador único ofrece **usuarios de la base + mis
   invitados + "+ crear invitado"**. Se permite dejar dummies.
3. Captura marcador (lógica de pádel ya implementada).
4. Opcional: **marcar el partido a una liga** (ver §5) si ≥3 jugadores son miembros.
5. Pantalla final: lista **para quién falta cuenta** → botones de **WhatsApp / copiar link**
   por cada dummy (o un link general del partido). Mensaje: "confírmalo / únete".
6. El partido queda **pending_confirmation** (7 días). Solo cuenta cuando un **rival con
   cuenta reclama y confirma**. Si nadie reclama → caduca (void) y se avisa al registrante.

---

## 4. Head-to-Head en perfil de jugador (decisión #1, nuevo)

Al entrar al **perfil de otro jugador**, una sección **"Historial entre nosotros"**:
- Lista de enfrentamientos (partidos confirmados donde ambos uid jugaron), con marcador y fecha.
- **Totales**: victorias de cada uno (head-to-head), **games** totales de cada quien, **sets**
  totales de cada quien.
- Distingue cuando jugaron como rivales vs como compañeros.
- Fuente: query `matches` con ambos uid en `playerUids`, status confirmed. (Posible índice
  o agregación; el worker lo evalúa.)

---

## 5. Ligas — diseño LOCKED

Liga = grupo persistente (`groups/{groupId}` + members). Ranking de **récord** (no Glicko).
El MISMO partido confirmado alimenta el global Glicko Y la liga.

### 5.1 Creación y miembros
- El **creador elige el modo**: **individual** (parejas rotan) o **parejas fijas**.
- Agregar miembros con el **buscador único** (toda la base) + **link de "únete"** para los
  que no tienen cuenta (y para los que sí). Mismo patrón de WhatsApp/copiar.

### 5.2 Qué cuenta
- Un partido cuenta para la liga si está **marcado con ese `groupId`** y **≥3 de 4** jugadores
  son miembros (decisión #2).

### 5.3 Registrar a la liga
- Desde **dentro de la liga** (botón que pre-marca el groupId y pre-llena miembros) **o** desde
  `registrar-min` eligiendo la liga.

### 5.4 Tabla (estilo fútbol + Torneo 5)
- Columnas: **Pos · Jugador/Pareja · PJ · G · P · Pts · % · Dif**.
- **Ganar = 3, perder = 0.** Orden por Pts.
- **Desempate estilo Torneo 5: dif. sets → dif. games → head-to-head.**
- **% de victorias** como columna visible.

### 5.5 Multi-período (decisión #2, refinada)
- Tablas por **Semana · Mes · Año** (toggle). Resuelve "el que falta también baja": en cada
  período el ausente tiene PJ 0 / 0 pts → cae solo, sin castigo extra.
- Cada período **guarda su campeón** (palmarés).

### 5.6 Últimos enfrentamientos (nuevo)
- Sección en la liga con los **partidos recientes** (marcador + fecha + jugadores).

### 5.7 Cómputo
- **v1 client-side**: agregar los matches confirmed con ese `groupId` por período (como
  Torneo 5). Migrar a docs de standings server-side si crecen. NUNCA abrir create-as-confirmed
  desde cliente.

---

## 6. Reglas Firestore que esto requiere (resumen para workers)

- **Claim action** (NUEVA): un signedIn puede setear su uid en un slot **dummy (uid ausente)**
  de un match `pending_confirmation`, agregarse a `playerUids`, sin tocar `marcador` ni el uid
  de otros, sin marcar `ratingProcessed`. No puede reclamar si ya está en `playerUids`.
- **Decline (compañero)**: un player puede removerse a sí mismo de `jugadores`/`playerUids`
  (slot vuelve a dummy) en pending. Acotado.
- Mantener: rival-confirma (uid != userId), no autoconfirmar, anti create-as-confirmed.
- `users/{uid}/guests/{guestId}`: read/write solo el dueño.
- Toda regla nueva se prueba en emulador (`functions/itest/rules-emu.js`) ANTES de deploy, y se
  despliega el set RECONCILIADO completo (lección incidente 7-jun).

---

## 7. Anti-abuso (aceptado para v1)
Quien tenga el link puede reclamar. Riesgo de farmeo con cuentas falsas, **mitigado** por el
anti-farmeo del ranking (decae) + fricción de crear cuentas Google + disputa → revisión. Se
acepta para v1; revisar si escala.
