/* ══════════════════════════════════════════════════════════════
   PUNTAZO — ranking-client.js  (Fase 3.B alt · v100)

   Orquestador CLIENT-SIDE del motor Glicko-2 (assets/ranking.js).

   Por qué client-side: hasta que tengamos Cloud Functions
   desplegadas, el ranking se calcula on-the-fly desde los matches
   del user. NO se cachea en ratings/{uid} (eso requiere SA writes
   que rules no permiten desde cliente).

   Flujo:
     1. Query collectionGroup('claims') where uid == user.uid
     2. Para cada claim, fetch matches/{matchId}
     3. Filtrar a status="ended" + marcador.ganador válido
     4. Ordenar oldest → newest
     5. Procesar cada match con applyMatchToRatings cumulativo,
        manteniendo un mapa local de ratings por uid (oponentes
        empiezan en 1500 default Glicko, se actualizan cuando los
        vemos en matches subsecuentes)
     6. Devolver el rating final del user + audit + sparkline

   Limitaciones honestas:
   - Ratings de OPONENTES no son los "oficiales" — son una
     aproximación basada en cuántas veces los hemos visto en
     nuestros propios matches. Cuando llegue Cloud Function, los
     ratings serán los globales reales.
   - Cap de 100 matches recientes (no carga todo el histórico).

   API expuesta en window.PuntazoRankingClient:
     - computeMyRating(uid) → Promise<{ rating, audit, history }>
     - countMatchStats(uid) → Promise<{ matches, wins, losses }>
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.PuntazoRankingClient) return;
  if (!window.PuntazoRanking) {
    console.warn("[ranking-client] PuntazoRanking no cargado");
    return;
  }
  const PR = window.PuntazoRanking;

  function db() {
    return window.PuntazoFirebase && window.PuntazoFirebase.db()
      ? window.PuntazoFirebase.db()
      : null;
  }

  function tsToDate(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return ts;
    if (typeof ts.toDate === "function") { try { return ts.toDate(); } catch (e) { return null; } }
    if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
    if (typeof ts === "number") return new Date(ts);
    return null;
  }

  // Trae los matches asociados al user via collectionGroup claims.
  // Cap por defecto 100 matches más recientes.
  async function fetchUserMatches(uid, opts) {
    opts = opts || {};
    const limit = opts.limit || 100;
    const D = db();
    if (!D) return [];

    let claimsSnap;
    try {
      claimsSnap = await D.collectionGroup("claims")
        .where("uid", "==", uid)
        .orderBy("claimedAt", "desc")
        .limit(limit)
        .get();
    } catch (e) {
      console.warn("[ranking-client] claims query fallo", e);
      return [];
    }

    const matchIds = [];
    claimsSnap.forEach(function (d) {
      const parent = d.ref.parent && d.ref.parent.parent;
      if (parent) matchIds.push(parent.id);
    });
    if (!matchIds.length) return [];

    // Fetch en paralelo (cap por batches de 30 para no saturar)
    const batches = [];
    for (let i = 0; i < matchIds.length; i += 30) {
      batches.push(matchIds.slice(i, i + 30));
    }
    const matches = [];
    for (const batch of batches) {
      const fetched = await Promise.all(batch.map(function (id) {
        return D.collection("matches").doc(id).get()
          .then(function (snap) {
            if (!snap.exists) return null;
            return Object.assign({ id: snap.id }, snap.data());
          })
          .catch(function () { return null; });
      }));
      fetched.forEach(function (m) { if (m) matches.push(m); });
    }
    return matches;
  }

  // F99 P3 (item 5): un match cuenta para ranking solo si:
  //   - status === "ended"
  //   - tiene marcador con ganador definido (no empate, no null)
  //   - HAY AL MENOS 1 jugador con uid REAL POR EQUIPO (no inventado)
  //     Esto cierra "alguien me ganó 6-0 6-0 vs Cristiano Ronaldo" — Cristiano
  //     no tiene uid → match no cuenta.
  function filterRankable(matches) {
    return matches.filter(function (m) {
      if (!m || m.status !== "ended") return false;
      const ma = m.marcador;
      if (!ma) return false;
      const w = ma.ganador;
      if (w !== "team1" && w !== "team2") return false;
      const j = Array.isArray(m.jugadores) ? m.jugadores : [];
      const t1 = j.filter(function (x) { return x && x.uid && x.equipo === "team1"; });
      const t2 = j.filter(function (x) { return x && x.uid && x.equipo === "team2"; });
      return t1.length > 0 && t2.length > 0;
    });
  }

  // F99 P3: clasifica TODOS los matches en buckets para UI honesta.
  // Devuelve { played, rankable, pendingValidation } por slot.
  function classifyMatches(allMatches, focusUid) {
    const played = [];          // todos los ended donde estoy
    const rankable = [];        // ended + rival vinculado + ganador definido
    const pendingValidation = []; // ended pero sin rival vinculado → "te falta invitar"

    allMatches.forEach(function (m) {
      if (!m || m.status !== "ended") return;
      const jugadores = Array.isArray(m.jugadores) ? m.jugadores : [];
      const myJ = jugadores.find(function (j) { return j && (j.uid === focusUid || j.claimedByUid === focusUid); });
      if (!myJ) return; // no estoy en ese match
      played.push(m);

      const ma = m.marcador;
      const w = ma && ma.ganador;
      const hasWinner = (w === "team1" || w === "team2");
      const t1Uids = jugadores.filter(function (x) { return x && x.uid && x.equipo === "team1"; }).length;
      const t2Uids = jugadores.filter(function (x) { return x && x.uid && x.equipo === "team2"; }).length;
      const bothTeamsHaveUid = t1Uids > 0 && t2Uids > 0;

      if (hasWinner && bothTeamsHaveUid) {
        rankable.push(m);
      } else {
        pendingValidation.push(m);
      }
    });
    return { played: played, rankable: rankable, pendingValidation: pendingValidation };
  }

  // Procesa lista de matches en orden cronológico ASC y devuelve
  // mapa final de ratings + history del user objetivo.
  function processMatchesCumulative(matches, focusUid) {
    // Ordenar por endedAt ASC (oldest first)
    const sorted = matches.slice().sort(function (a, b) {
      const da = tsToDate(a.endedAt) || tsToDate(a.startedAt) || new Date(0);
      const dbb = tsToDate(b.endedAt) || tsToDate(b.startedAt) || new Date(0);
      return da - dbb;
    });

    const ratings = {}; // uid → {rating, RD, volatility, matchCount, lastMatchAt, recentOpponents}
    const history = []; // [{matchId, date, ratingBefore, ratingAfter, delta, opponents, ganaste}]

    for (const m of sorted) {
      // Asegurar endedAt como Date
      const endedDate = tsToDate(m.endedAt) || tsToDate(m.startedAt) || new Date();
      const matchForEngine = Object.assign({}, m, { endedAt: endedDate });

      const before = ratings[focusUid]
        ? { rating: ratings[focusUid].rating, RD: ratings[focusUid].RD }
        : { rating: PR.INITIAL_RATING, RD: PR.INITIAL_RD };

      const result = PR.applyMatchToRatings(matchForEngine, ratings);
      if (result.audit.skipped) continue;

      // Merge ratings
      Object.keys(result.newRatings).forEach(function (uid) {
        ratings[uid] = result.newRatings[uid];
      });

      // History entry para focusUid
      if (result.newRatings[focusUid]) {
        const after = result.newRatings[focusUid];
        const myTeam = (m.jugadores || []).filter(function (j) { return j && j.uid === focusUid; })[0];
        const myTeamKey = myTeam && myTeam.equipo;
        const ganaste = (m.marcador.ganador === myTeamKey);
        const opponentTeam = (m.jugadores || []).filter(function (j) {
          return j && j.uid && j.equipo && j.equipo !== myTeamKey;
        });
        history.push({
          matchId: m.id,
          date: endedDate,
          ratingBefore: before.rating,
          ratingAfter: after.rating,
          delta: after.rating - before.rating,
          opponents: opponentTeam.map(function (j) { return j.nombre || "Sin nombre"; }),
          ganaste: ganaste,
          marcador: m.marcador,
          loc: m.loc,
          can: m.can,
        });
      }
    }

    return { ratings: ratings, history: history };
  }

  async function computeMyRating(uid, opts) {
    if (!uid) throw new Error("uid requerido");
    const allMatches = await fetchUserMatches(uid, opts);
    const buckets = classifyMatches(allMatches, uid);
    const rankable = buckets.rankable;
    if (!rankable.length) {
      return {
        rating: PR.INITIAL_RATING,
        RD: PR.INITIAL_RD,
        volatility: PR.INITIAL_VOLATILITY,
        matchCount: 0,
        isCalibrating: true,
        bucket: PR.bucketForRating(PR.conservativeRating(PR.INITIAL_RATING, PR.INITIAL_RD)),
        history: [],
        totalMatchesFetched: allMatches.length,
        totalMatchesPlayed: buckets.played.length,
        totalMatchesRankable: 0,
        pendingValidation: buckets.pendingValidation,
      };
    }
    const result = processMatchesCumulative(rankable, uid);
    const mine = result.ratings[uid];
    if (!mine) {
      // Edge: el user aparecía en claims pero no en matches.jugadores[].uid
      return {
        rating: PR.INITIAL_RATING,
        RD: PR.INITIAL_RD,
        volatility: PR.INITIAL_VOLATILITY,
        matchCount: 0,
        isCalibrating: true,
        bucket: PR.bucketForRating(PR.conservativeRating(PR.INITIAL_RATING, PR.INITIAL_RD)),
        history: [],
        totalMatchesFetched: allMatches.length,
        totalMatchesRankable: rankable.length,
        warning: "Aparece en claims pero ningún match.jugadores[].uid coincide. Puede que tu claim no esté siendo aplicado al marcador. Confirma con el creador del partido.",
      };
    }
    // Stats agregados
    let wins = 0, losses = 0;
    result.history.forEach(function (h) {
      if (h.ganaste) wins++; else losses++;
    });
    return {
      rating: mine.rating,
      RD: mine.RD,
      volatility: mine.volatility,
      matchCount: mine.matchCount,
      isCalibrating: mine.isCalibrating,
      bucket: PR.bucketForRating(mine.conservativeRating),
      conservativeRating: mine.conservativeRating,
      nivel: mine.nivel,
      history: result.history,
      wins: wins,
      losses: losses,
      totalMatchesFetched: allMatches.length,
      totalMatchesPlayed: buckets.played.length,
      totalMatchesRankable: rankable.length,
      pendingValidation: buckets.pendingValidation, // matches que NO cuentan pero ya se jugaron
    };
  }

  async function countMatchStats(uid) {
    const allMatches = await fetchUserMatches(uid);
    const rankable = filterRankable(allMatches);
    let wins = 0, losses = 0;
    rankable.forEach(function (m) {
      const myJ = (m.jugadores || []).filter(function (j) { return j && j.uid === uid; })[0];
      if (!myJ) return;
      if (m.marcador.ganador === myJ.equipo) wins++;
      else losses++;
    });
    return {
      total: allMatches.length,
      rankable: rankable.length,
      wins: wins,
      losses: losses,
    };
  }

  window.PuntazoRankingClient = {
    computeMyRating: computeMyRating,
    countMatchStats: countMatchStats,
    classifyMatches: classifyMatches,
    _fetchUserMatches: fetchUserMatches,
    _filterRankable: filterRankable,
    _processMatchesCumulative: processMatchesCumulative,
  };
})();
