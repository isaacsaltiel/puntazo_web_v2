# Plataforma social Puntazo — Estado maestro + Roadmap

> **Documento vivo.** Última actualización: 2026-06-07 (noche).
> Punto único de verdad del estado. Si eres un chat nuevo, **lee esto primero**
> junto con la memoria `project-social-platform-spec-2026-06-07`.

---

## 🎯 LA META (North Star)

Construir la capa social de Puntazo enfocada en **ranking + registro de partidos + ligas**,
con dos viajes del usuario:

1. **In-club (con hardware/clips):** ya juegas en un club con NUC; tus partidos generan
   clips y el ranking se mueve solo.
2. **Sin hardware (cuña de crecimiento):** registras un partido jugado en CUALQUIER lado,
   con confirmación del rival (peer-confirmed), sin cámara. Esto es lo que permite que
   Puntazo crezca fuera de los clubes con hardware.

**Mandato:** ejecución excepcional, no rápida. Investigar/comparar antes de inventar.
Auditar cada fase. Validar antes de avanzar. "Poco a poco." Lenguaje no técnico con Isaac.

---

## 🔒 DECISIONES LOCKED (resumen; detalle en memoria spec)

- **Ranking:** numérico TRANSPARENTE escala 1.0–7.0, autoritativo **server-side** (Cloud
  Function). Motor Glicko-2 + afinaciones v2 (games/margen, mérito vs mejores, mezcla de
  pareja 75/25, convergencia lenta de parejas inseparables, "perder cuesta" pero partidazo
  amortigua, NO inflación, anti-farmeo 72h).
- **Doble rating:** GLOBAL (por deporte) + LOCAL (por club Y por grupo). Local se siembra
  del global con RD inflado.
- **Identidad híbrida:** quien registra tiene cuenta; los demás pueden ser dummies sin uid,
  reclamables después.
- **Confirmación:** "1 de cada equipo". Todos los 4 nombres se registran (dummies ok).
  Caduca a 7 días si no se confirma. **El RIVAL siempre confirma — NO existe autoconfirmar**
  (decisión Isaac 7-jun: muro anti-trampa).
- **Ligas:** "liga de amigos" = ranking de RÉCORD (W/L, puntos, subir/bajar fácil), DISTINTO
  del número Glicko. Reusar estética + lógica de tabla de Torneo 5. "Que los amigos se piquen."
- **Búsqueda de usuarios al registrar:** en TODA la base (no solo amigos), con amigos/recientes
  priorizados arriba. Exponer solo displayName + handle público.

---

## 🗺️ FASES

| Fase | Qué es | Estado |
|---|---|---|
| GATE-0 | Motor Glicko-2 + export dual | ✅ hecho |
| F1 | CF `onMatchConfirmed` (global+local, idempotente) | ✅ **LIVE** |
| F2 | Máquina de confirmación + reglas de matches | ✅ código; reglas pendientes de reconciliar |
| F3 | Datos + leaderboards backend | ✅ hecho |
| F5 | Leaderboards backend (tablas por contexto) | ✅ **LIVE** (escribe la CF) |
| Validación | Monte Carlo a escala (precisión/estabilidad/robustez/anti-farmeo) | ✅ hecho |
| Deploy | Blaze + functions + reglas | ✅ functions LIVE; reglas v100 restauradas |
| **F4** | **UI jornada sin hardware (registrar → confirmar → ranking)** | ✅ **construido + LIVE**, falta verificación browser de Isaac |
| F6 | Torneo5→sessions + King/Americano escriben matches confirmed; liga de récord | ⬜ pendiente |
| — | Backend: revertir ranking en disputa (recompute parcial) | ⬜ pendiente (con F4) |

---

## ✅ ESTADO ACTUAL (qué está vivo HOY)

**En producción (`puntazo-clips`):**
- 3 Cloud Functions v2 (us-central1, Node 22): `onMatchConfirmed` (trigger Firestore),
  `expireUnconfirmedMatches` (cada 15 min), `recomputeAllRatings` (callable). Cleanup
  policy de imágenes a 1 día.
- Smoke test E2E en prod **PASÓ**: partido 6-4 6-3 → ganadores 3.53, perdedores 2.9,
  leaderboard escrito, sin rastro tras limpieza.
- Reglas Firestore **v100 puro** (restauradas tras incidente; ver abajo).
- Blaze activo (cuenta "Pago de Firebase", MXN; presupuesto $100 MXN = solo alerta).

**Construido, no aún funcional en prod:**
- `registrar-min.html`: flujo completo cableado (login → registrar → link confirmación) +
  lógica de scoring de pádel real (auto-avanza set válido, auto-termina, último set flexible).
  NO funciona contra prod todavía porque las reglas v100 no permiten crear `pending_confirmation`.
  No está enlazado en el nav (no lanzado).
- `assets/match-actions.js`, `match-confirmation.js`: register/confirm/dispute (probados Node).
- Motor v2 (`assets/ranking.js`) en working tree SIN commitear; las functions se desplegaron
  desde ahí (vendor). Para que las páginas de LECTURA muestren v2 hay que commitear/pushear.

---

## ⚠️ INCIDENTE 7-jun (resuelto) — disciplina de reglas

`firestore.rules` del repo es un **WIP que dice "NO DESPLEGAR TAL CUAL"** (solo colecciones
nuevas + deny por defecto). Se desplegó por error → tumbó lecturas del sitio (~30-40 min)
hasta restaurar v100. El smoke test con service account NO lo detecta (Admin SDK omite reglas).

**REGLA PERMANENTE:** antes de deployar reglas → reconciliar v100 (`docs/plans/firestore-rules-v100-fase3.md`)
+ colecciones de ranking en UN archivo + **probar en emulador** (`functions/itest/rules-emu.js`).
Conflicto a fusionar: `matches` v100 (create exige `active`) vs registro (`pending_confirmation`).

---

## 🔨 F4 — PLAN DETALLADO (en curso)

Objetivo: que el registro sin hardware funcione end-to-end en el navegador.

1. **Reglas reconciliadas** — v100 + `ratings`/`leaderboards`/`processedMatches` + bloque
   `matches` que soporte ambos flujos. **Seguridad locked: el rival SIEMPRE confirma**; el
   organizador NO puede mover el partido a `confirmed` por sí solo. Probar en emulador
   (extender `rules-emu.js` con tests del flujo legacy + anti-autoconfirmación) ANTES de deploy.
2. **Búsqueda de usuarios en toda la base** — `identity.js`: campo normalizado `searchName`
   en `users/{uid}` + `searchUsers(query)` (prefijo por nombre + handle exacto). Integrar al
   autocomplete (hoy solo busca jugadores recientes). Backfill de usuarios existentes.
3. **`confirmar.html`** — carga el partido por id, muestra marcador + equipos, el rival
   logueado confirma/disputa, y tras confirmar ve "tu nivel se movió".
4. **Deploy reglas reconciliadas** (solo si emulador pasa) → **Isaac verifica en navegador**.

---

## ✅ F4 — HECHO (7-jun noche)

- **Reglas reconciliadas** deployadas (v100 + ranking + `matches` ambos flujos, anti-autoconfirmar
  `uid != userId`). Probadas en emulador 15/15 (`functions/itest/rules-emu.js`).
- **Búsqueda en toda la base** (`identity.searchUsers`: prefijo nombre + handle; campo `searchName`
  + backfill en login). Backfill admin de los 7 usuarios existentes corrido.
- **Autocomplete** con búsqueda global opt-in (`global:true`), merge recientes + base.
- **`confirmar.html`** construido (rival confirma/disputa, ve su nivel moverse).
- Todo **pusheado a GitHub Pages** (commit a806a0b85). Páginas NO enlazadas en nav (solo URL directa).
- FALTA: **verificación en navegador de Isaac** (gated). Checklist: registrar con 2 cuentas →
  link de confirmación → el rival confirma → ambos ven su nivel.

## 📌 PENDIENTES (para evaluación / fases futuras)

- **QR para unir a un partido** (en vez de link) + **QR para agregar amigo** — evaluar.
- **Liga de récord** (W/L estilo Torneo 5) — F6.
- **Revertir ranking en disputa** (recompute parcial) — backend, con F4.
- **Commitear/pushear motor v2** (`assets/ranking.js` + `ranking-read.js`) para que las
  páginas de lectura muestren v2.
- **F6:** Torneo5→sessions; King/Americano→matches confirmed (vía Admin SDK o reglas propias
  revisadas — NO abrir create-as-confirmed desde cliente).
- **Análisis IA de video** (padel_analyze.py) vive en la NUC, NO en la nube; sube solo el
  resultado (stats.json/heatmap) a Firebase, igual que los clips.

---

## 🔑 ARQUITECTURA EN UNA LÍNEA

> La web (GitHub Pages) sirve archivos; el navegador habla DIRECTO con Firestore; la Cloud
> Function vive DENTRO de Firebase y recalcula el ranking al confirmarse un partido. GitHub
> nunca entra en el loop de datos. El ranking es server-authoritative para que nadie lo trampee.
