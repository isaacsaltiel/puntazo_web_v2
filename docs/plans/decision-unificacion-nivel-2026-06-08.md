# DECISIÓN — Unificación del "nivel": una sola fuente de verdad (server-authoritative)

> 8-jun-2026, noche. Autor: chat maestro (autónomo). Detona: Isaac — *"mi nivel y tu nivel global…
> siento que está duplicado o no termino de entender por qué están los dos."*
> Estado: **DECISIÓN TOMADA**. Implementación en dos partes: (1) unificación de display = HECHA y segura;
> (2) migración del pipeline (alimentar el servidor + recompute) = STAGED, requiere OK de Isaac (toca ranking en prod).

---

## 1. El síntoma
Hay dos superficies que muestran "tu nivel" y **dan números distintos**:
- **`perfil.html` → "Tu nivel global"**: LEE `ratings/{uid}.byContext["global:padel"].nivel` (servidor, autoritativo).
- **`mi-nivel.html` → "Mi nivel"**: **RECALCULA en el navegador** desde los partidos del usuario (`ranking-client.js`).

No es un bug de copy: son **dos cálculos diferentes sobre dos conjuntos de datos diferentes**.

## 2. La causa raíz — dos pipelines de ranking coexistiendo
La plataforma quedó **a medio migrar** de un ranking client-side (viejo) a uno server-authoritative (spec LOCKED).
Hoy conviven DOS caminos de creación de partido que alimentan DOS mundos de ranking:

| Camino de creación | Estado terminal | Quién lo escribe | Qué ranking alimenta |
|---|---|---|---|
| **Legacy / directo** | `status:"ended"` | `assets/matches.js` → `end()` (L1073) | Ranking **CLIENTE** (`ranking-client.js` filtra `status==="ended"`, L127/153) → lo lee `mi-nivel.html` |
| **Confirmación (nuevo)** | `pending_confirmation` → `"confirmed"` | `match-actions.js` (register, L102) → `match-confirmation.js` (confirm, L120) | Ranking **SERVIDOR** (Cloud Function `onMatchConfirmed`, solo procesa `becameConfirmed`) → `ratings/{uid}` → lo lee `perfil.html` |

**Evidencia en prod (8-jun):** los partidos están en `{ended:16, active:2, cancelled:11, confirmed:0}`.
→ **CERO partidos `confirmed`**: el servidor de ranking **nunca fue alimentado** por partidos reales. Los `ratings/{uid}`
que existen vienen de seeds de demo (`DEMO_E4_…`, ya borrados) → el `ratings` de Isaac (`nivel 3.53`) referencia
oponentes `DEMO_E4_owner/partner` que ya no existen. Es decir: **el número del servidor hoy es stale/semilla, y el
del cliente se calcula de 16 partidos "ended" que el servidor ignora.** De ahí la contradicción que ve Isaac.

## 3. Alternativas consideradas (y por qué se descartan)
- **(A) Hacer que `perfil` también use el cálculo cliente.** ❌ Va en contra de la spec LOCKED (server-authoritative),
  duplica la lógica Glicko-2 (anti-inflación, convergencia) en el navegador, y no escala a leaderboards/contextos.
- **(B) Mantener los dos y "explicarlos" como cosas distintas.** ❌ No son distintos: son el mismo concepto (tu nivel
  global de pádel). Mantener dos cálculos es deuda permanente y confunde para siempre. El usuario tiene razón.
- **(C) Extender el trigger del servidor para procesar también `"ended"`.** ⚠️ Posible, pero ensucia el modelo: `"ended"`
  es el terminal legacy "sin confirmar"; tratarlo como confirmado saltaría la máquina de confirmación (anti-farmeo) para
  TODO partido viejo. Sólo aceptable para partidos in-club de hardware confiable, no como regla general.
- **(D) ✅ ELEGIDA — Server-authoritative único.** El servidor (`ratings/{uid}`) es LA fuente de verdad en todas las
  superficies; el recálculo cliente (`ranking-client.js`) se **retira**. Se completa la alimentación del servidor.

**Por qué D:** es la spec LOCKED, el motor está construido y validado (Glicko-2, Monte-Carlo, recompute maxDiff 0),
escala a club/grupo/liga, y elimina la divergencia de raíz. "Un partido confirmado → una verdad → N vistas."

## 4. La decisión
1. **`ratings/{uid}` es la ÚNICA fuente del nivel mostrado.** `perfil`, `mi-nivel`, `jugador`, leaderboards y el badge
   de `confirmar` leen de ahí.
2. **`mi-nivel.html` deja de recalcular**: se vuelve la VISTA DETALLE del mismo nivel global que `perfil` resume
   (badge → detalle). Lee `ratings/{uid}` para el número/bucket/V-D/calibración. Sus secciones ricas (historial,
   "partidos por confirmar") quedan como soporte, claramente subordinadas y SIN producir un número que compita.
3. **`ranking-client.js` (recálculo cliente) se deprecca** una vez (2) esté arriba y el servidor alimentado.
4. **Alimentar el servidor**: los partidos legítimos terminados deben llegar a `"confirmed"` para que el trigger los
   procese. Camino: el flujo in-club/confiable escribe `"confirmed"` directamente (el trigger ya lo contempla:
   *"CREATE sesiones in-club que escriben un match ya confirmed"*); el flujo "jornada sin hardware" pasa por
   confirmación (ya produce `"confirmed"`). El `end()` legacy de `matches.js` debe alinearse a esto.

## 5. Implementación en dos partes

### Parte 1 — Unificación de display (SEGURA, client-only, push a master) — **HECHA esta noche**
- `mi-nivel.html`: el encabezado (nivel, bucket, V-D, estado de calibración) se lee de
  `ratings/{uid}.byContext["global:padel"]` — idéntica fuente y formato que `perfil.html#loadGlobalNivel`.
- Fallback elegante e IDÉNTICO al de `perfil` si el `ratings` no existe ("juega y confirma un partido para tener
  tu nivel"). Resultado: `perfil` y `mi-nivel` **siempre coinciden** (ambos servidor). Se acaba la contradicción.
- Reversible (un commit client-side). No toca functions, ni reglas, ni datos.
- Nota: para usuarios con el servidor aún sin alimentar, ambas superficies mostrarán "calibrando" de forma
  CONSISTENTE — honesto y correcto-direccional. La Parte 2 puebla los niveles reales.

### Parte 2 — Alimentar el servidor + recompute (STAGED, requiere OK de Isaac — toca ranking en prod)
- **Por qué no se ejecuta sola de noche:** es una mutación de datos sobre el ranking de producción (joya de la corona),
  difícil de revertir y con riesgo de contaminar el ranking si se promueven partidos basura (los 16 "ended" incluyen
  test data tipo `a/b/c/d` y restos de demo). Tras el incidente de borrado de esta misma noche, lo correcto de un
  ingeniero senior es **dejarlo probado y listo, y que un humano apruebe el deploy**, no hacer yolo sobre el ranking.
- **Plan listo para aprobar:**
  1. Clasificar los 16 "ended": conservar los legítimos (jugadores reales, marcador válido, ganador), descartar
     test/garbage. Listado para revisión de Isaac.
  2. Promover los legítimos a `"confirmed"` (set status + `endedAt`), borrar `ratings/`+`leaderboards/entries`+
     `processedMatches/` stale, y correr `recomputeCore()` (ya validado en emulador, maxDiff 0) para reconstruir
     `ratings/{uid}` limpio desde cero.
  3. Alinear `matches.js#end()` (o el flujo que lo llama) para que los partidos nuevos terminen en `"confirmed"`
     (in-club confiable) o pasen por confirmación — evita recrear "ended" huérfanos.
  4. Deprecciar `ranking-client.js` y quitar su uso de `mi-nivel` (la Parte 1 ya lo neutralizó como número).
- **Riesgo controlado:** el recompute es idempotente y reproducible; si algo sale mal se vuelve a correr. La
  clasificación de partidos la revisa Isaac antes de promover.

## 6. Resultado esperado
- **Hoy:** `perfil` y `mi-nivel` muestran el MISMO número (servidor). Cero contradicción. (Parte 1)
- **Tras aprobar Parte 2:** ese número refleja el historial real de Isaac (no la semilla de demo), y todo partido
  futuro alimenta una sola verdad server-side. El recálculo cliente desaparece.

## 7. Pendiente para Isaac (1 decisión)
> ¿Apruebas correr la **Parte 2** (limpiar el ranking semilla y reconstruirlo desde los partidos reales)? Te dejo el
> listado de los 16 "ended" clasificados (real vs test) para que confirmes cuáles cuentan. Es el paso que pone tu
> nivel real y único. Mientras tanto, la contradicción visual ya quedó resuelta con la Parte 1.
