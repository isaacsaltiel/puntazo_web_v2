/* ══════════════════════════════════════════════════════════════
   PUNTAZO — ranking.js  (Fase 3.A · v100)

   Motor de ranking Glicko-2 con extensiones Puntazo:
     - Calibración (3 partidos)
     - Conservative rating para bucket display
     - Margen de victoria (MOV)
     - Decay temporal (RD inflado por inactividad)
     - Anti-farm (weight decay si mismo oponente repetido)
     - Audit trail (ratingsBefore / ratingsAfter)
     - Idempotencia (no doble-procesa matches)
     - Buckets emoji escala 1.0–7.0

   Greenfield, sin código previo. Funciones puras, sin acceso a
   Firestore (la integración Cloud Function se hace aparte).

   Especificación completa en docs/plans/ranking-social-v100-design.md
   sección 4.

   API expuesta en window.PuntazoRanking:
     - applyMatchToRatings(match, currentRatings, opts) → { newRatings, audit }
     - bucketForRating(conservativeRating) → { emoji, name, nivel }
     - decayRDForInactivity(rating, daysSince) → newRD
     - INITIAL_RATING, INITIAL_RD, INITIAL_VOLATILITY, TAU
     - ALGORITHM_VERSION (string)
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  // Export dual browser + Node (la MISMA fuente la usa la web y la Cloud Function).
  var root = (typeof window !== "undefined")
    ? window
    : (typeof globalThis !== "undefined" ? globalThis : this);
  if (root.PuntazoRanking) {
    if (typeof module !== "undefined" && module.exports) module.exports = root.PuntazoRanking;
    return;
  }

  const ALGORITHM_VERSION = "glicko2-v2.0";  // v2: resultado suave por games + bono de competitividad (2026-06-07)

  // ── Constantes Glicko-2 ──────────────────────────────────────
  const INITIAL_RATING = 1500;
  const INITIAL_RD = 350;
  const INITIAL_VOLATILITY = 0.06;
  const TAU = 0.5;                // system constant (Glickman recomienda 0.3-1.2)
  const CONVERGENCE_TOLERANCE = 1e-6;
  const SCALE = 173.7178;         // Glicko → Glicko-2 conversion factor

  // Calibración
  const MIN_MATCHES_FOR_RANKED = 3;

  // Decay temporal
  const DECAY_THRESHOLD_DAYS = 30;
  const DECAY_RD_PER_WEEK = 5;
  const MAX_RD = 350;

  // Anti-farm (ventana 3 días: el gain decae al repetir vs el mismo rival)
  const ANTIFARM_WINDOW_HOURS = 72;
  const ANTIFARM_BASE = 0.5;      // peso 1, 0.67, 0.5, 0.4, 0.33, ...

  // Modelo de margen v2 (aprobado por Isaac 2026-06-07): "resultado suave" por
  // games + bono de competitividad (premia jugar parejo, pesa más para el underdog).
  const BONUS_MAX = 16;           // puntos de rating máx del bono (~0.064 de nivel)
  const COMP_FLOOR = 0.6;         // closeness mínimo para que el bono cuente; debajo = derrota no tan peleada, sin bono
  const LOSS_WEIGHT = 0.7;        // una DERROTA pesa hacia 0 (perder cuesta; el mérito solo lo da el bono en partidazos)
  const WINNER_FLOOR = 1;         // el ganador del PARTIDO nunca baja (mín +1 pt de rating)
  // Mezcla equipo/individual: manda el PROMEDIO del equipo, pero se considera el
  // rating INDIVIDUAL. Esto hace que la pareja importe, que el más fuerte se mueva
  // algo menos que el débil, y que compañeros inseparables converjan lento (su
  // parte individual los jala al nivel que sus resultados justifican).
  const INDIVIDUAL_WEIGHT = 0.25; // 0 = delta 100% compartido ; 1 = 100% individual (lo de hoy, roto)

  // MOV legacy (función exportada por compat; el motor v2 ya NO la usa)
  const MOV_LOG_COEFFICIENT = 0.12;
  const MOV_CAP = 1.3;

  // Conservative rating
  const CONSERVATIVE_RD_FACTOR = 0.5;

  // Siembra de rating local (grupo/club) desde el global (D3): RD mínimo inflado.
  const SEED_LOCAL_RD = 200;

  // Bucket display (escala 1.0–7.0)
  const BUCKET_BASE = 800;        // conservative_rating de 800 = nivel 1.0
  const BUCKET_STEP = 250;        // cada 250 puntos = +1.0 nivel
  const BUCKETS = [
    { min: 7.0, emoji: "👑", name: "Top" },
    { min: 6.0, emoji: "⚡", name: "Élite" },
    { min: 5.0, emoji: "🔥", name: "Competitivo" },
    { min: 4.0, emoji: "🦅", name: "Avanzado" },
    { min: 3.0, emoji: "🐥", name: "Intermedio" },
    { min: 2.0, emoji: "🐣", name: "Aprendiz" },
    { min: 1.0, emoji: "🌱", name: "Principiante" },
  ];

  // ── Helpers Glicko-2 (escala interna) ────────────────────────
  // Convierte Glicko (R, RD) → Glicko-2 (mu, phi)
  function toGlicko2(rating, rd) {
    return {
      mu: (rating - INITIAL_RATING) / SCALE,
      phi: rd / SCALE,
    };
  }
  function fromGlicko2(mu, phi) {
    return {
      rating: SCALE * mu + INITIAL_RATING,
      rd: SCALE * phi,
    };
  }

  // g(phi) función auxiliar
  function g(phi) {
    return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
  }

  // E(mu, mu_j, phi_j) probabilidad esperada de ganar
  function E(mu, muJ, phiJ) {
    return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
  }

  // Iteración de volatilidad (Newton-Raphson)
  function newVolatility(phi, sigma, v, delta) {
    const a = Math.log(sigma * sigma);
    const f = function (x) {
      const ex = Math.exp(x);
      const num = ex * (delta * delta - phi * phi - v - ex);
      const den = 2 * Math.pow(phi * phi + v + ex, 2);
      return num / den - (x - a) / (TAU * TAU);
    };

    // Inicialización
    let A = a;
    let B;
    if (delta * delta > phi * phi + v) {
      B = Math.log(delta * delta - phi * phi - v);
    } else {
      let k = 1;
      while (f(a - k * TAU) < 0) k++;
      B = a - k * TAU;
    }

    let fA = f(A);
    let fB = f(B);
    let safetyCounter = 0;
    while (Math.abs(B - A) > CONVERGENCE_TOLERANCE && safetyCounter < 100) {
      const C = A + (A - B) * fA / (fB - fA);
      const fC = f(C);
      if (fC * fB <= 0) {
        A = B;
        fA = fB;
      } else {
        fA = fA / 2;
      }
      B = C;
      fB = fC;
      safetyCounter++;
    }
    return Math.exp(A / 2);
  }

  // ── Glicko-2 update para 1 jugador vs lista de oponentes ────
  // opponents: [{ rating, rd, score: 0..1 }, ...]
  function updatePlayer(rating, rd, volatility, opponents) {
    if (!opponents.length) {
      // No partidos: solo decay (incremento RD)
      const phi = rd / SCALE;
      const newPhi = Math.sqrt(phi * phi + volatility * volatility);
      return { rating: rating, rd: Math.min(SCALE * newPhi, MAX_RD), volatility: volatility };
    }

    const me = toGlicko2(rating, rd);
    const mu = me.mu;
    const phi = me.phi;

    // v y delta
    let vSum = 0;
    let deltaSum = 0;
    const oppData = opponents.map(function (o) {
      const oG2 = toGlicko2(o.rating, o.rd);
      const gP = g(oG2.phi);
      const eVal = E(mu, oG2.mu, oG2.phi);
      vSum += gP * gP * eVal * (1 - eVal);
      deltaSum += gP * (o.score - eVal);
      return { gP: gP, e: eVal };
    });
    const v = 1 / vSum;
    const delta = v * deltaSum;

    // Nueva volatilidad
    const newSigma = newVolatility(phi, volatility, v, delta);

    // Nueva phi
    const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
    const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);

    // Nuevo mu
    const newMu = mu + newPhi * newPhi * deltaSum;

    const result = fromGlicko2(newMu, newPhi);
    return {
      rating: result.rating,
      rd: Math.min(result.rd, MAX_RD),
      volatility: newSigma,
    };
  }

  // ── MOV: margen de victoria ─────────────────────────────────
  // Calcula multiplier basado en diferencia de games del partido.
  // Devuelve s_adjusted (score adjusted), input s = 0..1
  function applyMOV(s, diffGames, eloDiffFavorWinner) {
    if (s === 0.5) return 0.5;  // empates no ajustados
    if (!Number.isFinite(diffGames) || diffGames < 0) return s;
    // Corrección de autocorrelación (FiveThirtyEight): amortigua el MOV cuando
    // el ganador YA era favorito (eloDiff>0) y lo amplifica si era underdog
    // (eloDiff<0). Sin 3er arg (eloDiff=0) ⇒ comportamiento clásico idéntico.
    const ed = Number.isFinite(eloDiffFavorWinner) ? eloDiffFavorWinner : 0;
    const autocorr = 2.2 / Math.max(0.5, ed * 0.001 + 2.2); // clamp anti div0/negativo
    const mult = 1 + Math.log(1 + diffGames) * MOV_LOG_COEFFICIENT * autocorr;
    const sAdj = s * Math.min(mult, MOV_CAP);
    return Math.max(0, Math.min(1.3, sAdj));
  }

  // ── Anti-farm: weight decay ──────────────────────────────────
  function antifarmWeight(matchesVsSameOpponentRecent) {
    const n = Math.max(0, Number(matchesVsSameOpponentRecent) || 0);
    if (n === 0) return 1.0;
    return 1.0 / (1 + ANTIFARM_BASE * n);
  }

  function applyAntifarm(s, weight) {
    return s * weight + 0.5 * (1 - weight);
  }

  // ── Decay temporal por inactividad ──────────────────────────
  function decayRDForInactivity(currentRD, daysSinceLastMatch) {
    if (!Number.isFinite(daysSinceLastMatch) || daysSinceLastMatch <= DECAY_THRESHOLD_DAYS) {
      return currentRD;
    }
    const weeksExtra = (daysSinceLastMatch - DECAY_THRESHOLD_DAYS) / 7;
    return Math.min(MAX_RD, currentRD + weeksExtra * DECAY_RD_PER_WEEK);
  }

  // ── Conservative rating + bucket ────────────────────────────
  function conservativeRating(rating, rd) {
    return rating - CONSERVATIVE_RD_FACTOR * rd;
  }

  function nivelFromConservativeRating(conservRating) {
    const n = 1.0 + (conservRating - BUCKET_BASE) / BUCKET_STEP;
    return Math.max(1.0, Math.min(7.5, n));
  }

  function bucketForRating(conservRating) {
    const nivel = nivelFromConservativeRating(conservRating);
    for (let i = 0; i < BUCKETS.length; i++) {
      if (nivel >= BUCKETS[i].min) {
        return { emoji: BUCKETS[i].emoji, name: BUCKETS[i].name, nivel: nivel };
      }
    }
    return { emoji: "🌱", name: "Principiante", nivel: nivel };
  }

  // ── Siembra local desde global (D3) ─────────────────────────
  // Un rating LOCAL (grupo/club) nace heredando la habilidad estimada del GLOBAL
  // pero con RD inflado: "sé tu nivel en general, no sé aún cómo te va AQUÍ".
  // Mata el smurfing y es creíble desde el primer partido del contexto.
  function seedLocalFromGlobal(globalState) {
    const g = globalState || {};
    const rating = Number.isFinite(g.rating) ? g.rating : INITIAL_RATING;
    const rd = Number.isFinite(g.RD) ? g.RD : INITIAL_RD;
    const vol = Number.isFinite(g.volatility) ? g.volatility : INITIAL_VOLATILITY;
    return {
      rating: rating,
      RD: Math.max(rd, SEED_LOCAL_RD),
      volatility: vol,
      matchCount: 0,
      lastMatchAt: null,
      recentOpponents: {},
      isCalibrating: true,
      seededFromGlobal: true,
    };
  }

  // ── Fiabilidad para UI (estilo DUPR) ────────────────────────
  // Deriva un 0–100 desde el RD: RD 50 → 100% (muy fiable), RD 350 → 0% (nuevo).
  function reliability(rd) {
    const v = 100 * (1 - (Number(rd) - 50) / 300);
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  // ── applyMatchToRatings: la función central ─────────────────
  // match: {
  //   id, modo, jugadores: [{uid, equipo, nombre}],
  //   marcador: { sets: [{team1, team2}, ...], ganador: "team1"|"team2"|null },
  //   endedAt: <Date>,
  // }
  // currentRatings: { uid → { rating, RD, volatility, matchCount, lastMatchAt, recentOpponents } }
  // opts: { skipMOV, skipAntifarm } (para tests)
  //
  // Devuelve: { newRatings: {uid → ...}, audit: {...} }
  function applyMatchToRatings(match, currentRatings, opts) {
    opts = opts || {};
    const audit = {
      algorithmVersion: ALGORITHM_VERSION,
      processedAt: new Date().toISOString(),
      matchId: match && match.id,
      before: {},
      after: {},
      movMultiplier: 1.0,
      antifarmWeightsByPair: {},
      skipped: false,
      reason: null,
    };

    if (!match || !Array.isArray(match.jugadores)) {
      audit.skipped = true;
      audit.reason = "match invalido";
      return { newRatings: {}, audit };
    }
    if (!match.marcador || !match.marcador.ganador ||
        (match.marcador.ganador !== "team1" && match.marcador.ganador !== "team2")) {
      audit.skipped = true;
      audit.reason = "sin ganador (empate o sin marcador)";
      return { newRatings: {}, audit };
    }

    // Separar jugadores por equipo (solo los que tienen uid)
    const team1 = match.jugadores.filter(function (j) { return j && j.uid && j.equipo === "team1"; });
    const team2 = match.jugadores.filter(function (j) { return j && j.uid && j.equipo === "team2"; });
    if (team1.length === 0 || team2.length === 0) {
      audit.skipped = true;
      audit.reason = "uno de los equipos sin uids registrados";
      return { newRatings: {}, audit };
    }

    // Resultado del partido
    const winner = match.marcador.ganador;

    // Games por equipo → decisividad d ∈ [0,1] FIRMADA por el ganador del partido
    // (0 = partidazo / ganó con menos games ; 1 = paliza total).
    let t1g = 0, t2g = 0;
    if (Array.isArray(match.marcador.sets)) {
      match.marcador.sets.forEach(function (s) {
        t1g += Number(s.team1) || 0;
        t2g += Number(s.team2) || 0;
      });
    }
    const gamesWinner = winner === "team1" ? t1g : t2g;
    const gamesLoser = winner === "team1" ? t2g : t1g;
    const totalGames = Math.max(1, gamesWinner + gamesLoser);
    const d = Math.max(0, Math.min(1, (gamesWinner - gamesLoser) / totalGames));
    const shareLoser = gamesLoser / totalGames;   // fracción de games del perdedor (0..~0.5)
    const softLose = LOSS_WEIGHT * shareLoser;    // perdedor: una DERROTA pesa hacia 0 (perder cuesta)
    const softWin = 1 - softLose;                 // ganador: complementario → el core CONSERVA rating (no infla ni deflacta)
    const closeness = 1 - d;                      // 1 = partidazo, 0 = paliza
    audit.decisiveness = d;
    audit.softWin = softWin;

    // Helper: obtener / inicializar rating de un uid
    function getRating(uid) {
      const r = currentRatings[uid];
      if (!r) {
        return {
          rating: INITIAL_RATING,
          RD: INITIAL_RD,
          volatility: INITIAL_VOLATILITY,
          matchCount: 0,
          lastMatchAt: null,
          recentOpponents: {},
        };
      }
      return Object.assign({}, r, {
        recentOpponents: r.recentOpponents || {},
      });
    }

    // Team rating agregado (promedio del equipo)
    function teamRating(team) {
      const sum = team.reduce(function (acc, j) {
        const r = getRating(j.uid);
        return { rating: acc.rating + r.rating, rdSq: acc.rdSq + r.RD * r.RD };
      }, { rating: 0, rdSq: 0 });
      return {
        rating: sum.rating / team.length,
        rd: Math.sqrt(sum.rdSq / team.length),
      };
    }

    const t1Agg = teamRating(team1);
    const t2Agg = teamRating(team2);

    // Para cada jugador: update Glicko vs el agregado rival con su "score suave",
    // + bono de competitividad, + freno anti-farm, + piso para el ganador.
    const newRatings = {};

    // Procesa un equipo. El esperado, el "score suave" y el bono se calculan a
    // nivel EQUIPO (promedio vs promedio) → la pareja importa. El cambio de cada
    // jugador MEZCLA el delta del equipo (manda, 1-INDIVIDUAL_WEIGHT) con su delta
    // INDIVIDUAL (su rating propio vs el promedio rival), para que lo individual se
    // considere y los compañeros inseparables converjan lento.
    function processTeam(myTeam, oppTeam, myAgg, oppAgg, won) {
      const softScore = won ? softWin : softLose;

      // Núcleo a nivel equipo (promedio vs promedio)
      const myG2 = toGlicko2(myAgg.rating, myAgg.rd);
      const oppG2 = toGlicko2(oppAgg.rating, oppAgg.rd);
      const expectedTeam = E(myG2.mu, oppG2.mu, oppG2.phi);
      const teamUpd = updatePlayer(myAgg.rating, myAgg.rd, INITIAL_VOLATILITY,
        [{ rating: oppAgg.rating, rd: oppAgg.rd, score: softScore }]);
      const teamCoreDelta = teamUpd.rating - myAgg.rating;

      // Bono de competitividad (nivel equipo): premia jugar parejo, pesa más al
      // equipo underdog. Da mérito por hacerle partido al mejor. SOLO cuenta para
      // partidos GENUINAMENTE peleados: por debajo de COMP_FLOOR de closeness (≈
      // perder por más de ~2 games/set) el bono es ~0 — así perder 3-6 4-6 repetido
      // NO te sube. Sube rápido (al cuadrado) hacia los partidazos reales.
      const comp = Math.max(0, Math.min(1, (closeness - COMP_FLOOR) / (1 - COMP_FLOOR)));
      // ZERO-SUM para evitar INFLACIÓN global (un bono que solo suma infla el sistema
      // ~700 pts/temporada, comprobado en Monte Carlo). El bono es un TRANSFER del
      // favorito al underdog: (1 - 2·expected) → underdog >0, favorito <0, parejo =0.
      // Suma 0 sobre los 4 jugadores → la media del sistema NO se infla. El mérito de
      // hacerle partido al mejor se conserva (y se afila).
      const bonus = BONUS_MAX * comp * comp * (1 - 2 * expectedTeam);

      // Anti-farm a nivel EQUIPO (mismo peso para los dos → no rompe el delta
      // compartido). Toma el vínculo más "farmeado" de la pareja vs el rival.
      let antifarmW = 1.0;
      if (!opts.skipAntifarm) {
        const cutoff = (new Date(match.endedAt || Date.now()).getTime()) - (ANTIFARM_WINDOW_HOURS * 60 * 60 * 1000);
        let maxCount = 0;
        myTeam.forEach(function (player) {
          const c = currentRatings[player.uid];
          let count = 0;
          oppTeam.forEach(function (opp) {
            const recents = (c && c.recentOpponents && c.recentOpponents[opp.uid]) || [];
            count += recents.filter(function (t) {
              return (typeof t === "number" ? t : new Date(t).getTime()) >= cutoff;
            }).length;
          });
          if (count > maxCount) maxCount = count;
        });
        antifarmW = antifarmWeight(maxCount);
      }

      myTeam.forEach(function (player) {
        const cur = getRating(player.uid);
        audit.before[player.uid] = { rating: cur.rating, RD: cur.RD, volatility: cur.volatility };
        if (!opts.skipAntifarm) audit.antifarmWeightsByPair[player.uid] = antifarmW;

        // Decay del RD antes de evolucionar la incertidumbre
        let rdEffective = cur.RD;
        if (cur.lastMatchAt) {
          const last = (cur.lastMatchAt instanceof Date) ? cur.lastMatchAt : new Date(cur.lastMatchAt);
          const days = (new Date(match.endedAt || Date.now()) - last) / (1000 * 60 * 60 * 24);
          rdEffective = decayRDForInactivity(cur.RD, days);
        }

        // Paso Glicko INDIVIDUAL (su rating vs el promedio rival): aporta el delta
        // individual + la evolución de su incertidumbre (RD/volatilidad).
        const updSelf = updatePlayer(cur.rating, rdEffective, cur.volatility,
          [{ rating: oppAgg.rating, rd: oppAgg.rd, score: softScore }]);
        const individualCoreDelta = updSelf.rating - cur.rating;
        const finalRD = updSelf.rd;
        const finalVol = updSelf.volatility;

        // MEZCLA: manda el equipo, se considera lo individual.
        const blendedCore = (1 - INDIVIDUAL_WEIGHT) * teamCoreDelta + INDIVIDUAL_WEIGHT * individualCoreDelta;

        // Rating final + piso (el ganador del partido nunca baja).
        let finalRating = cur.rating + antifarmW * (blendedCore + bonus);
        if (won && finalRating < cur.rating) finalRating = cur.rating + WINNER_FLOOR;

        const newRecentOpponents = Object.assign({}, cur.recentOpponents || {});
        oppTeam.forEach(function (opp) {
          const arr = (newRecentOpponents[opp.uid] || []).slice();
          arr.push((match.endedAt instanceof Date ? match.endedAt : new Date(match.endedAt || Date.now())).getTime());
          newRecentOpponents[opp.uid] = arr.slice(-10);
        });

        const cR = conservativeRating(finalRating, finalRD);
        const buck = bucketForRating(cR);

        newRatings[player.uid] = {
          rating: finalRating,
          RD: finalRD,
          volatility: finalVol,
          matchCount: (cur.matchCount || 0) + 1,
          lastMatchAt: match.endedAt || new Date(),
          recentOpponents: newRecentOpponents,
          conservativeRating: cR,
          nivel: buck.nivel,
          bucket: buck.emoji + " " + buck.name,
          isCalibrating: ((cur.matchCount || 0) + 1) < MIN_MATCHES_FOR_RANKED,
        };

        audit.after[player.uid] = {
          rating: finalRating, RD: finalRD, volatility: finalVol,
        };
      });
    }

    processTeam(team1, team2, t1Agg, t2Agg, winner === "team1");
    processTeam(team2, team1, t2Agg, t1Agg, winner === "team2");

    return { newRatings: newRatings, audit: audit };
  }

  // ── API pública ──────────────────────────────────────────────
  var api = {
    ALGORITHM_VERSION: ALGORITHM_VERSION,
    INITIAL_RATING: INITIAL_RATING,
    INITIAL_RD: INITIAL_RD,
    INITIAL_VOLATILITY: INITIAL_VOLATILITY,
    TAU: TAU,
    MIN_MATCHES_FOR_RANKED: MIN_MATCHES_FOR_RANKED,
    BUCKETS: BUCKETS,

    applyMatchToRatings: applyMatchToRatings,
    bucketForRating: bucketForRating,
    nivelFromConservativeRating: nivelFromConservativeRating,
    conservativeRating: conservativeRating,
    seedLocalFromGlobal: seedLocalFromGlobal,
    reliability: reliability,
    SEED_LOCAL_RD: SEED_LOCAL_RD,
    decayRDForInactivity: decayRDForInactivity,
    applyMOV: applyMOV,
    antifarmWeight: antifarmWeight,
    applyAntifarm: applyAntifarm,

    // Privados expuestos para tests
    _updatePlayer: updatePlayer,
    _g: g,
    _E: E,
    _toGlicko2: toGlicko2,
    _fromGlicko2: fromGlicko2,
  };

  root.PuntazoRanking = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
