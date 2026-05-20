# Workers — convención del modelo master/worker

Este proyecto opera con arquitectura **maestro → workers**.

- **Chat maestro** (Claude, una conversación larga): conserva contexto, diseña roadmap, prepara briefs, revisa reportes, decide la siguiente etapa. Nunca ejecuta el trabajo de una etapa.
- **Chats worker** (Claude, conversaciones efímeras): ejecutan UNA etapa cada uno. Reciben un prompt + leen un brief en `docs/workers/etapa-NN-slug.md`. No tienen contexto del proyecto: el brief y los archivos que indica son su única fuente de verdad.

## Convención de briefs

Cada etapa tiene un archivo en este folder con el nombre `etapa-NN-slug.md`. El brief sigue esta estructura:

```
# título de etapa
# objetivo
# contexto
# arquitectura relevante
# archivos importantes
# alcance
# fuera de alcance
# riesgos
# validaciones
# definition of done
# formato del reporte de regreso
```

## Branching

- Cada worker crea su propia branch desde la branch base que indica su brief: `etapa-NN-slug`.
- **Branch base por defecto**: `rediseno-jugador` (durante la fase de rediseño del jugador, etapas que dependen de `assets/matches.js` u otros módulos del rediseño). Para etapas independientes del rediseño (quick wins ops, reparación de páginas viejas) la branch base puede ser `master`. El brief siempre lo dice explícito.
- Worker commitea y pushea su branch. **Nunca** mergea a `master` ni a `rediseno-jugador`.
- El chat maestro mergea tras revisar el reporte y los diffs.
- **Hot-patches discovered en review**: si el maestro encuentra un bug pequeño en el reporte de un worker, NO lo arregla directamente. Genera un brief de hot-patch (corto pero formal) y lo manda a un nuevo worker chat. La conveniencia del maestro no justifica romper el modelo.

## Formato del reporte de regreso (obligatorio)

Cuando el worker termina, debe entregar texto en bloque, listo para copiar/pegar al maestro. Formato exacto:

```
## REPORTE ETAPA N — <slug>

### Resumen ejecutivo
Una a tres oraciones: qué se hizo.

### Archivos modificados
- `path/to/file.ext` (nuevo | modificado | eliminado) — descripción de 1 línea.

### Decisiones técnicas tomadas
- Decisión: X. Justificación: Y. Alternativa descartada: Z.

### Bugs encontrados
Solo si los hubo en código existente al investigar. Tipo, archivo, severidad.

### Riesgos detectados
Si descubriste algo del scope ajeno que el maestro debe saber.

### Qué quedó pendiente
Items dentro del scope que no terminaste, con razón.

### Qué validaciones se hicieron
Cada item del bloque "Validaciones" del brief: status (✅/❌/⏭️) + output observado.

### Resultado
Branch + commit SHA + qué quedó funcionando + qué archivos puede revisar el maestro.

### Recomendación al arquitecto maestro
Qué etapa proponen como siguiente y por qué (o si dejan al maestro decidir).
```

## Reglas inviolables

1. **Scope estricto**: solo lo que dice el brief, nada más.
2. **No tocar archivos fuera del scope** declarado en "Alcance" / "Fuera de alcance".
3. **No merge a master** ni a `rediseno-jugador` desde el worker.
4. **Reportar TODAS las validaciones** del brief, incluyendo las que fallaron o se saltaron (con razón).
5. **No inventar**: si algo del brief no está claro, preguntar al usuario antes de improvisar.
6. **Sin "while you're at it"**: si descubres deuda técnica fuera de alcance, anótala en "Recomendación al arquitecto maestro" — no la arregles.
