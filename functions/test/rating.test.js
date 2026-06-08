/**
 * Tests del núcleo de ranking server-side (lib/rating.js). Sin emulador.
 * Correr:  npm test   (desde functions/ — pretest vendoriza el motor)
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { planRatingUpdate, contextsForMatch } = require("../lib/rating.js");

function matchBase(extra) {
  return Object.assign({
    id: "m1",
    deporte: "padel",
    loc: "BreakPoint",
    modo: "partido_3",
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { uid: "maria", equipo: "team1", nombre: "Maria" },
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
      { uid: "ana", equipo: "team2", nombre: "Ana" },
    ],
    marcador: { sets: [{ team1: 6, team2: 4 }, { team1: 6, team2: 3 }], ganador: "team1" },
    endedAt: new Date("2026-06-01T12:00:00Z"),
  }, extra || {});
}

test("contextos: global + club siempre; group solo si groupId", () => {
  assert.deepStrictEqual(contextsForMatch(matchBase()), ["global:padel", "club:BreakPoint:padel"]);
  assert.deepStrictEqual(
    contextsForMatch(matchBase({ groupId: "grpX" })),
    ["global:padel", "club:BreakPoint:padel", "group:grpX:padel"]
  );
});

test("jugadores nuevos: global y club se crean; ganador sube, perdedor baja en AMBOS", () => {
  const plan = planRatingUpdate(matchBase(), {});
  assert.ok(plan.applied);
  // 4 jugadores actualizados
  assert.deepStrictEqual(Object.keys(plan.updatesByUid).sort(), ["ana", "carlos", "maria", "pedro"]);
  // pedro (ganó) sube en global y club
  assert.ok(plan.updatesByUid.pedro["global:padel"].rating > 1500);
  assert.ok(plan.updatesByUid.pedro["club:BreakPoint:padel"].rating > 1500);
  // carlos (perdió) baja en global y club
  assert.ok(plan.updatesByUid.carlos["global:padel"].rating < 1500);
  // wins/losses
  assert.strictEqual(plan.updatesByUid.pedro["global:padel"].wins, 1);
  assert.strictEqual(plan.updatesByUid.carlos["global:padel"].losses, 1);
  // campos UI
  assert.ok(plan.updatesByUid.pedro["global:padel"].reliability >= 0);
  assert.ok(typeof plan.updatesByUid.pedro["global:padel"].bucket === "string");
  assert.strictEqual(plan.updatesByUid.pedro["global:padel"].isCalibrating, true);
});

test("local se SIEMBRA del global (RD inflado), no arranca en 1500", () => {
  // pedro ya es fuerte globalmente (1900/80), nunca jugó en el club
  const current = {
    pedro: { byContext: { "global:padel": { rating: 1900, RD: 80, volatility: 0.05, matchCount: 30, wins: 25, losses: 5 } } },
  };
  const plan = planRatingUpdate(matchBase(), current);
  const clubState = plan.updatesByUid.pedro["club:BreakPoint:padel"];
  // tras 1 partido en el club, su rating club debe estar MUCHO más cerca de 1900 que de 1500
  assert.ok(clubState.rating > 1700, `club rating=${clubState.rating} deberia partir cerca del global 1900`);
  // y su global también se actualizó (mismo match alimenta ambos)
  assert.ok(plan.updatesByUid.pedro["global:padel"].rating !== 1900);
});

test("group: si match.groupId, también actualiza el contexto del grupo", () => {
  const plan = planRatingUpdate(matchBase({ groupId: "grpX" }), {});
  assert.ok(plan.updatesByUid.pedro["group:grpX:padel"]);
  assert.ok(plan.updatesByUid.pedro["group:grpX:padel"].rating > 1500);
});

test("acumula wins/losses sobre el estado previo", () => {
  const current = {
    pedro: { byContext: { "global:padel": { rating: 1600, RD: 120, volatility: 0.06, matchCount: 9, wins: 6, losses: 3 } } },
  };
  const plan = planRatingUpdate(matchBase(), current);
  assert.strictEqual(plan.updatesByUid.pedro["global:padel"].wins, 7);
  assert.strictEqual(plan.updatesByUid.pedro["global:padel"].losses, 3);
  assert.strictEqual(plan.updatesByUid.pedro["global:padel"].isCalibrating, false, "10 partidos ya no calibra");
});

test("skip: equipo sin uid real no aplica nada (anti-trampa)", () => {
  const m = matchBase({
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { equipo: "team2", nombre: "Cristiano" },
    ],
  });
  const plan = planRatingUpdate(m, {});
  assert.strictEqual(plan.applied, false);
  assert.deepStrictEqual(plan.updatesByUid, {});
});
