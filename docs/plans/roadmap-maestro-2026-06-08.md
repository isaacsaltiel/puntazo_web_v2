# Roadmap Maestro — Plataforma Social Puntazo (8-jun-2026)

> **Modelo operativo: maestro → workers.** Este chat (maestro) conserva contexto, diseña
> roadmap, escribe prompts+briefs para workers efímeros, revisa reportes, decide siguiente
> etapa. Los workers ejecutan UNA etapa, sin improvisar scope. Fuente de verdad del estado:
> este doc + `estado-y-roadmap-plataforma-social-2026-06-07.md` + memoria
> `project-social-platform-spec-2026-06-07`.

---

## Estado actual (qué está LIVE)

- **Backend ranking**: 3 Cloud Functions v2 (onMatchConfirmed, expireUnconfirmed, recompute) —
  LIVE y probadas en prod. Escriben `ratings/{uid}` y `leaderboards/{ctx}/entries/{uid}`.
- **Reglas Firestore reconciliadas** (v100 + ranking + matches 2 flujos, anti-autoconfirmar) —
  LIVE, probadas en emulador 15/15.
- **F4 registro sin hardware**: `registrar-min.html` (registra→link), `confirmar.html`
  (rival confirma→ranking), búsqueda global (`identity.searchUsers`), watcher de "partido por
  confirmar", banner de "clip listo" mejorado. Pusheado. **NO enlazado en nav** (solo URL).
- **DEUDA**: backend (`functions/`, `firestore.rules`, `firebase.json`) **sin commitear en git**.

---

## Etapas (con dependencias)

| Etapa | Qué | Depende de | Tipo |
|---|---|---|---|
| **E0** | Hygiene: commitear backend a git (`functions/`, `firestore.rules`, `firebase.json`, tests) | — | Quick |
| **E1** | **Tablero global de ranking + tu número en perfil** (UI read-only sobre backend live) | — | Quick |
| **E2** | Enlazar `registrar-min`/`confirmar` en el nav + pulir entradas | E1 | Quick |
| **E3** | **Claiming v1**: registrar con puros dummies + dummies persistentes + link + "yo soy X" + auto-amistad + declinar. Reglas claim/decline (emulador→deploy reconciliado) | F4 (hecho) | Profundo |
| **E4** | Claiming v2: sugerencias retroactivas (mismo guest en otros pendientes) + merge/borrar invitados | E3 | Medio |
| **E5** | **Head-to-Head** en perfil de jugador (historial, victorias, games, sets) | matches (existe) | Medio |
| **E6** | **Ligas — estructura + miembros**: crear liga (modo indiv/parejas), agregar miembros (buscador + link "únete") | groups (existe), E3 (link/invite) | Profundo |
| **E7** | **Ligas — juego**: registrar a la liga (desde liga o registrar-min), tabla multi-período (sem/mes/año), desempates Torneo 5, % , últimos enfrentamientos, campeón | E6, E1 (patrón leaderboard) | Profundo |

### Dependencias clave
- E3 (claiming) desbloquea el crecimiento real y el invite-link que reusa E6.
- E1 establece el patrón de leaderboard que reusa E7.
- E5 (head-to-head) es independiente → buen relleno paralelo.

---

## A. Quick wins vs Arquitectura profunda

**Quick wins (visibles, bajo riesgo, sin tocar data model):**
- **E0** — git hygiene (protege lo construido). ~30 min.
- **E1** — tablero global + número en perfil. Motor ya corre; es leer y pintar. **Mejor primer fruto visible.**
- **E2** — enlazar en nav.
- **E5** — head-to-head (lectura/agregación de matches; medio pero aislado).

**Arquitectura profunda (data model + reglas + identidad):**
- **E3/E4** — claiming + dummies persistentes: nuevo modelo `guests`, reglas nuevas (claim/decline)
  con emulador + deploy reconciliado, página de claim, declinar. Es el corazón del wedge.
- **E6/E7** — ligas: motor de standings multi-período + desempates + membresía + invites.

**Regla de oro de orden:** primero lo que da valor visible sin deuda (E0→E1→E2), luego el
refactor de identidad (E3/E4) que TODO lo social necesita, luego ligas (E6/E7). E5 se puede
intercalar en paralelo.

---

## B. Orden recomendado de workers

1. **E1** — Tablero global + número en perfil (worker #1). Aislado, valida el flujo maestro→worker.
2. **E0** — git hygiene (worker corto, o se hace junto a E1).
3. **E3** — Claiming v1 (worker grande; el maestro parte en sub-etapas si conviene: 3a reglas+modelo, 3b UI).
4. **E5** — Head-to-head (paralelizable).
5. **E6 → E7** — Ligas.

---

## Bitácora de etapas
- **E1 ✅ (commit 90197df45)** — `clasificacion.html` (tablero global) + número global en `perfil.html`
  + link desde `mi-nivel.html`. Validado con datos reales. OJO: replica thresholds nivel→emoji de
  ranking.js inline (deuda menor). `tablero.html` ya existía (marcador en vivo) → por eso `clasificacion.html`.
- **E0 (backend) ✅ (commit efb20b237)** — consolidado en git: `functions/`, `firestore.rules`,
  `firebase.json`, `firestore.indexes.json`, `.firebaserc`, `tests/`, docs de spec/roadmap.
  PENDIENTE E0b: revisar+commitear los JS web read-side (`matches.js` −108, `ranking.js` ±, `ranking-read.js`
  untracked) — cambian el sitio en vivo, requieren validación en navegador. Deuda aislada, no urgente.

## C. Worker activo
- Worker #1 (E1) ✅ cerrado. Siguiente: ver recomendación del maestro (E5 head-to-head o E2 nav).

---

## Cómo el maestro absorbe reportes
Worker entrega "REPORTE ETAPA X" → el maestro: (1) actualiza este doc + memoria, (2) verifica
contra Definition of Done, (3) decide siguiente etapa, (4) emite prompt+brief del siguiente worker.
