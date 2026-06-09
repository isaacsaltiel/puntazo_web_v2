/**
 * E7 — tests del tagging PURO de partidos a liga (lib/leagues.js). Sin emulador.
 * Correr:  node --test   (desde functions/)
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const L = require("../lib/leagues.js");

function match(uids) {
  // uids: [t1a,t1b,t2a,t2b] (algunos pueden ser null = dummy sin cuenta)
  const js = [];
  if (uids[0]) js.push({ uid: uids[0], equipo: "team1", nombre: uids[0] });
  if (uids[1]) js.push({ uid: uids[1], equipo: "team1", nombre: uids[1] });
  if (uids[2]) js.push({ uid: uids[2], equipo: "team2", nombre: uids[2] });
  if (uids[3]) js.push({ uid: uids[3], equipo: "team2", nombre: uids[3] });
  return { jugadores: js, marcador: { sets: [{ team1: 6, team2: 4 }], ganador: "team1" } };
}
function indivLeague(groupId, members) {
  return { groupId: groupId, memberUids: members, league: { mode: "individual", countThreshold: 3 } };
}
function pairsLeague(groupId, members, pairs) {
  return { groupId: groupId, memberUids: members, league: { mode: "pairs", pairs: pairs } };
}

// 1) individual: 4 de 4 miembros → califica
test("individual: 4/4 miembros califica", () => {
  const lg = indivLeague("L", ["a", "b", "c", "d"]);
  const q = L.leagueQualifies(match(["a", "b", "c", "d"]), lg);
  assert.strictEqual(q.qualifies, true);
  assert.strictEqual(q.overlap, 4);
});

// 2) individual: 3 de 4 miembros → califica
test("individual: 3/4 miembros califica (umbral por defecto 3)", () => {
  const lg = indivLeague("L", ["a", "b", "c"]);          // d no es miembro
  const q = L.leagueQualifies(match(["a", "b", "c", "d"]), lg);
  assert.strictEqual(q.qualifies, true);
  assert.strictEqual(q.overlap, 3);
});

// 3) individual: 2 de 4 miembros → NO califica
test("individual: 2/4 miembros NO califica", () => {
  const lg = indivLeague("L", ["a", "b"]);
  const q = L.leagueQualifies(match(["a", "b", "c", "d"]), lg);
  assert.strictEqual(q.qualifies, false);
  assert.strictEqual(q.overlap, 2);
});

// 4) resolveLeagueGroupId: sin preChosen, elige la liga que califica
test("resolve: sin preChosen elige la liga que califica", () => {
  const cands = [indivLeague("L1", ["a", "b", "c", "d"]), indivLeague("L2", ["a"])];
  const res = L.resolveLeagueGroupId(match(["a", "b", "c", "d"]), cands, null);
  assert.strictEqual(res.groupId, "L1");
});

// 5) resolve: ninguna califica → null
test("resolve: ninguna califica → null", () => {
  const cands = [indivLeague("L1", ["a"]), indivLeague("L2", ["b"])];
  const res = L.resolveLeagueGroupId(match(["a", "b", "c", "d"]), cands, null);
  assert.strictEqual(res.groupId, null);
  assert.strictEqual(res.reason, "no-qualifying-league");
});

// 6) resolve: preChosen que califica se respeta
test("resolve: preChosen que califica se respeta", () => {
  const cands = [indivLeague("L1", ["a", "b", "c", "d"]), indivLeague("L2", ["a", "b", "c", "d"])];
  const res = L.resolveLeagueGroupId(match(["a", "b", "c", "d"]), cands, "L2");
  assert.strictEqual(res.groupId, "L2");
  assert.strictEqual(res.reason, "prechosen-qualifies");
});

// 7) resolve: preChosen que NO califica → null (no inventa otra)
test("resolve: preChosen que NO califica → null", () => {
  const cands = [indivLeague("L1", ["a"]), indivLeague("L2", ["a", "b", "c", "d"])];
  const res = L.resolveLeagueGroupId(match(["a", "b", "c", "d"]), cands, "L1");
  assert.strictEqual(res.groupId, null);
  assert.strictEqual(res.reason, "prechosen-not-qualifying");
});

// 8) resolve: empate de overlap → desempate determinista por groupId
test("resolve: empate de overlap → groupId menor (determinista)", () => {
  const cands = [indivLeague("Lb", ["a", "b", "c", "d"]), indivLeague("La", ["a", "b", "c", "d"])];
  const res = L.resolveLeagueGroupId(match(["a", "b", "c", "d"]), cands, null);
  assert.strictEqual(res.groupId, "La");
});

// 9) pairs: ambos equipos parejas registradas → califica
test("pairs: pareja-vs-pareja registradas califica", () => {
  const pairs = [{ pairId: "AB", uids: ["a", "b"] }, { pairId: "CD", uids: ["c", "d"] }];
  const lg = pairsLeague("L", ["a", "b", "c", "d"], pairs);
  const q = L.leagueQualifies(match(["a", "b", "c", "d"]), lg);
  assert.strictEqual(q.qualifies, true);
});

// 10) pairs: un equipo NO es pareja registrada → NO califica
test("pairs: equipo sin pareja registrada NO califica", () => {
  const pairs = [{ pairId: "AB", uids: ["a", "b"] }]; // c,d no son pareja
  const lg = pairsLeague("L", ["a", "b", "c", "d"], pairs);
  const q = L.leagueQualifies(match(["a", "b", "c", "d"]), lg);
  assert.strictEqual(q.qualifies, false);
});

// 11) pairs: misma pareja en ambos equipos (imposible real) → NO califica
test("pairs: misma pareja a ambos lados NO califica", () => {
  const pairs = [{ pairId: "AB", uids: ["a", "b"] }];
  const lg = pairsLeague("L", ["a", "b"], pairs);
  // a&b vs a&b — degenerado; pairMatch encontraria AB en ambos → distinto requerido.
  const m = { jugadores: [
    { uid: "a", equipo: "team1" }, { uid: "b", equipo: "team1" },
    { uid: "a", equipo: "team2" }, { uid: "b", equipo: "team2" },
  ], marcador: { ganador: "team1", sets: [] } };
  const q = L.leagueQualifies(m, lg);
  assert.strictEqual(q.qualifies, false);
});

// 12) realPlayerUids ignora dummies sin uid
test("realPlayerUids ignora jugadores sin uid", () => {
  const m = { jugadores: [
    { uid: "a", equipo: "team1" }, { equipo: "team1", nombre: "Dummy" },
    { uid: "c", equipo: "team2" }, { uid: "d", equipo: "team2" },
  ] };
  assert.deepStrictEqual(L.realPlayerUids(m).sort(), ["a", "c", "d"]);
});

// 13) umbral configurable: countThreshold 4 exige los 4
test("individual: countThreshold=4 exige 4/4", () => {
  const lg = { groupId: "L", memberUids: ["a", "b", "c"], league: { mode: "individual", countThreshold: 4 } };
  const q = L.leagueQualifies(match(["a", "b", "c", "d"]), lg);
  assert.strictEqual(q.qualifies, false);
});

// 14) resolve: preChosen que no es candidata (grupo generico) → null
test("resolve: preChosen no-liga → null", () => {
  const cands = [indivLeague("L1", ["a", "b", "c", "d"])];
  const res = L.resolveLeagueGroupId(match(["a", "b", "c", "d"]), cands, "GENERIC");
  assert.strictEqual(res.groupId, null);
  assert.strictEqual(res.reason, "prechosen-not-a-league");
});
