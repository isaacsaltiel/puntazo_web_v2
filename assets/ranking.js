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
  if (window.PuntazoRanking) return;

  const ALGORITHM_VERSION = "glicko2-v1.0";

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

  // Anti-farm
  const ANTIFARM_WINDOW_HOURS = 24;
  const ANTIFARM_BASE = 0.5;      // 1, 0.67, 0.5, 0.4, 0.33, ...

  // MOV (margen de victoria)
  const MOV_LOG_COEFFICIENT = 0.12;
  const MOV_CAP = 1.3;

  // Conservative rating
  const CONSERVATIVE_RD_FACTOR = 0.5;

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
  function applyMOV(s, diffGames) {
    if (s === 0.5) return 0.5;  // empates no ajustados
    if (!Number.isFinite(diffGames) || diffGames < 0) return s;
    const mult = 1 + Math.log(1 + diffGames) * MOV_LOG_COEFFICIENT;
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

    // Score base
    const winner = match.marcador.ganador;
    const scoreT1 = winner === "team1" ? 1.0 : 0.0;
    const scoreT2 = winner === "team2" ? 1.0 : 0.0;

    // Diff de games total para MOV
    let diffGames = 0;
    if (Array.isArray(match.marcador.sets)) {
      let t1g = 0, t2g = 0;
      match.marcador.sets.forEach(function (s) {
        t1g += Number(s.team1) || 0;
        t2g += Number(s.team2) || 0;
      });
      diffGames = Math.abs(t1g - t2g);
    }

    // Aplicar MOV
    let scoreT1Adj = scoreT1;
    let scoreT2Adj = scoreT2;
    if (!opts.skipMOV) {
      scoreT1Adj = applyMOV(scoreT1, diffGames);
      scoreT2Adj = applyMOV(scoreT2, diffGames);
      audit.movMultiplier = 1 + Math.log(1 + diffGames) * MOV_LOG_COEFFICIENT;
    }

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

    // Para cada jugador, aplicar update vs el agregado del equipo rival
    // (con MOV + anti-farm + decay aplicado al RD entrante)
    const newRatings = {};

    function processTeam(myTeam, oppTeam, oppAgg, myScoreAdj) {
      myTeam.forEach(function (player) {
        const cur = getRating(player.uid);
        audit.before[player.uid] = {
          rating: cur.rating, RD: cur.RD, volatility: cur.volatility,
        };

        // Decay temporal antes de aplicar este match
        let rdEffective = cur.RD;
        if (cur.lastMatchAt) {
          const last = (cur.lastMatchAt instanceof Date)
            ? cur.lastMatchAt
            : new Date(cur.lastMatchAt);
          const days = (new Date(match.endedAt || Date.now()) - last) / (1000 * 60 * 60 * 24);
          rdEffective = decayRDForInactivity(cur.RD, days);
        }

        // Anti-farm: cuántas veces ha jugado contra estos oponentes en 24h
        let antifarmW = 1.0;
        if (!opts.skipAntifarm) {
          let count = 0;
          oppTeam.forEach(function (opp) {
            const recents = (cur.recentOpponents && cur.recentOpponents[opp.uid]) || [];
            const cutoff = (new Date(match.endedAt || Date.now()).getTime()) - (ANTIFARM_WINDOW_HOURS * 60 * 60 * 1000);
            count += recents.filter(function (t) {
              return (typeof t === "number" ? t : new Date(t).getTime()) >= cutoff;
            }).length;
          });
          antifarmW = antifarmWeight(count);
          audit.antifarmWeightsByPair[player.uid] = antifarmW;
        }
        const finalScore = applyAntifarm(myScoreAdj, antifarmW);

        // Update Glicko-2
        const updated = updatePlayer(
          cur.rating, rdEffective, cur.volatility,
          [{ rating: oppAgg.rating, rd: oppAgg.rd, score: finalScore }]
        );

        const newRecentOpponents = Object.assign({}, cur.recentOpponents || {});
        oppTeam.forEach(function (opp) {
          const arr = (newRecentOpponents[opp.uid] || []).slice();
          arr.push((match.endedAt instanceof Date ? match.endedAt : new Date(match.endedAt || Date.now())).getTime());
          // Mantener solo últimas 10 entries por oponente
          newRecentOpponents[opp.uid] = arr.slice(-10);
        });

        const cR = conservativeRating(updated.rating, updated.rd);
        const buck = bucketForRating(cR);

        newRatings[player.uid] = {
          rating: updated.rating,
          RD: updated.rd,
          volatility: updated.volatility,
          matchCount: (cur.matchCount || 0) + 1,
          lastMatchAt: match.endedAt || new Date(),
          recentOpponents: newRecentOpponents,
          conservativeRating: cR,
          nivel: buck.nivel,
          bucket: buck.emoji + " " + buck.name,
          isCalibrating: ((cur.matchCount || 0) + 1) < MIN_MATCHES_FOR_RANKED,
        };

        audit.after[player.uid] = {
          rating: updated.rating, RD: updated.rd, volatility: updated.volatility,
        };
      });
    }

    processTeam(team1, team2, t2Agg, scoreT1Adj);
    processTeam(team2, team1, t1Agg, scoreT2Adj);

    return { newRatings: newRatings, audit: audit };
  }

  // ── API pública ──────────────────────────────────────────────
  window.PuntazoRanking = {
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
})();
