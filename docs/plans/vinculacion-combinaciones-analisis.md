# Análisis exhaustivo de vinculación de jugadores — 2026-05-29

> **Disparador**: Isaac probó el flow share/vincular/validar tras F103-F107.
> 2da cuenta vinculada vía `detalle.html?join=1` aceptó marcador, pero su
> partido NO apareció en SU perfil ni se actualizó SU ranking. Cuenta
> original (owner) sí ve todo bien.
>
> Este doc es la matriz exhaustiva de QUÉ formas de vinculación existen,
> CÓMO debería verse cada una en cada vista, y EL BUG ACTUAL identificado.

---

## 🔥 BUG ACTUAL identificado (causa raíz)

`detalle.html`'s `claimMatchSlot()` hace UNA SOLA cosa cuando alguien
hace tap a "Soy [Nombre]":

```js
const nuevaArr = (match.jugadores || []).map(function (j, i) {
  if (i !== idx) return j;
  return Object.assign({}, j, { uid: u.uid });   // ← inserta uid en jugadores[]
});
await window.PuntazoMatches.update(match.id, { jugadores: nuevaArr });
await window.PuntazoMatches.acceptScore(match.id, u.uid);  // ← marca aceptación
```

**NO crea documento en `matches/{matchId}/claims/{u.uid}`**.

`perfil.html` y `mis-partidos.html` y `ranking-client.js fetchUserMatches`
quieren matches via DOS queries:

1. `matches.where('userId', '==', myUid)` → captura matches donde soy
   OWNER (creador).
2. `db.collectionGroup('claims').where('uid', '==', myUid)` → captura
   matches donde reclamé slot vía documento claim.

**Cuenta 2 cae en el hueco**: no es owner (cuenta 1 lo es) Y no tiene
claim doc (claimMatchSlot no lo creó). Por eso desaparece.

---

## ✅ FIX requerido (próximo commit F108 / F109)

### Opción A (correcta y compatible): crear el claim doc

En `claimMatchSlot()` además del update de jugadores, hacer:

```js
await window.PuntazoMatches.claimSlot(match.id, {
  uid: u.uid,
  slot: idx,
  displayName: name || u.displayName || '',
});
```

`PuntazoMatches.claimSlot` ya existe en `assets/matches.js` (lo usa
resumen.html para slot claims). Mismo API.

### Opción B (defensiva adicional): cuando renderMatch detecta `jugadores[i].uid` sin claim correspondiente, crea el claim automáticamente.

Esto es backfill para matches viejos donde alguien quedó vinculado solo
en jugadores pero no en claims.

### Migración necesaria para Isaac

Script de una sola vez que itera `matches` colección, mira cada
`jugadores[i].uid`, y si no hay claim en `claims/{uid}`, crearlo.
Idempotente — si ya existe el claim, skip.

---

## 📊 Matriz exhaustiva de combinaciones de vinculación

Cada celda es un par (cómo me vinculo, dónde debe aparecer + qué debe pasar).

### Eje horizontal: dónde me vinculo
1. **OWNER al crear match**: `match.userId = mi uid`. Match nace asociado a mí.
2. **OWNER en mi-partido edit**: en sheet edit-team del modal terminar marco "Soy yo" → `jugadores[i].uid = mi uid`.
3. **OWNER en modal terminar (creator)**: similar a 2 pero antes de save.
4. **INVITADO via mi-partido slot tap** (cancha activa, no modal): `claimSlot` doc creado + `jugadores[i].uid` también.
5. **INVITADO via resumen.html `rsOpenClaimModal`**: `claimSlot` doc creado + `jugadores[i].uid`.
6. **INVITADO via detalle.html `claimMatchSlot`** ← BUG ACTUAL: solo `jugadores[i].uid`, NO claim doc.
7. **INVITADO via overlay viejo `dt-join-overlay`**: mismo bug que 6 (función `claimSlot` interna no creaba claim doc).

### Eje vertical: dónde debe aparecer
- **A. Perfil "Mis partidos"** (top 3) — queries: `matches.where(userId == myUid)` ∪ `collectionGroup('claims').where(uid == myUid)`.
- **B. mis-partidos.html** (todos) — mismas queries.
- **C. Mi nivel computeMyRating** — mismas queries (vía fetchUserMatches).
- **D. detalle.html `renderClaimBlock`** — chequea si user está en `jugadores[i].uid` o `claimedByUid`.
- **E. detalle.html `renderAcceptanceBlock`** — chequea jugadores[].uid para detectar si soy player.
- **F. mi-partido.html durante partido** — chequea jugadores[].uid via `currentMatch.jugadores`.
- **G. Banner "Partido activo" (F105 header.js)** — `matches.where(userId == myUid).where(status == 'active')`.

### Tabla:

| # | Cómo me vinculo | A perfil | B mis-partidos | C mi-nivel | D detalle claim | E detalle accept | F mi-partido | G banner activo |
|---|---|---|---|---|---|---|---|---|
| 1 | Owner al crear | ✅ (via userId) | ✅ | ❌ no aporta a ranking si no estoy en jugadores[] | ✅ skip block | ⚠️ no soy player jugadores[] | ✅ owner UI | ✅ |
| 2 | Owner edit (Soy yo) | ✅ (userId) | ✅ | ✅ rankable | ✅ skip | ✅ player | ✅ | ✅ |
| 3 | Owner al terminar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/a |
| 4 | Invitado mi-partido | ✅ (via claim) | ✅ | ✅ | ✅ | ✅ | ✅ | n/a |
| 5 | Invitado resumen | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a |
| 6 | **Invitado detalle (BUG)** | ❌ no aparece | ❌ no aparece | ❌ matchCount=0 | ✅ skip | ✅ | n/a | n/a |
| 7 | Invitado overlay viejo | ❌ (mismo bug 6) | ❌ | ❌ | ✅ skip | ✅ | n/a | n/a |

**Conclusión**: el fix es atómico — agregar `PuntazoMatches.claimSlot` en
`claimMatchSlot` de detalle.html resuelve filas 6 y 7 simultáneamente.

---

## 🧪 Edge cases para verificar después del fix

1. **2 cuentas mismo uid (raro pero posible)**: Firebase nunca da el mismo
   uid a 2 cuentas. Si pasara, claim sería upsert (overwrite ok).
2. **Anónimo que se convierte en logueado**: anonymous user reclamó → después
   linkea con Google → su uid cambia. Su claim queda atado al uid viejo.
   No es problema crítico hoy (anónimos no claiman en detalle), pero será
   issue cuando habilitemos.
3. **Owner que también es player**: cuenta crea match Y se vincula a slot 0.
   Tiene 2 razones para aparecer en queries (userId + claim). Dedupe por
   matchId en perfil/mis-partidos ya lo maneja (F101).
4. **Slot reasignado** (caso de re-vinculación): user1 reclama slot 0,
   después user2 también reclama slot 0. ¿Qué pasa con el claim doc?
   Actualmente `claimSlot(matchId, {slot})` permite slot in [0..3], pero
   no impide colisión. Necesitamos enforcement.
5. **Owner cambia jugadores[]** post-vinculación: si owner edita y quita
   uid de un slot via mi-partido edit, el claim del invitado queda
   huérfano. Cleanup necesario.
6. **Disconnect múltiple**: el user ya no quiere estar vinculado → no
   tenemos botón "Desvincularme del partido". Falta.

---

## 🛡️ Validaciones que el fix debe respetar

- **No duplicar claims**: si ya hay un claim doc con mi uid en ese
  match, no crear otro. Idempotente.
- **No sobrescribir uid de otro**: si `jugadores[idx].uid !== null` y
  `!== mi uid`, no permitir reclamo (slot ocupado por otra cuenta).
  El reclamo desde detalle solo aplica a slots con `nombre && !uid`
  (ya está validado en `renderClaimBlock`).
- **Atomicidad**: el update de jugadores y el create de claim deben ser
  consistentes. Si falla uno y el otro pasa, el match queda en estado
  raro. Idealmente: batch write Firestore. (`db.batch()`).

---

## 📋 Siguiente commit (F108 o F109) — Plan de fix

1. **Modificar `assets/matches.js`**: nada (claimSlot ya existe).
2. **Modificar `detalle.html` `claimMatchSlot()`**:
   - Llamar `PuntazoMatches.claimSlot(matchId, {uid, slot, displayName})`.
   - Hacer en batch con update de jugadores y acceptScore (3 ops, 1 batch).
3. **Backfill script** (opcional, una vez): iterar matches existentes,
   detectar `jugadores[i].uid` sin claim correspondiente, crear claim.
   Standalone, llamar manualmente desde consola del browser una sola vez.
4. **Tests manuales post-fix**:
   - Cuenta A crea match, comparte link.
   - Cuenta B abre link, "Soy [Nombre]", verifica:
     - Detalle muestra ✅ aceptado.
     - Cuenta B en perfil → match aparece en Mis partidos.
     - Cuenta B en Mi nivel → match cuenta como rankable (si rivales OK).
     - Cuenta A sigue viendo todo bien.

---

## 🚧 Pendiente para próxima sesión post-/compact

Items adicionales del último dictado de Isaac:

### Notificaciones push al teléfono

- **Sí se puede** con Web Push API + Firebase Cloud Messaging (FCM).
- **Android Chrome**: funciona out-of-the-box con permiso del user.
- **iOS Safari 16.4+**: requiere instalar Puntazo como PWA (Add to
  Home Screen) antes. Sin PWA install no hay push en iOS.
- **Setup necesario**:
  - Service worker (`assets/sw.js`) con FCM SDK.
  - Web Push public key (VAPID) en Firebase Console → Cloud Messaging.
  - Backend para enviar — Cloud Function o trigger.
- **Eventos a notificar** (cuando lo activemos):
  - Te claimaron un slot en tu match.
  - Alguien aceptó el marcador.
  - Tu rating cambió de bucket.
  - Tu clip está listo (puntazo visible).
- **Costo**: gratis hasta cierta escala (FCM es gratis).
- **Decisión**: hacerlo cuando flow de vinculación esté 100% sólido.
  Notificar de algo que no funciona empeora.

### Auto-terminar partidos por timeout

- Modo `partido_3` → 1h máximo.
- Modo `partido_5` → 2h máximo.
- Modo `reta` / `libre` → discutible (a Isaac decidir; sugiero 90 min).
- Aviso 15 min antes con CTA "Sigo jugando" que extiende.
- Si no responde → `status = "ended"` automático.
- Próxima visita del usuario: banner "Tenías un partido sin cerrar — ¿registrar resultado?".

**Implementación**:
- Sin Cloud Function aún (no hemos setup): timer client-side en
  `mi-partido.html` durante partido activo. Si user navega afuera,
  el timer se pierde. Need:
  - Opción A (corto plazo): client-side timer + servidor verifica al
    siguiente acceso del user a perfil. Si encuentra match active
    >timeout → muestra modal "Tu partido se cerró automáticamente".
  - Opción B (largo plazo): Cloud Scheduler + Firestore trigger que
    cierra matches active con `startedAt < now - timeout`.
- Decisión: hacer Opción A primero. Opción B cuando setup Functions.

### Recordatorio "partido pendiente"

- En el próximo entry a entrada.html o perfil.html, si hay match con
  `status="active"` Y `startedAt > timeout`:
  - Mostrar modal: "Tu partido en [Club · Cancha] del [fecha] sigue
    activo desde hace [tiempo]. ¿Registrar el resultado ahora?"
  - Opciones: "Ir a registrar" / "Cancelar partido" / "Cerrar".
- Lógica idéntica al banner F105 pero con threshold de tiempo.

---

## 📌 Notas técnicas

- `matches/{id}/claims/{uid}` ya existe como colección, con rules:
  - create: si `request.auth.uid == claimUid` Y `slot in [0,1,2,3]` Y
    `claimedAt == request.time`.
- F96 agregó `match /{path=**}/claims/{claimUid} { allow read: if true }`
  para que collectionGroup funcione.
- Por lo tanto, `claimSlot` desde detalle DEBE funcionar — las rules ya
  permiten.

---

## 🔗 Referencias en código

- `assets/matches.js claimSlot(matchId, opts)` — F-NN ya existente, busca
  función con ese nombre.
- `detalle.html claimMatchSlot(match, idx, name, btn)` — agregar llamada
  a PuntazoMatches.claimSlot ahí.
- `perfil.html` líneas 770-825 — query combinada (owner + claims).
- `mis-partidos.html` líneas 185-240 — misma query.
- `assets/ranking-client.js fetchUserMatches(uid)` — misma query.

Todo apunta al mismo punto único de fix: detalle.html claimMatchSlot.
