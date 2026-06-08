# Simulaciones del modelo de ranking — hallazgos (2026-06-07)

> Estrés del motor `assets/ranking.js` con Monte Carlo a escala de temporada.
> Reproducible: `node tests/montecarlo.js` y `node tests/montecarlo-scenarios.js`.

## TL;DR
El modelo quedó **estable, preciso y a prueba de trucos**. En el camino las simulaciones
**cazaron un bug grave de inflación** (+700 pts/temporada) que se corrigió.

| Propiedad | Resultado | Veredicto |
|---|---|---|
| Inflación (media del rating en 4000 partidos) | 1500 → 1506 (deriva +6) | ✔ estable |
| Precisión (corr rating estimado vs habilidad real) | 0.98 | ✔ excelente |
| Ranking (top-10 real en top-10 estimado) | 10/10 | ✔ perfecto |
| Smurf (crack 5.8 entra en 1500) llega a su nivel | ~8 partidos | ✔ rápido |
| Sandbagging (tirar 8 partidos) | termina MÁS BAJO | ✔ sin exploit |
| Win-trading (60 amañados entre 2) | no se inflan | ✔ anti-farm aguanta |
| Calibración (prob predicha vs real) | aciertan; algo conservador | ✔ seguro |

## El bug que cazó la simulación (y cómo se arregló)

**Síntoma:** la media del rating subía sin parar — +700 puntos (≈ +3 niveles) en una
temporada de 4000 partidos. En un año, todos serían "7.5". Además, al inflarse, la
precisión caía (corr 0.95 → 0.79).

**Causa raíz:** el **bono de competitividad** ("partidazo suma a los dos") era
**no-zero-sum**: inyectaba rating al sistema en cada partido y se acumulaba.

**Arreglo (2 cambios):**
1. **Bono zero-sum:** pasó de `(1 − expected)` (siempre positivo, inyecta) a
   `(1 − 2·expected)` — un **traspaso** del favorito al underdog. Suma 0 sobre los 4
   jugadores. El mérito de hacerle partido al mejor se conserva (y se afila); la media
   ya no se mueve. *Costo:* un partidazo PAREJO ya no sube a los dos; ahora el ganador
   sube y el perdedor casi no baja (cushion). El mérito del underdog sí sube.
2. **Core conservativo:** `softWin = 1 − softLose` (antes `0.5 + 0.5·d`). Garantiza que
   el "score" del partido sume 1 → no infla ni deflacta. (El `LOSS_WEIGHT` solo, sin
   esto, causaba deflación −530.)

Resultado: media estable en 1506, corr 0.98. **Ambos cambios viven en `ranking.js` y
están blindados por las pruebas del gate** (incl. "perder claro NO te sube").

## Las 4 jornadas de estrés (montecarlo-scenarios.js)

- **A) Smurf.** Un 5.8 que entra en 1500 sube a 4.78 (3 partidos), 5.16 (5), 5.52 (10) →
  ~su nivel real en 8. La calibración (RD alto al inicio) hace que los cracks no tarden
  en colocarse. *Bueno para onboarding.*
- **B) Sandbagging.** Quien tira 8 partidos a propósito termina en 4.74 vs 4.96 del
  honesto → **tirar partidos te deja más abajo**, nunca te beneficia.
- **C) Win-trading.** Dos iguales que se amañan 60 palizas alternas no se inflan
  (anti-farm decae el gain al repetir rival).
- **D) Calibración.** Cuando el sistema predice ~50% gana ~50%; predice ~53% → real 61%
  (el modelo es **un poco conservador**, subestima al favorito). Es seguro: prefiere
  pecar de prudente. Mejorable subiendo la separación de la escala si algún día importa.

## Global vs Local a escala (montecarlo-global-local.js)

3 clubes de distinta fuerza (Norte fuerte, Sur flojo) que solo se cruzan 12%:
- **Local: corr 0.95–0.97** dentro de cada club → el "nivel aquí" ordena perfecto a los
  miembros. Muy confiable.
- **Global: corr 0.89** y **comprime** las diferencias entre clubes (brecha real 500 pts
  se ve como ~90). Es el problema clásico de **pools desconectados**: sin cruce, no se
  pueden comparar dos grupos. Mejora con más partidos inter-club.
- **Conclusión de diseño:** esto **valida tener los dos números**. Dentro de un contexto,
  el local es preciso; el global es la mejor comparación cross-contexto y depende de la
  conectividad. Idea de producto: incentivar partidos inter-club (torneos, visitas, un
  "reto a otro club") mejora el global de toda la red.

## Parámetros finales (todos tunables en `ranking.js`)
`BONUS_MAX=16` (ahora zero-sum) · `COMP_FLOOR=0.6` · `LOSS_WEIGHT=0.7` ·
`INDIVIDUAL_WEIGHT=0.25` · `WINNER_FLOOR=1` · anti-farm 72h `1/(1+0.5n)` · calibración 3.

## Pendiente / ideas
- La leve subestimación del favorito (D) podría afinarse, pero no es urgente.
- Re-correr estas simulaciones tras cualquier cambio de parámetros (son el "wind tunnel").
