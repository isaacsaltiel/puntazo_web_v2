# Worker #13 — ETAPA G1: LOOP DE CRECIMIENTO (invitar por WhatsApp + cerrar el arco del invitado)

## Por qué esta etapa (la palanca #1 de las 12 auditorías)
Hoy reclamar partidos e invitados son **sumideros**: traen 1 usuario por casualidad y terminan. Cada partido
tiene ~3 jugadores sin cuenta = **3 invitaciones desperdiciadas**. El activo que diferencia a Puntazo (clips +
nivel + historial ya acumulados a nombre del invitado) es exactamente el gancho que usan MileSplit ("Claim your
profile"), Strava ("invite to activity") y Splitwise (merge invite→cuenta). Convertir cada partido en **k>1** es
el motor de adquisición que ninguna app de pádel tiene. **Canal: WhatsApp** (nativo del mercado México).

> Lee: `docs/plans/auditoria-implementaciones-2026-06-08.md` §1 T1 y §2 (1)(2). Reusa infra existente
> (claim `confirmar.html?id=`, links, sugerencia retro E4, `guests.js`, EN2). NO reinventes el claim.

## Objetivo
Que el dueño de un partido **invite por WhatsApp** a sus jugadores sin cuenta, con un mensaje que vende el activo
("te tengo N partidos con tus clips y tu nivel, reclámalos"), y que cuando el invitado se une **el dueño se entere**
(cierre del bucle emocional → invita a más).

## Alcance

### A. Invitar a un invitado por WhatsApp (CLIENTE) — el corazón
1. En `amigos.html` (sección "Mis invitados", de E3c/E4): por cada invitado, botón **"Invitar por WhatsApp"**.
2. El link debe llevar al invitado a **reclamar sus partidos**. Reusa el flujo de claim existente:
   - Busca el partido pendiente/reciente más relevante donde ese `guestId` (o sus alias, `aliasGuestIds`) aparece
     en un slot sin `uid` → arma `confirmar.html?id=<matchId>` (el claim ya sugiere retroactivamente los demás,
     E4). Si hay varios, toma el más reciente; si no hay ninguno pendiente, degrada a un link de bienvenida.
   - Mensaje pre-cargado (WhatsApp `https://wa.me/?text=`): *"¡Jugué contigo! Te tengo tus partidos guardados en
     Puntazo con tus clips y tu nivel 🎾 Reclámalos aquí 👉 <link>"*. Tono México, cálido, concreto.
3. También ofrecer la invitación **justo después de registrar un partido** con jugadores sin cuenta (en el resumen
   del partido / `mi-partido.html`): "Faltan 2 jugadores sin cuenta — invítalos y el partido cuenta para todos".

### B. Cerrar el bucle: avisar al dueño cuando su invitado se une (SERVIDOR, EN2)
4. Cuando alguien **reclama** un slot que tenía `guestId`+`ownerUid` (en `match-actions.claim`), marcar el guest del
   dueño: `users/{ownerUid}/guests/{guestId}.claimedByUid = <nuevo uid>` (hoy se deja en null — la auditoría lo
   detectó "modelado pero muerto"). Esto NO lo puede escribir el claimer (no es su colección) → hazlo en un
   **trigger server-side** (functions) `onMatchWritten`/extendiendo el de notificaciones: al detectar que un slot
   pasó de `uid:null`+`guestId` a tener `uid`, escribir `claimedByUid` en el guest del owner Y emitir una notif EN2
   `guest_claimed` al dueño: *"🎉 [Nombre] se unió a Puntazo y reclamó su lugar"*. Idempotente (`ensureNotif`).
5. Nuevo builder en `functions/lib/notify.js` + payload. Pruébalo en emulador.

### C. (opcional, si da tiempo) Métrica del loop
6. Contar invitaciones enviadas / reclamadas (un campo o evento) para poder medir el k-factor. Sin sobre-ingeniería.

## FUERA de alcance
- Landing de claim por-persona dedicada (v2; G1 reusa `confirmar.html?id=` por-partido).
- Push FCM (track aparte). Fusión de invitados (ya existe, no tocar). Ranking/standings.

## Riesgos / cuidados
- **Privacidad:** `aliasGuestIds` solo lee guests del usuario actual (correcto). El claimer NO debe ver guests
  ajenos. El link de invitación lo arma el DUEÑO (que sí es dueño de esos guests), no el invitado.
- **Reglas:** el cliente NO puede escribir `claimedByUid` en guests ajenos → debe ser server-side (B). NO abras esa
  escritura en reglas.
- **Degradar:** si no hay partido pendiente para el guest, el botón sigue funcionando con un link de bienvenida; el
  registro/claim nunca se rompe por esto (best-effort, como `ensureGuest`).
- **Mensaje WhatsApp:** `encodeURIComponent` del texto+link. Probar en iOS y Android (wa.me).
- CRLF/mojibake cero. JS ajeno sin commitear → no incluir. Backend probado en emulador, lo despliega el maestro.

## Validaciones
- `node --check` de lo tocado. Lógica pura en Node del "elegir el mejor partido del guest para el link" (alias +
  recencia + slot sin uid). Emulador: trigger `guest_claimed` (slot gana uid → claimedByUid escrito + notif al
  dueño; idempotente; no dispara para slots que ya tenían uid).
- Smoke sembrado (pídeselo al maestro): dueño con invitado "Gabo" en 2 partidos → "Invitar por WhatsApp" abre wa.me
  con link a confirmar → reclamar → el dueño recibe notif "Gabo se unió". 

## Definition of Done
- Botón "Invitar por WhatsApp" en invitados (amigos.html) + en el post-registro, con link de claim real + mensaje.
- `claimedByUid` + notif `guest_claimed` al dueño (server-side, emulador). 
- Commit quirúrgico + push; backend lo despliega el maestro.

## Reporte (OBLIGATORIO): mismo formato que las etapas previas (## REPORTE ETAPA G1 + secciones).
