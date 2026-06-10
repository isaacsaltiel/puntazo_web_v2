# Auditoría integral — puntazo_web_v2 (2026-06-09)

> 4 auditorías paralelas (seguridad, calidad de código, UX/UI, funcionalidad) sobre master
> actualizado (8b6251525). Este doc es el plan de "dejar al 100" — funcionalidad, interfaz,
> prácticas de código y seguridad. Cada ítem lleva ✅ hecho / 🔲 pendiente / 🟠 decisión de Isaac.

---

## P0 — Seguridad crítica (✅ HECHO en rama `seguridad-p0-2026-06-09`, commit cd64aacc7)

1. ✅ **Escalación a admin** — `users/{uid}` permitía al dueño escribirse `flags.isAdmin=true`
   y disparar `recomputeAllRatings` (wipe de `ratings/` + `leaderboards/` + `processedMatches/`).
   Fix: `flags` es server-only (create lo rechaza, update bloquea `affectedKeys` con flags).
2. ✅ **`clip_edits` sin auth** — cualquier anónimo encolaba renders (gasto Actions/Dropbox).
   Fix: create exige sesión + `uid_creator == auth.uid`; `editor.html` con gate de sesión.
3. ✅ **Botón "disputar" muerto en confirmed** — `canDispute` ofrecía lo que las reglas niegan.
   Fix: solo PENDING.
4. ✅ Tests: rules-emu 24/24 (+2 candados), match-confirmation 10/10 (+1 assert).

**Para activarlo (Isaac):** merge a master + `npx firebase deploy --only firestore:rules`.

## P0.5 — Decisiones de producto de seguridad (🟠 Isaac decide, luego se implementa)

- 🟠 **`pending_pulses` rama in-club sin auth** (boton.html funciona sin login por diseño F144).
  Opciones: (a) dejar así (riesgo: spam de pulsos a la NUC), (b) Firebase Anonymous Auth en
  boton.html y exigir `signedIn()`, (c) exigir login real. Recomendación: (b).
- 🟠 **Privacidad no aplicada**: `users` y `matches` tienen `read: if true` — todos los perfiles
  y partidos son públicos sin login, ignorando `privacy.*` del modelo. Decidir modelo
  (mínimo: `read: if signedIn()`; ideal: respetar `privacy`). Ojo: lado.html/clips públicos
  pueden depender de matches read público — verificar antes.
- 🟠 **`data/passwords.json`** (sha256 sin salt de passwords de cancha) en repo público +
  `docs/passwords_manager.html`. Fuerza-brutable offline. Mover validación a Firestore/Function.
- 🟠 **Self-join a grupos sin inviteCode**: cualquier signedIn que conozca el groupId entra
  (reglas no validan código). Subir la validación a reglas requiere guardar el código en el doc
  y compararlo — diseño pendiente.
- Conocidos que siguen: claim por colusión (slot no verificable en reglas — mitigación = disputa),
  límites de tamaño de strings en users/groups/matches (anti-spam).

## P1 — Funcionalidad (huecos reales del flujo)

- 🔲 **`disputed` es callejón sin salida** — nada lo resuelve jamás (ni admin, ni scheduler;
  la UI promete "hasta que se resuelva"). Fix: callable `resolveDispute(matchId, outcome)`
  gateado a admin (ya con custom claim o flag server-only) + scheduler que void-ea >30 días.
- 🔲 **Claim no transfiere historial** — solo funciona en pending; los partidos
  confirmed/ended del invitado nunca se vinculan a su uid (la promesa G1 "te tengo N partidos"
  es falsa para histórico). Fix: backfill server-side en el trigger de guest_claim.
- 🔲 **`matches.js#end()` escribe "ended" legacy** — partidos in-club/live no alimentan ranking
  ni ligas (= Parte 2 staged de la unificación del nivel + limpiar rating semilla OQaVtozE).
- 🔲 **Notifs faltantes**: `match_confirmed` al registrante (cerrar el loop "tu rival confirmó"),
  `match_disputed` al registrante, "te agregaron a grupo/liga", "tu partido expira mañana".
- 🔲 **`ensureNotif` no atómico** (get-then-set → usar `create()`), functions/index.js:248.
- 🔲 **`recomputeCore` pierde confirmed sin `endedAt`** (orderBy excluye docs sin campo).
- 🔲 Menores: ex-miembro persiste en standings; `resolveLeagueGroupId` no cae al branch 2;
  huérfanos en leaderboards/ratings al borrar usuario; 2 `catch {}` vacíos en index.js.
- 🔲 **Deploy pendiente**: G1-B (`onMatchNotify`) construido y NO desplegado.

## P2 — UX/UI (móvil primero)

- 🔲 **OG tags en clip.html/lado.html/mi-nivel/liga** — los links por WhatsApp llegan sin
  preview (¡el loop viral del producto!). Mínimo: OG estático con og-card.jpg. Ideal: prerender.
- 🔲 **Navegación**: el dropdown del avatar solo tiene "Mi perfil"+logout; todo cuelga de
  perfil.html como hub. Añadir 5-6 enlaces (mis partidos, mis clips, amigos, grupos, ligas,
  mi nivel). `registrar(-min).html` y `ligas.html` están casi huérfanas de la UI.
- 🔲 **Diálogos nativos** (~30 sitios): `PuntazoDialog` compartido (modal+toast en header.js o
  util.js) y migrar confirm/prompt/alert — peor caso: contraseña de cancha (script.js:75),
  disputa (confirmar.html:554), fusionar invitado (amigos.html), cerrar temporada (liga.html).
- 🔲 **Errores silenciosos**: notifications.js (13 catch mudos), groups.js, ranking-client.js —
  toast de error estándar.
- 🔲 Rápidos: quitar `user-scalable=no` (30 páginas); labels/aria-label en formularios;
  contraste de headers de tabla; `<title>` de guardados duplicado con mis-clips; empty-state
  de mis-partidos dice "entrada" (naming interno).

## P3 — Calidad de código / performance

- 🔲 **`assets/util.js`**: UN `escapeHtml` (hoy 21 copias con 2 nombres), `tsToDate/tsToMillis`
  (14+ copias), `toast()` (5 copias), `renderScore` (5), `renderAvatar` (2). Migración mecánica.
- 🔲 **Partir mi-partido.html (328KB)**: ~3.150 líneas CSS + ~4.590 JS inline → assets propios
  (score/claims/ui). Igual resumen.html (107KB) y torneo5.html (102KB). Nada cacheable hoy.
- 🔲 **Imágenes**: hero-bg.jpg 2.2MB, torneo5-bg.png 1.7MB (PNG para foto), carrusel2 569KB →
  WebP ≤200KB; `loading="lazy"`; revisar assets/court-icons/ (34MB en Pages).
- 🔲 **Scripts**: `defer` en todos los propios; html2canvas on-demand.
- 🔲 **Basura**: borrar `firestore.rules.ranking-wip.bak`, `firestore-debug.log` ×2,
  `functions/_recovered_15.json` (PII de usuario real — NO versionar), `assets/ranking-read.js`
  (0 referencias), `procesados.txt`, `__pycache__/`; añadir a .gitignore: `*.bak`,
  `firestore-debug.log`, `__pycache__/`. `registrar.html` congelada → redirect a registrar-min
  (verificar qué URL llevan los links de WhatsApp ya enviados).
- Sano (no tocar): SDK 9.23.0 compat uniforme en 31 páginas; functions/ bien modularizado;
  escapado XSS disciplinado; estados loading/empty consistentes en páginas-lista.

## Orden propuesto

1. **Ya**: merge P0 + deploy rules (Isaac).
2. **Worker A**: P1 disputed-resolución + notifs match_confirmed/disputed + ensureNotif atómico
   (functions, una pieza coherente).
3. **Worker B**: P2 OG tags + navegación (impacto/esfuerzo imbatible).
4. **Worker C**: P3 util.js + migración diálogos nativos (habilita el resto del P2).
5. **Después**: claim-historial (diseño fino), Parte 2 nivel, privacidad (decisión), partir
   mi-partido.html, imágenes.
