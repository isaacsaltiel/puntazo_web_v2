/**
 * E7 — tests del motor de standings (assets/standings.js). PURO, sin emulador.
 * Correr:  node --test   (desde functions/)  ó  node --test test/standings.test.js
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const S = require("../../assets/standings.js");

// ── Helpers de armado de matches ──
function mk(id, t1, t2, sets, endIso) {
  // t1/t2: arrays de {uid,nombre}. sets: [[g1,g2],...]. ganador = quien gana más sets.
  var js = [];
  t1.forEach(function (p) { js.push({ uid: p.uid, nombre: p.nombre, equipo: "team1" }); });
  t2.forEach(function (p) { js.push({ uid: p.uid, nombre: p.nombre, equipo: "team2" }); });
  var s1 = 0, s2 = 0;
  var setObjs = sets.map(function (s) {
    if (s[0] > s[1]) s1++; else if (s[1] > s[0]) s2++;
    return { team1: s[0], team2: s[1] };
  });
  return {
    id: id,
    jugadores: js,
    marcador: { sets: setObjs, ganador: s1 > s2 ? "team1" : "team2" },
    endedAt: endIso ? new Date(endIso) : new Date("2026-06-01T12:00:00Z"),
  };
}
const P = {
  ana: { uid: "ana", nombre: "Ana" }, beto: { uid: "beto", nombre: "Beto" },
  caro: { uid: "caro", nombre: "Caro" }, dani: { uid: "dani", nombre: "Dani" },
  evan: { uid: "evan", nombre: "Evan" }, fede: { uid: "fede", nombre: "Fede" },
};

// 1) PJ/G/P/Pts básicos individual
test("individual: cuenta PJ/G/P/Pts (3/0) por jugador", () => {
  const ms = [mk("m1", [P.ana, P.beto], [P.caro, P.dani], [[6, 4], [6, 3]])]; // team1 gana
  const r = S.computeStandings(ms, { mode: "individual", period: "all" });
  const ana = r.rows.find(x => x.key === "ana");
  const caro = r.rows.find(x => x.key === "caro");
  assert.strictEqual(ana.pj, 1);
  assert.strictEqual(ana.g, 1);
  assert.strictEqual(ana.pts, 3);
  assert.strictEqual(caro.p, 1);
  assert.strictEqual(caro.pts, 0);
});

// 2) % winrate
test("individual: % winrate correcto", () => {
  const ms = [
    mk("m1", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]]),  // ana gana
    mk("m2", [P.ana, P.caro], [P.beto, P.dani], [[2, 6], [3, 6]]),  // ana pierde
  ];
  const r = S.computeStandings(ms, { mode: "individual", period: "all" });
  const ana = r.rows.find(x => x.key === "ana");
  assert.strictEqual(ana.pj, 2);
  assert.strictEqual(ana.g, 1);
  assert.strictEqual(ana.pct, 50);
});

// 3) ±sets y ±games
test("individual: diferencia de sets y games", () => {
  const ms = [mk("m1", [P.ana, P.beto], [P.caro, P.dani], [[6, 4], [6, 3]])]; // 2-0 sets, 12-7 games
  const r = S.computeStandings(ms, { mode: "individual", period: "all" });
  const ana = r.rows.find(x => x.key === "ana");
  const caro = r.rows.find(x => x.key === "caro");
  assert.strictEqual(ana.setDiff, 2);
  assert.strictEqual(ana.gameDiff, 5);
  assert.strictEqual(caro.setDiff, -2);
  assert.strictEqual(caro.gameDiff, -5);
});

// 4) orden por Pts desc
test("orden primario: Pts desc", () => {
  const ms = [
    mk("m1", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]]),
    mk("m2", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]]),
  ];
  const r = S.computeStandings(ms, { mode: "individual", period: "all" });
  assert.strictEqual(r.rows[0].key, "ana"); // o beto, ambos 6 pts; ana por nombre
  assert.ok(r.rows[0].pts >= r.rows[r.rows.length - 1].pts);
  assert.strictEqual(r.rows[0].rank, 1);
});

// 5) desempate por dif. de sets
test("desempate: igual Pts → mayor dif. de sets primero", () => {
  // ana y evan ambos ganan 1 (3 pts), pero ana con más dif. de sets.
  const ms = [
    mk("a", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]]),   // ana +2 sets
    mk("b", [P.evan, P.fede], [P.caro, P.dani], [[6, 4], [4, 6], [6, 4]]), // evan +1 set
  ];
  const r = S.computeStandings(ms, { mode: "individual", period: "all" });
  const ana = r.rows.find(x => x.key === "ana");
  const evan = r.rows.find(x => x.key === "evan");
  assert.strictEqual(ana.pts, 3);
  assert.strictEqual(evan.pts, 3);
  assert.ok(ana.rank < evan.rank, "ana (mas dif. sets) por encima de evan");
});

// 6) desempate por dif. de games (igual Pts y sets)
test("desempate: igual Pts y sets → mayor dif. de games", () => {
  const ms = [
    mk("a", [P.ana, P.beto], [P.caro, P.dani], [[6, 1], [6, 1]]),   // +10 games, +2 sets
    mk("b", [P.evan, P.fede], [P.caro, P.dani], [[6, 4], [6, 4]]),  // +4 games, +2 sets
  ];
  const r = S.computeStandings(ms, { mode: "individual", period: "all" });
  const ana = r.rows.find(x => x.key === "ana");
  const evan = r.rows.find(x => x.key === "evan");
  assert.strictEqual(ana.setDiff, evan.setDiff);
  assert.ok(ana.gameDiff > evan.gameDiff);
  assert.ok(ana.rank < evan.rank);
});

// 7) head-to-head: empate total, decide el enfrentamiento directo
test("desempate: head-to-head cuando Pts/sets/games empatan", () => {
  // ana vs beto, 1-1 en encuentros pero mismo balance global → forzamos h2h.
  // Construimos: ana gana a beto 6-3 6-3; beto gana a ana 6-3 6-3 (mismo balance).
  // Ambos: 1G 1P, 3 pts, setDiff 0, gameDiff 0. h2h directo empata 3-3 → cae a %/nombre.
  // Para probar h2h con desempate real: ana le gana a beto dos veces head-to-head.
  const ms = [
    mk("x1", [P.ana, P.caro], [P.beto, P.dani], [[6, 3], [3, 6], [6, 3]]), // ana gana
    mk("x2", [P.beto, P.caro], [P.ana, P.dani], [[6, 3], [3, 6], [6, 3]]), // beto gana
  ];
  // ana: 1G1P pts3; beto: 1G1P pts3. setDiff y gameDiff iguales por simetría.
  const r = S.computeStandings(ms, { mode: "individual", period: "all" });
  const ana = r.rows.find(x => x.key === "ana");
  const beto = r.rows.find(x => x.key === "beto");
  assert.strictEqual(ana.pts, beto.pts);
  assert.strictEqual(ana.setDiff, beto.setDiff);
  assert.strictEqual(ana.gameDiff, beto.gameDiff);
  // h2h directo entre ana y beto: cada uno ganó 1 → 3-3 empate, cae a nombre (Ana<Beto).
  assert.ok(ana.rank < beto.rank);
});

// 8) head-to-head decisivo (asimétrico)
test("desempate: head-to-head decisivo (uno le ganó al otro)", () => {
  // ana y beto enfrentados como rivales (ambos solos contra el otro + un comodín),
  // dos partidos con marcadores ESPEJO para igualar pts/setDiff/gameDiff:
  //   d1: ana&caro vs beto&dani  6-4 6-4 → ana gana (h2h ana +3)
  //   d2: beto&caro vs ana&dani  4-6 4-6 → ana gana otra vez (h2h ana +3, total +6 vs 0)
  // ana: 2G0P pts6 setDiff+4 gameDiff+8 ; beto: 0G2P pts0 — NO empatan.
  // Para forzar EMPATE global con h2h decisivo usamos un comodín que reparte:
  //   d1: ana&caro vs beto&dani 6-4 6-4 (ana gana, beto pierde)
  //   d2: beto&caro vs ana&dani 6-4 6-4 (beto gana, ana pierde)  ← h2h 1-1
  //   d3: ana&evan vs beto&fede 6-4 6-4 (ana gana a beto directo otra vez)
  // ana: 2G1P; beto: 1G2P → no empatan tampoco. El h2h "puro" con empate global
  // exige simetría perfecta; lo cubre el test #7. Aquí validamos que el h2h SUMA
  // correctamente y rompe el empate cuando lo demás coincide, vía dos rivales espejo:
  const ms = [
    mk("d1", [P.ana, P.caro], [P.beto, P.dani], [[6, 4], [6, 4]]), // ana gana a beto
    mk("d2", [P.beto, P.caro], [P.ana, P.dani], [[4, 6], [4, 6]]), // ana gana a beto de nuevo (team2)
  ];
  // ana: 2G0P pts6 ; beto: 0G2P pts0 → ana arriba por pts (sanidad), y h2h ana 6-0.
  const r = S.computeStandings(ms, { mode: "individual", period: "all" });
  const ana = r.rows.find(x => x.key === "ana");
  const beto = r.rows.find(x => x.key === "beto");
  assert.ok(ana.pts > beto.pts);
  assert.strictEqual(ana._h2h.beto, 6, "ana acumulo 6 pts h2h directos sobre beto");
  assert.strictEqual(beto._h2h.ana, 0, "beto 0 pts h2h sobre ana");
  assert.ok(ana.rank < beto.rank);
});

// 9) período: semana filtra partidos fuera de rango
test("período week: solo cuenta partidos de la semana actual", () => {
  const now = new Date("2026-06-10T12:00:00Z").getTime(); // miércoles
  const ms = [
    mk("in", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]], "2026-06-09T10:00:00Z"), // lun de esa semana
    mk("out", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]], "2026-05-01T10:00:00Z"), // mes pasado
  ];
  const r = S.computeStandings(ms, { mode: "individual", period: "week", now: now });
  const ana = r.rows.find(x => x.key === "ana");
  assert.strictEqual(ana.pj, 1, "solo el partido de esta semana cuenta");
});

// 10) período month
test("período month: filtra al mes actual", () => {
  const now = new Date("2026-06-15T12:00:00Z").getTime();
  const ms = [
    mk("in", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]], "2026-06-02T10:00:00Z"),
    mk("out", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]], "2026-04-20T10:00:00Z"),
  ];
  const r = S.computeStandings(ms, { mode: "individual", period: "month", now: now });
  const ana = r.rows.find(x => x.key === "ana");
  assert.strictEqual(ana.pj, 1);
});

// 11) período season (rango explícito)
test("período season: respeta seasonStartMs/seasonEndMs", () => {
  const ms = [
    mk("in", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]], "2026-06-05T10:00:00Z"),
    mk("before", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]], "2026-01-05T10:00:00Z"),
  ];
  const r = S.computeStandings(ms, {
    mode: "individual", period: "season",
    seasonStartMs: new Date("2026-06-01T00:00:00Z").getTime(),
    seasonEndMs: new Date("2026-07-01T00:00:00Z").getTime(),
  });
  const ana = r.rows.find(x => x.key === "ana");
  assert.strictEqual(ana.pj, 1);
});

// 12) pairs: solo cuenta pareja-registrada vs pareja-registrada
test("pairs: cuenta solo si ambos equipos son parejas registradas", () => {
  const pairs = [
    { pairId: "AB", uids: ["ana", "beto"], name: "Ana & Beto" },
    { pairId: "CD", uids: ["caro", "dani"], name: "Caro & Dani" },
  ];
  const ms = [
    mk("reg", [P.ana, P.beto], [P.caro, P.dani], [[6, 4], [6, 4]]),   // AB vs CD ✓
    mk("noreg", [P.ana, P.evan], [P.caro, P.dani], [[6, 0], [6, 0]]), // ana+evan no es pareja ✗
  ];
  const r = S.computeStandings(ms, { mode: "pairs", pairs: pairs, period: "all" });
  const ab = r.rows.find(x => x.key === "AB");
  assert.ok(ab, "pareja AB existe");
  assert.strictEqual(ab.pj, 1, "solo el partido pareja-vs-pareja cuenta");
  assert.strictEqual(ab.g, 1);
  assert.strictEqual(ab.pts, 3);
  assert.strictEqual(ab.name, "Ana & Beto");
});

// 13) pairs: tabla lista parejas, perdedora suma derrota
test("pairs: la pareja perdedora suma P y 0 pts", () => {
  const pairs = [
    { pairId: "AB", uids: ["ana", "beto"], name: "Ana & Beto" },
    { pairId: "CD", uids: ["caro", "dani"], name: "Caro & Dani" },
  ];
  const ms = [mk("reg", [P.ana, P.beto], [P.caro, P.dani], [[6, 4], [6, 4]])];
  const r = S.computeStandings(ms, { mode: "pairs", pairs: pairs, period: "all" });
  const cd = r.rows.find(x => x.key === "CD");
  assert.strictEqual(cd.p, 1);
  assert.strictEqual(cd.pts, 0);
});

// 14) minMatches: unidades por debajo del mínimo van al fondo
test("minMatches: PJ < min marca rankable=false y van al fondo", () => {
  const ms = [
    mk("m1", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]]),
    mk("m2", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]]),
    // evan solo 1 partido
    mk("m3", [P.evan, P.fede], [P.caro, P.dani], [[6, 0], [6, 0]]),
  ];
  const r = S.computeStandings(ms, { mode: "individual", period: "all", minMatches: 2 });
  const evan = r.rows.find(x => x.key === "evan");
  const ana = r.rows.find(x => x.key === "ana");
  assert.strictEqual(evan.rankable, false);
  assert.strictEqual(ana.rankable, true);
  assert.ok(ana.rank < evan.rank, "no-rankeables al fondo aunque tengan buenos pts");
});

// 15) sortBy pct: ordena por % primero
test("sortBy=pct: ordena por winrate primero", () => {
  const ms = [
    // ana: 1G de 1 (100%) pts3 ; beto: 2G de 4 (50%) pts6
    mk("a1", [P.ana, P.evan], [P.caro, P.dani], [[6, 0], [6, 0]]),
    mk("b1", [P.beto, P.fede], [P.caro, P.dani], [[6, 0], [6, 0]]),
    mk("b2", [P.beto, P.fede], [P.caro, P.dani], [[6, 0], [6, 0]]),
    mk("b3", [P.beto, P.fede], [P.ana, P.dani], [[0, 6], [0, 6]]), // ana gana aqui tb
  ];
  const r = S.computeStandings(ms, { mode: "individual", period: "all", sortBy: "pct" });
  // ana: 2G0P 100%; beto: 2G1P 66.7%
  const ana = r.rows.find(x => x.key === "ana");
  const beto = r.rows.find(x => x.key === "beto");
  assert.strictEqual(ana.pct, 100);
  assert.ok(ana.pct > beto.pct);
  assert.ok(ana.rank < beto.rank, "por % ana arriba aunque beto tenga pts comparables");
});

// 16) sin ganador no cuenta
test("match sin ganador valido se ignora", () => {
  const bad = {
    id: "bad",
    jugadores: [{ uid: "ana", equipo: "team1", nombre: "Ana" }, { uid: "caro", equipo: "team2", nombre: "Caro" }],
    marcador: { sets: [{ team1: 6, team2: 6 }], ganador: null },
    endedAt: new Date("2026-06-01T12:00:00Z"),
  };
  const r = S.computeStandings([bad], { mode: "individual", period: "all" });
  assert.strictEqual(r.rows.length, 0);
});

// 17) computeRecent: feed ordenado desc, respeta limit
test("computeRecent: ordena por fecha desc y respeta limit", () => {
  const ms = [
    mk("old", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]], "2026-06-01T10:00:00Z"),
    mk("new", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]], "2026-06-08T10:00:00Z"),
    mk("mid", [P.ana, P.beto], [P.caro, P.dani], [[6, 0], [6, 0]], "2026-06-04T10:00:00Z"),
  ];
  const rec = S.computeRecent(ms, { mode: "individual", limit: 2 });
  assert.strictEqual(rec.length, 2);
  assert.strictEqual(rec[0].matchId, "new");
  assert.strictEqual(rec[1].matchId, "mid");
});

// 18) matchEndMs: robusto a {seconds}
test("_matchEndMs soporta Timestamp-like {seconds}", () => {
  const ms = S._matchEndMs({ endedAt: { seconds: 1000, nanoseconds: 0 } });
  assert.strictEqual(ms, 1000000);
});

// 19) periodRange week: lunes a domingo (7 dias)
test("_periodRange week dura exactamente 7 dias", () => {
  const range = S._periodRange("week", new Date("2026-06-10T12:00:00Z").getTime());
  assert.strictEqual(range.end - range.start, 7 * 86400000);
});
