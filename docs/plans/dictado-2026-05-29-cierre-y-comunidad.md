# Dictado 2026-05-29 — Cierre completo del partido + comunidad

> Plan vivo. Capturado del dictado de Isaac (21 items) tras probar
> los bloques F90-F95. Lo importante NO se pierde aunque pasen sesiones.

---

## ⚡ Bug crítico ya identificado y resuelto (F96)

**Sin esto NADA del dictado se podía probar.**

`perfil.html`, `mis-partidos.html` y `mi-nivel.html` daban
`permission-denied` al hacer `collectionGroup('claims').where('uid','==',myUid)`.
Causa: las rules que Isaac pegó tenían el bloque de claims SOLO
anidado dentro de `matches/{matchId}/claims/{claimUid}`. Eso cubre
acceso por path explícito pero NO collectionGroup queries.

Fix: agregar bloques `match /{path=**}/claims/{claimUid}` y
`match /{path=**}/members/{memberUid}` al set. El doc
`docs/plans/firestore-rules-v100-fase3.md` ya está actualizado.

**Acción Isaac: re-pegar el bloque completo del MD.**

Una vez fixed:
- "Mis partidos" en perfil debe poblarse.
- "Mi nivel" debe calcular en lugar de quedarse en calculando.
- Auto-discover de jugadores recientes (autocomplete) debe funcionar.
- "Mis grupos" en grupos.html debe listar.

---

## Resumen de items por prioridad (orden del usuario)

### Prioridad 1 — Cierre correcto del partido
- **Item 1**: el partido terminado SÍ se guarda, pero no aparecía en perfil → bug de rules F96 fixed.
- **Item 7**: botón de salida muy visible en resumen recién terminado ("Ver mi perfil", "Finalizar").
- **Item 8**: cuando vuelvo a Mi Perfil, el partido nuevo debe estar.

### Prioridad 2 — Compartir + vincular jugadores
- **Item 2**: en resumen.html acciones reorganizadas — "Subir foto" + "Editar marcador" arriba; "Compartir resumen" y "Compartir partido" SEPARADOS.
- **Item 3**: dos tipos de compartir (foto vs partido).
- **Item 4**: vista del link compartido del partido — preguntar "¿Quién eres?" con jugadores no vinculados; al elegir → vincula uid + acepta marcador.
- **Item 6**: "Sugerir corrección" en lugar de editar unilateral (extiende F95 BLOQUE 5).

### Prioridad 3 — Ranking / Nivel
- **Item 5**: para que un partido cuente para ranking → al menos un jugador rival vinculado + idealmente aceptó. Si no → historial personal, no afecta ranking.
- **Item 9**: "Ver mi nivel" debe explicar el estado real ("Llevas 1 de 3 partidos válidos") en lugar de "calculando".
- **Item 10**: dos estados de jugador — **Provisional** (sin suficientes partidos) y **Rankeado**. UI debe distinguirlos.
- **Item 11**: feedback post-partido — "Subiste +24 puntos" / "Tu ranking no cambió" / "Pendiente de validación".

### Prioridad 4 — Mi Perfil
- **Item 12**: Mis grupos / Mis amigos siguen pidiendo login aunque hay sesión, no se ven con header, no funciona crear grupo, no funciona buscar amigos.
- **Item 13**: research de cómo Strava/UTR/Playtomic/PadelMix manejan comunidad — ya está en `docs/plans/ranking-social-v100-design.md` sección 12. Aplicar las lecciones.
- **Item 14**: detalle de partido desde perfil (`detalle.html`) — agregar acciones que faltan (invitar, sugerir corrección, estado de validación, foto on-demand). Ya hay 50% en F91.

### Prioridad 5 — Puntazos pendientes + heartbeat NUC
- **Item 15**: BreakPoint deja puntazos pendientes horas. Diagnosticar — probable que la NUC no estaba escuchando cuando llegó el doc.
- **Item 16**: heartbeat de cada NUC (cada 30 min) → Firestore. UI muestra "Club offline" si falta heartbeat.
- **Item 17**: reintento robusto — solicitud persistente en `pending_pulses`, NUC procesa al volver online.
- **Item 18**: estados visibles del clip ("Solicitado", "Esperando sistema del club", "Procesando", "Disponible", "Error, se reintentará", "Sistema offline").

### Prioridad 6 — Herramientas de prueba
- **Item 19**: poder borrar partidos, cancelar pendientes, crear/borrar grupos, agregar/borrar amigos (modo dev discreto).

---

## Items 20+21 — meta

- Trabajo por orden estricto (P1 antes que P2, etc).
- Primero corregir cierre + perfil. Después vinculación + ranking.

---

## También bug del marcador horizontal (item adicional)

El P button quedaba abajo izquierda, no centrado. Causa: en F94 escribí
CSS asumiendo un wrapper `.mp-fs-center-stack` que NO existe en el DOM.
Fix F96: asignar `grid-area` explícita a `.mp-fs-score` (area: score)
y `.mp-fs-puntazo-row` (area: puntazo), reorganizar `grid-template-areas`
a 3 filas centro (header / score / puntazo). Pads abarcan filas 2-3.

---

## Plan de ejecución sugerido (cuando vuelvas)

1. **AHORA**: Isaac re-pega rules (F96) → desbloquea casi todo.
2. **Iteración 1** (cierre correcto): mejorar resumen.html con CTAs claras de salida + reorganizar acciones (Item 2 + 7). Verificar que post-rules-fix, P1 esté resuelto sin más código.
3. **Iteración 2** (link de invitación + claim cross): item 4 + 6. Página `unirme.html` o usar `detalle.html?join=1` con UI especial.
4. **Iteración 3** (ranking UX): item 9 + 10 + 11. mi-nivel.html con estado provisional + criterio "match cuenta para ranking" en motor.
5. **Iteración 4** (heartbeat NUC + estados pendientes): items 15-18. Requiere brief para worker NUC.
6. **Iteración 5** (herramientas dev): item 19. Modo discreto en perfil.

Items 5 + 14 quedan distribuidos entre iteraciones 2 y 3.
