# Modelo de Ranking Puntazo — v2 (aprobado 2026-06-07)

> Fuente de verdad de **cómo se calcula el nivel de un jugador**. Aprobado por Isaac
> el 7-jun-2026. Implementado en `assets/ranking.js` (`ALGORITHM_VERSION = "glicko2-v2.0"`).
> Pruebas que lo blindan: `tests/ranking.node.test.js`. Simulaciones didácticas:
> `tests/sim-margen2.js`, `tests/demo.js`.

## 1. En una frase

El nivel es un número **1.0–7.0** (estilo Playtomic). Cada partido lo mueve según
**quién ganó**, **qué tan parejo estuvo (por games)** y **el ranking de cada quien** —
premiando jugar bien contra alguien mejor y frenando el farmeo.

## 2. Las reglas de producto (lo que el modelo DEBE cumplir)

1. El que **gana el partido siempre sube** (aunque sea poquito). *(piso)*
2. Un **partidazo protege al perdedor** (casi no baja, "cushion") y **da mérito al
   underdog** (subir por competir con alguien mejor). El bono es **zero-sum** (traspaso
   favorito→underdog) para no inflar el sistema — ver `simulaciones-ranking-2026-06-07.md`.
3. **Mérito según ranking:** perder un partidazo contra alguien **mucho mejor** te
   **sube**; perder contra alguien **mucho peor** (aunque cerrado) te **baja**.
4. Ganarle a alguien **mucho mejor** te sube fuerte; a alguien mucho peor, casi nada.
5. **Anti-farm:** la 1ª vez cuenta completo, pero **repetir** con el mismo rival en
   **3 días** suma cada vez menos.
6. **Calibración:** los primeros **3 partidos** el nivel se marca como "calibrando".
7. **La pareja importa (dobles):** el cambio se calcula con el **promedio del equipo
   vs el promedio rival**; los compañeros se mueven **casi igual** (manda el equipo),
   pero se considera algo de su rating **individual** (el más fuerte se mueve un pelín
   menos que el débil).
8. **Convergencia:** dos que **siempre** juegan juntos se **acercan de nivel poco a
   poco** (su parte individual los jala a lo que sus resultados justifican); jugar con
   otros los vuelve a separar por habilidad real.

## 3. La matemática

Base: **Glicko-2** (rating interno `R`, incertidumbre `RD`, volatilidad `σ`). El número
visible 1.0–7.0 sale del *conservative rating* `R − 0.5·RD` (penaliza incertidumbre).

Por cada partido, para cada jugador `i`:

```
# 1) Decisividad por games, firmada por el GANADOR del partido
d        = clamp( (games_ganador − games_perdedor) / games_totales , 0, 1 )   # 0=partidazo, 1=paliza
softLose = LOSS_WEIGHT · (games_perdedor/total)   # perdedor: una DERROTA pesa hacia 0 (perder cuesta)
softWin  = 1 − softLose                           # ganador: complementario ⇒ el core CONSERVA rating (no infla/deflacta)
closeness= 1 − d                                  # 1 = partidazo, 0 = paliza

# 2) Núcleo = MEZCLA equipo + individual (manda el EQUIPO, se considera lo individual)
expected_eq  = E( promedio_mi_equipo , promedio_rival )              # prob. de ganar del EQUIPO
teamDelta    = Glicko2( promedio_mi_equipo , score=softWin|softLose ) − promedio_mi_equipo
indivDelta_i = Glicko2( rating_i           , score=softWin|softLose ) − rating_i
coreDelta_i  = (1−α)·teamDelta + α·indivDelta_i             # α = INDIVIDUAL_WEIGHT = 0.25
#   → ambos compañeros casi igual (manda teamDelta); el tilt individual los converge lento

# 3) Bono de competitividad — SOLO para partidazos reales (no para cualquier derrota digna)
comp    = clamp( (closeness − COMP_FLOOR) / (1 − COMP_FLOOR) , 0, 1 )   # COMP_FLOOR = 0.6
bonus_i = BONUS_MAX · comp² · (1 − 2·expected_eq)         # ZERO-SUM: underdog>0, favorito<0, parejo=0
#   → suma 0 sobre los 4 jugadores ⇒ no infla el sistema (ver simulaciones-ranking)

# 4) Freno anti-farm (escala el cambio según repeticiones vs ese rival en 3 días)
w = 1 / (1 + 0.5·n)                                         # n = partidos vs ese rival en 72h

# 5) Rating final + piso para el ganador
rating_i' = rating_i + w · (coreDelta_i + bonus_i)
si i ganó el PARTIDO y rating_i' < rating_i:  rating_i' = rating_i + 1
```

**Por qué funciona cada regla:**
- *Partidazo suma a los dos*: con `d≈0`, `softWin≈softLose≈0.5` → el núcleo casi no
  mueve a nadie, y el **bono** (que es positivo para ambos) los empuja arriba.
- *Mérito del underdog*: el bono pesa `(1 − expected)`; el de menor ranking tiene
  `expected` bajo → bono grande. Y su núcleo, al perder un partidazo (score 0.5 vs su
  `expected` bajo), sale **positivo** → sube.
- *Sin mérito para el favorito que pierde*: su `expected` es alto → núcleo muy negativo
  y bono chico → baja, aunque el partido haya sido cerrado.
- *Anti-farm*: `w` cae 1 → 0.67 → 0.5 → 0.4… con cada repetición en la ventana.

## 4. Parámetros (perillas tunables)

| Parámetro | Valor | Qué controla |
|---|---|---|
| `BONUS_MAX` | 16 pts (~0.064 nivel) | Tamaño máximo del bono de competitividad |
| ventana anti-farm | 72 h (3 días) | Cuánto dura la "memoria" para detectar farmeo |
| curva anti-farm | `1/(1+0.5n)` | Qué tan rápido decae al repetir |
| `WINNER_FLOOR` | +1 pt rating | El ganador del partido nunca baja |
| `INDIVIDUAL_WEIGHT` (α) | 0.25 | Cuánto pesa lo individual vs el equipo (0 = todo equipo, 1 = todo individual) |
| `LOSS_WEIGHT` | 0.7 | Cuánto pesa una derrota hacia abajo (perder cuesta; menor = más castigo) |
| `COMP_FLOOR` | 0.6 | Closeness mínimo para que el bono de partidazo cuente (filtra derrotas no tan peleadas) |
| calibración | 3 partidos | Cuándo el nivel deja de ser "provisional" |
| escala buckets | base 800, paso 250 | Mapeo rating interno → nivel 1.0–7.0 |

## 5. Global vs Local

El **mismo** modelo corre por separado para cada contexto: **global** (todos tus
partidos del deporte), **club** y **grupo**. El local arranca sembrado de tu global con
incertidumbre alta (`RD≥200`) — así no hay smurfing y es creíble desde el 1er partido.

## 6. Cómo validarlo

```
node tests/sim-margen2.js   # tablas: partidazo / mérito por rival / anti-farm
node tests/demo.js          # narración de unos partidos
node --test tests/ranking.node.test.js   # 12/12 pruebas (incluye las 4 reglas v2)
```

## 7. Notas de implementación
- El recálculo masivo (`recomputeAllRatings`, Cloud Function admin) se usa si se cambia
  `ALGORITHM_VERSION` o un parámetro: reprocesa el histórico con el modelo nuevo.
- `applyMOV` queda exportada por compatibilidad pero el motor v2 ya no la usa.
