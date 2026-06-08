# Acciones y validaciones que le tocan a Isaac (gated)

> Todo lo que NO puedo hacer yo solo porque implica **dinero, cuenta, producción
> o verificación visual**. Construyo y pruebo todo en el emulador; estos son los
> pasos que requieren tu mano o tu OK. Actualizado: 2026-06-07.
>
> Estado: ⬜ pendiente · 🔄 listo para ti (yo ya hice mi parte) · ✅ hecho

---

## 🔴 Bloqueantes para que el ranking funcione en PRODUCCIÓN

- ⬜ **A1 — Activar Blaze (plan de pago) en Firebase `puntazo-clips`.**
  Cloud Functions lo requiere. A tu escala cae en el tier gratuito perpetuo
  (2M invocaciones/mes) → costo efectivo ~$0. Solo necesita tarjeta en archivo.
  Console → Firebase → ⚙️ → Uso y facturación → Modificar plan → Blaze.

- 🔄 **A2 — Deploy de las Cloud Functions.** (depende de A1)
  Yo lo dejo listo y probado en emulador. Tú corres (o me autorizas a correr):
  `firebase deploy --only functions`
  Despliega `onMatchConfirmed`, `expireUnconfirmedMatches`, `recomputeAllRatings`.
  El predeploy vendoriza el motor automáticamente.

- 🔄 **A3 — Deploy de reglas Firestore.** (lección del outage 06-03)
  Yo reconcilio `firestore.rules` con las reglas VIVAS de la consola + las pruebo
  en emulador + grep de todos los `source`. Tú das el OK y deployas
  (`firebase deploy --only firestore:rules`) o me autorizas con el SA.
  **NO se deploya sin tu confirmación explícita.**

## 🟡 Configuración puntual

- ⬜ **A4 — Marcar tu uid como admin** para poder usar `recomputeAllRatings`.
  Poner `flags.isAdmin = true` en tu doc `users/{tuUid}` (lo puedo hacer yo con el
  SA si me confirmas tu uid, o tú desde la consola).

- ⬜ **A5 — Veto de diseño: confirmación SIN auto-confirm.**
  Decidí mantener confirmación **activa** (un rival debe aceptar; expira a 7 días sin
  contar) y NO el auto-confirm a 24h estilo Playtomic, porque reabriría el hueco de
  "inventar un resultado solo". Si quieres el auto-confirm igual, avísame. (spec §6.4)

## 🟢 Validaciones que necesitan OJOS (navegador / partido real)

- ⬜ **A6 — Verificar en navegador la UI de "mi nivel"** (F3) cuando esté lista:
  que el número 1.0–7.0, la fiabilidad y el global/local se vean bien en móvil.

- ⬜ **A7 — Verificar el flujo de registro + confirmación** (F4) con DOS cuentas:
  registras un partido desde la cuenta A → le llega a la B → la B confirma → el
  ranking de ambos se actualiza. (Esto valida la jornada sin hardware end-to-end real.)

- ⬜ **A8 — Partido de prueba en PRODUCCIÓN** (post A1–A3): un partido real confirmado
  que mueva el ranking en vivo, y borrar el doc de prueba después.

## ⚪ Higiene de seguridad (del audit, no bloquean el ranking pero importan)

- ⬜ **A9 — Sacar secretos de los repos de las NUCs** (password NVR trackeado + SA JSON
  no-ignorado en los 3 runners). Worker HP pendiente. (audit Riesgo #3)
- ⬜ **A10 — Privacidad server-side**: hoy `users/{uid}` es `read: if true`; los settings
  de privacidad son cosméticos. Se aborda en una fase posterior (modelo espejo o reglas).

---

### Lo que YO sigo haciendo sin ti (no gated)
Reglas en emulador → F3 (cliente lee ratings/) → F4 (UI registro/confirmar) → F5 (ligas)
→ F6 (sesiones). Cada fase con sus tests. Tú entras en los puntos de arriba.
