/* ══════════════════════════════════════════════════════════════
   PUNTAZO — standings.js  (E7 · liga · tabla record-based)

   computeStandings(matches, opts) — helper PURO (sin Firestore/firebase/window),
   export dual browser (window.PuntazoStandings) + Node (module.exports). Testeable
   como el motor de ranking.

   Modelo record-based (decisión LOCKED): victoria = pointsWin (3), derrota =
   pointsLoss (0), sin empates (pádel siempre tiene ganador).

   Entrada:
     matches: [ doc ]  partidos CONFIRMED de la liga (groupId == liga). Cada doc:
       { jugadores:[{uid,equipo,nombre}], marcador:{sets:[{team1,team2}],ganador},
         endedAt|createdAt }  (endedAt: Timestamp | Date | ms | {seconds}).
     opts:
       { mode:"individual"|"pairs", pairs:[{pairId,uids:[a,b],name}],
         pointsWin:3, pointsLoss:0,
         period:"week"|"month"|"year"|"season"|"all",
         now:<ms>, seasonStartMs, seasonEndMs,
         minMatches:<n>,        // unidades con PJ<min van al fondo (rankeable=false)
         sortBy:"points"|"pct"  // criterio primario de orden (default "points")
       }

   Salida:
     { rows:[ { key, name, uids, pj, g, p, pts, pct, setDiff, gameDiff,
                setsFor, setsAgainst, gamesFor, gamesAgainst, rank, rankable } ],
       recent:[ { matchId, endMs, ... } ]  // se computa aparte (computeRecent)
     }
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ── Fecha del partido en ms (robusto a Timestamp/Date/number/{seconds}). ──
  function matchEndMs(m) {
    var t = (m && (m.endedAt != null ? m.endedAt : m.createdAt));
    if (t == null) return null;
    if (typeof t === "number" && isFinite(t)) return t;
    if (typeof t.toMillis === "function") { try { return t.toMillis(); } catch (e) {} }
    if (t instanceof Date) return t.getTime();
    if (typeof t.seconds === "number") return t.seconds * 1000 + (t.nanoseconds ? Math.floor(t.nanoseconds / 1e6) : 0);
    if (typeof t._seconds === "number") return t._seconds * 1000;
    var d = new Date(t).getTime();
    return isFinite(d) ? d : null;
  }

  // ── Rango [startMs, endMs) del período. lun–dom para "week". ──
  function periodRange(period, nowMs, seasonStartMs, seasonEndMs) {
    var now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (period === "all") return { start: -Infinity, end: Infinity };
    if (period === "season") {
      return {
        start: Number.isFinite(seasonStartMs) ? seasonStartMs : -Infinity,
        end: Number.isFinite(seasonEndMs) ? seasonEndMs : Infinity,
      };
    }
    var d = new Date(now);
    if (period === "week") {
      // Lunes 00:00 local de la semana actual.
      var day = d.getDay();              // 0=dom .. 6=sab
      var diff = (day === 0) ? 6 : (day - 1); // días desde el lunes
      var start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff, 0, 0, 0, 0);
      var end = new Date(start.getTime());
      end.setDate(end.getDate() + 7);
      return { start: start.getTime(), end: end.getTime() };
    }
    if (period === "month") {
      var ms = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
      var me = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
      return { start: ms.getTime(), end: me.getTime() };
    }
    // "year"
    var ys = new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
    var ye = new Date(d.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
    return { start: ys.getTime(), end: ye.getTime() };
  }

  function inRange(ms, range) {
    if (ms == null) return false;
    return ms >= range.start && ms < range.end;
  }

  // Ganador válido del match ("team1"|"team2"), o null.
  function winnerOf(m) {
    var g = m && m.marcador && m.marcador.ganador;
    return (g === "team1" || g === "team2") ? g : null;
  }

  // Suma de games por equipo en todos los sets.
  function gamesTotals(m) {
    var sets = (m && m.marcador && Array.isArray(m.marcador.sets)) ? m.marcador.sets : [];
    var g1 = 0, g2 = 0;
    sets.forEach(function (s) {
      if (s && typeof s.team1 === "number" && isFinite(s.team1)) g1 += s.team1;
      if (s && typeof s.team2 === "number" && isFinite(s.team2)) g2 += s.team2;
    });
    return { team1: g1, team2: g2 };
  }

  // Sets ganados por equipo (un set lo gana quien tiene más games en él).
  function setsTotals(m) {
    var sets = (m && m.marcador && Array.isArray(m.marcador.sets)) ? m.marcador.sets : [];
    var s1 = 0, s2 = 0;
    sets.forEach(function (s) {
      if (!s) return;
      var a = (typeof s.team1 === "number") ? s.team1 : null;
      var b = (typeof s.team2 === "number") ? s.team2 : null;
      if (a == null || b == null) return;
      if (a > b) s1++; else if (b > a) s2++;
    });
    return { team1: s1, team2: s2 };
  }

  // uids reales por equipo en un match.
  function teamUids(m, team) {
    var js = Array.isArray(m && m.jugadores) ? m.jugadores : [];
    return js.filter(function (j) { return j && j.uid && j.equipo === team; })
             .map(function (j) { return j.uid; });
  }

  function nameForUid(m, uid) {
    var js = Array.isArray(m && m.jugadores) ? m.jugadores : [];
    var j = js.find(function (x) { return x && x.uid === uid; });
    return (j && (j.nombre || j.displayName)) || null;
  }

  // Acumulador vacío de una unidad.
  function blankUnit(key, name, uids) {
    return {
      key: key, name: name || "", uids: uids || [],
      pj: 0, g: 0, p: 0, pts: 0, pct: 0,
      setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0,
      setDiff: 0, gameDiff: 0,
      _h2h: {},        // key rival → pts directos (para desempate)
    };
  }

  // Identifica la pareja registrada (pairId) a la que pertenecen estos uids, o null.
  function findPair(pairs, uids) {
    if (!Array.isArray(pairs) || uids.length < 2) return null;
    var set = {}; uids.forEach(function (u) { set[u] = true; });
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      var pu = (p && Array.isArray(p.uids)) ? p.uids : [];
      if (pu.length === 2 && set[pu[0]] && set[pu[1]]) return p;
    }
    return null;
  }

  /**
   * computeStandings — núcleo PURO. Devuelve { rows, period, range }.
   */
  function computeStandings(matches, opts) {
    opts = opts || {};
    var mode = (opts.mode === "pairs") ? "pairs" : "individual";
    var pointsWin = Number.isFinite(opts.pointsWin) ? opts.pointsWin : 3;
    var pointsLoss = Number.isFinite(opts.pointsLoss) ? opts.pointsLoss : 0;
    var pairs = Array.isArray(opts.pairs) ? opts.pairs : [];
    var minMatches = Number.isFinite(opts.minMatches) ? opts.minMatches : 0;
    var sortBy = (opts.sortBy === "pct") ? "pct" : "points";
    var range = periodRange(opts.period || "season", opts.now, opts.seasonStartMs, opts.seasonEndMs);

    var units = {}; // key → unit
    function unit(key, name, uids) {
      if (!units[key]) units[key] = blankUnit(key, name, uids);
      else if (name && !units[key].name) units[key].name = name; // primer nombre visto
      return units[key];
    }

    (matches || []).forEach(function (m) {
      var winner = winnerOf(m);
      if (!winner) return;                          // sin ganador → no cuenta
      var ms = matchEndMs(m);
      if (!inRange(ms, range)) return;              // fuera de período
      var sets = setsTotals(m);
      var games = gamesTotals(m);

      if (mode === "individual") {
        // Cada uid real suma a su unidad según el resultado de su equipo.
        ["team1", "team2"].forEach(function (team) {
          var won = (team === winner);
          var sf = sets[team], sa = sets[team === "team1" ? "team2" : "team1"];
          var gf = games[team], ga = games[team === "team1" ? "team2" : "team1"];
          teamUids(m, team).forEach(function (uid) {
            var us = unit(uid, nameForUid(m, uid), [uid]);
            accumulate(us, won, sf, sa, gf, ga, pointsWin, pointsLoss);
          });
        });
        // head-to-head individual: ganadores ganan pts directos sobre cada perdedor.
        recordH2H(m, winner, units, "individual", pairs, pointsWin, pointsLoss);
      } else {
        // pairs: cuenta SOLO si AMBOS equipos son parejas registradas.
        var p1 = findPair(pairs, teamUids(m, "team1"));
        var p2 = findPair(pairs, teamUids(m, "team2"));
        if (!p1 || !p2 || p1.pairId === p2.pairId) return;
        var pairByTeam = { team1: p1, team2: p2 };
        ["team1", "team2"].forEach(function (team) {
          var p = pairByTeam[team];
          var won = (team === winner);
          var sf = sets[team], sa = sets[team === "team1" ? "team2" : "team1"];
          var gf = games[team], ga = games[team === "team1" ? "team2" : "team1"];
          var us = unit(p.pairId, p.name || "Pareja", (p.uids || []).slice(0, 2));
          accumulate(us, won, sf, sa, gf, ga, pointsWin, pointsLoss);
        });
        var winnerPair = pairByTeam[winner], loserPair = pairByTeam[winner === "team1" ? "team2" : "team1"];
        var wu = units[winnerPair.pairId], lu = units[loserPair.pairId];
        wu._h2h[loserPair.pairId] = (wu._h2h[loserPair.pairId] || 0) + pointsWin;
        lu._h2h[winnerPair.pairId] = (lu._h2h[winnerPair.pairId] || 0) + pointsLoss;
      }
    });

    var rows = Object.keys(units).map(function (k) {
      var u = units[k];
      u.setDiff = u.setsFor - u.setsAgainst;
      u.gameDiff = u.gamesFor - u.gamesAgainst;
      u.pct = u.pj > 0 ? Math.round((u.g / u.pj) * 1000) / 10 : 0; // 1 decimal
      u.rankable = u.pj >= minMatches;
      return u;
    });

    rows.sort(makeComparator(sortBy));
    rows.forEach(function (u, i) { u.rank = i + 1; });
    return { rows: rows, period: opts.period || "season", range: range };
  }

  function accumulate(us, won, sf, sa, gf, ga, pointsWin, pointsLoss) {
    us.pj += 1;
    if (won) { us.g += 1; us.pts += pointsWin; }
    else { us.p += 1; us.pts += pointsLoss; }
    us.setsFor += sf; us.setsAgainst += sa;
    us.gamesFor += gf; us.gamesAgainst += ga;
  }

  // head-to-head individual: cada ganador acumula pts directos contra cada rival.
  function recordH2H(m, winner, units, mode, pairs, pointsWin, pointsLoss) {
    var loser = (winner === "team1") ? "team2" : "team1";
    var winUids = teamUids(m, winner), loseUids = teamUids(m, loser);
    winUids.forEach(function (w) {
      var wu = units[w]; if (!wu) return;
      loseUids.forEach(function (l) { wu._h2h[l] = (wu._h2h[l] || 0) + pointsWin; });
    });
    loseUids.forEach(function (l) {
      var lu = units[l]; if (!lu) return;
      winUids.forEach(function (w) { lu._h2h[w] = (lu._h2h[w] || 0) + pointsLoss; });
    });
  }

  // Comparator de desempate en cascada (estilo Torneo-5).
  //   1) primario: Pts desc (o % desc si sortBy=="pct")
  //   2) dif. sets desc  3) dif. games desc
  //   4) head-to-head (pts directos entre los dos)  5) % desc  6) nombre asc
  function makeComparator(sortBy) {
    return function (a, b) {
      // unidades no-rankeables (PJ < min) siempre al fondo.
      if (a.rankable !== b.rankable) return a.rankable ? -1 : 1;
      var prim;
      if (sortBy === "pct") {
        prim = b.pct - a.pct;
        if (prim) return prim;
        if (b.pts !== a.pts) return b.pts - a.pts;
      } else {
        prim = b.pts - a.pts;
        if (prim) return prim;
      }
      if (b.setDiff !== a.setDiff) return b.setDiff - a.setDiff;
      if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff;
      // head-to-head directo entre a y b.
      var ah = (a._h2h && a._h2h[b.key]) || 0;
      var bh = (b._h2h && b._h2h[a.key]) || 0;
      if (bh !== ah) return bh - ah;
      if (b.pct !== a.pct) return b.pct - a.pct;
      return String(a.name || a.key).localeCompare(String(b.name || b.key), "es");
    };
  }

  /**
   * computeRecent — feed de los N partidos recientes que contaron, ya filtrados/
   * ordenados (más reciente primero). Devuelve filas ligeras para render.
   */
  function computeRecent(matches, opts) {
    opts = opts || {};
    var mode = (opts.mode === "pairs") ? "pairs" : "individual";
    var pairs = Array.isArray(opts.pairs) ? opts.pairs : [];
    var limit = Number.isFinite(opts.limit) ? opts.limit : 8;
    var out = [];
    (matches || []).forEach(function (m) {
      var winner = winnerOf(m);
      if (!winner) return;
      var ms = matchEndMs(m);
      if (mode === "pairs") {
        var p1 = findPair(pairs, teamUids(m, "team1"));
        var p2 = findPair(pairs, teamUids(m, "team2"));
        if (!p1 || !p2 || p1.pairId === p2.pairId) return;
      }
      out.push({
        matchId: m.id || m.matchId || null,
        endMs: ms,
        winner: winner,
        sets: (m.marcador && Array.isArray(m.marcador.sets)) ? m.marcador.sets : [],
        team1: teamNamesOf(m, "team1"),
        team2: teamNamesOf(m, "team2"),
      });
    });
    out.sort(function (a, b) { return (b.endMs || 0) - (a.endMs || 0); });
    return out.slice(0, limit);
  }

  function teamNamesOf(m, team) {
    var js = Array.isArray(m && m.jugadores) ? m.jugadores : [];
    return js.filter(function (j) { return j && j.equipo === team; })
             .map(function (j) { return (j.nombre || j.displayName || "?"); });
  }

  var api = {
    computeStandings: computeStandings,
    computeRecent: computeRecent,
    // Helpers expuestos para tests Node.
    _matchEndMs: matchEndMs,
    _periodRange: periodRange,
    _setsTotals: setsTotals,
    _gamesTotals: gamesTotals,
    _findPair: findPair,
  };

  if (typeof window !== "undefined") window.PuntazoStandings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
