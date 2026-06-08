/**
 * GATE-0 (bloqueante) — Validacion del motor Glicko-2 portado a Node.
 *
 * El test central replica el ejemplo canonico del paper de Glickman
 * "Example of the Glicko-2 system" (Glickman, 2013) con TOLERANCIA ESTRICTA.
 * Si esto no pasa, el motor esta mal portado y NADA mas de ranking puede
 * construirse encima. Es el primer gate del build (spec §8 F0).
 *
 * Correr:  node --test tests/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const PR = require("../assets/ranking.js");

// ── 1. El vector de Glickman (la verdad del paper) ───────────────────────────
// Player: rating=1500, RD=200, vol=0.06, TAU=0.5
// vs 3 oponentes en un rating period:
//   opp1 1400/30  -> gano  (s=1)
//   opp2 1550/100 -> perdi (s=0)
//   opp3 1700/300 -> perdi (s=0)
// Resultado del paper:  mu'=-0.2069 -> rating=1464.05 ; phi'=0.8722 -> RD=151.52 ; sigma'=0.05999
test("Glickman 2013 — vector canonico (rating 1464.05 / RD 151.52 / vol 0.05999)", () => {
  const r = PR._updatePlayer(1500, 200, 0.06, [
    { rating: 1400, rd: 30, score: 1 },
    { rating: 1550, rd: 100, score: 0 },
    { rating: 1700, rd: 300, score: 0 },
  ]);
  assert.ok(Math.abs(r.rating - 1464.05) < 0.3, `rating=${r.rating} esperado ~1464.05`);
  assert.ok(Math.abs(r.rd - 151.52) < 0.3, `RD=${r.rd} esperado ~151.52`);
  assert.ok(Math.abs(r.volatility - 0.05999) < 0.0002, `vol=${r.volatility} esperado ~0.05999`);
});

// ── 2. Sin partidos: solo decay (RD crece, rating estable) ───────────────────
test("sin oponentes: RD crece por volatilidad, rating no cambia", () => {
  const r = PR._updatePlayer(1500, 200, 0.06, []);
  assert.strictEqual(r.rating, 1500);
  assert.ok(r.rd >= 200, `RD=${r.rd} deberia crecer o mantenerse`);
});

// ── 3. MOV: monotonia + corrección de autocorrelación ────────────────────────
test("MOV escala con el margen y respeta el cap 1.3", () => {
  const close = PR.applyMOV(1, 2);
  const blow = PR.applyMOV(1, 12);
  assert.ok(blow > close, `blowout(${blow}) deberia > close(${close})`);
  assert.ok(blow <= 1.3 && close <= 1.3, "MOV no excede el cap 1.3");
  assert.strictEqual(PR.applyMOV(0.5, 8), 0.5, "empate no se ajusta");
});

test("MOV autocorrelacion: underdog que gana por paliza > favorito que gana por paliza", () => {
  const favorito = PR.applyMOV(1, 6, +400);  // ganador era favorito (eloDiff +)
  const neutro = PR.applyMOV(1, 6, 0);
  const underdog = PR.applyMOV(1, 6, -400);  // ganador era underdog (eloDiff -)
  assert.ok(underdog > neutro && neutro >= favorito,
    `esperado underdog(${underdog}) > neutro(${neutro}) >= favorito(${favorito})`);
  // eloDiff=0 debe replicar el comportamiento clásico (sin 3er arg)
  assert.strictEqual(PR.applyMOV(1, 6, 0), PR.applyMOV(1, 6));
});

// ── 4. seedLocalFromGlobal (D3) ──────────────────────────────────────────────
test("seedLocalFromGlobal hereda rating e infla RD a >=200", () => {
  const s1 = PR.seedLocalFromGlobal({ rating: 1800, RD: 80, volatility: 0.05 });
  assert.strictEqual(s1.rating, 1800, "hereda rating del global");
  assert.strictEqual(s1.RD, 200, "RD bajo (80) se infla al piso 200");
  assert.strictEqual(s1.seededFromGlobal, true);
  assert.strictEqual(s1.isCalibrating, true);

  const s2 = PR.seedLocalFromGlobal({ rating: 1600, RD: 300, volatility: 0.06 });
  assert.strictEqual(s2.RD, 300, "RD alto (300) se conserva (no se baja)");

  // Sin global (caso defensivo, no deberia pasar en prod): defaults frescos.
  // rd=INITIAL_RD(350); max(350, SEED_LOCAL_RD=200)=350.
  const s3 = PR.seedLocalFromGlobal(null);
  assert.strictEqual(s3.rating, PR.INITIAL_RATING, "sin global -> rating default");
  assert.strictEqual(s3.RD, PR.INITIAL_RD, "sin global -> RD default 350");
});

// ── 5. reliability (UI desde RD) ─────────────────────────────────────────────
test("reliability mapea RD -> 0..100", () => {
  assert.strictEqual(PR.reliability(50), 100);
  assert.strictEqual(PR.reliability(350), 0);
  assert.strictEqual(PR.reliability(200), 50);
  assert.ok(PR.reliability(20) <= 100 && PR.reliability(20) >= 0, "clamp inferior");
});

// ── 6. applyMatchToRatings: 2v2 real, ganador sube / perdedor baja ───────────
test("applyMatchToRatings: ganador sube, perdedor baja, deltas individuales", () => {
  const match = {
    id: "m1", modo: "partido_3",
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { uid: "maria", equipo: "team1", nombre: "Maria" },
      { uid: "carlos", equipo: "team2", nombre: "Carlos" },
      { uid: "ana", equipo: "team2", nombre: "Ana" },
    ],
    marcador: { sets: [{ team1: 6, team2: 4 }, { team1: 6, team2: 3 }], ganador: "team1" },
    endedAt: new Date("2026-06-01T12:00:00Z"),
  };
  const out = PR.applyMatchToRatings(match, {});
  assert.ok(!out.audit.skipped, "no skipped");
  assert.ok(out.newRatings.pedro.rating > 1500, "pedro sube");
  assert.ok(out.newRatings.carlos.rating < 1500, "carlos baja");
  assert.strictEqual(out.newRatings.pedro.isCalibrating, true, "calibrando con 1 partido");
});

// ── Modelo v2 (margen + bono + anti-farm), aprobado 2026-06-07 ───────────────
function ratingForNivel(n) { return 800 + (n - 1) * 250 + 0.5 * 80; }
function established(n) {
  return { rating: ratingForNivel(n), RD: 80, volatility: 0.06, matchCount: 30, lastMatchAt: null, recentOpponents: {} };
}
function match1v1(youNivel, oppNivel, youWin, sets, endedAt) {
  return {
    id: "v2", deporte: "padel", modo: "partido_5",
    jugadores: [{ uid: "yo", equipo: "team1", nombre: "Yo" }, { uid: "op", equipo: "team2", nombre: "Op" }],
    marcador: { sets, ganador: youWin ? "team1" : "team2" },
    endedAt: endedAt || new Date("2026-06-01T12:00:00Z"),
  };
}
const PARTIDAZO = [{ team1: 7, team2: 6 }, { team1: 6, team2: 7 }, { team1: 7, team2: 5 }];

test("v2: PARTIDAZO entre iguales → ganador sube y perdedor CASI no baja (cushion, zero-sum)", () => {
  // Con el bono zero-sum (anti-inflación), un partidazo PAREJO ya no sube a los dos;
  // el ganador sube y el perdedor pierde MUY POCO comparado con una paliza (cushion).
  const curP = { yo: established(3.5), op: established(3.5) };
  const partidazo = PR.applyMatchToRatings(match1v1(3.5, 3.5, true, PARTIDAZO), curP, { skipAntifarm: true });
  const curB = { yo: established(3.5), op: established(3.5) };
  const blowout = PR.applyMatchToRatings(match1v1(3.5, 3.5, true, [{ team1: 6, team2: 1 }, { team1: 6, team2: 0 }]), curB, { skipAntifarm: true });
  assert.ok(partidazo.newRatings.yo.rating > curP.yo.rating, "ganador sube en el partidazo");
  const lossPartidazo = curP.op.rating - partidazo.newRatings.op.rating; // >0 = bajó
  const lossPaliza = curB.op.rating - blowout.newRatings.op.rating;
  assert.ok(lossPartidazo < lossPaliza * 0.6, "perder un partidazo cuesta bastante MENOS que perder una paliza (cushion)");
});

test("v2: perder un PARTIDAZO contra alguien MUCHO MEJOR → te SUBE (mérito)", () => {
  const cur = { yo: established(3.5), op: established(5.0) };
  // yo (team1) PIERDO el partidazo contra op (5.0)
  const out = PR.applyMatchToRatings(match1v1(3.5, 5.0, false, PARTIDAZO), cur);
  assert.ok(out.newRatings.yo.rating > cur.yo.rating, "el underdog sube pese a perder el partidazo");
});

test("v2: perder un partidazo contra alguien MUCHO PEOR → te BAJA (sin mérito)", () => {
  const cur = { yo: established(5.0), op: established(2.0) };
  const out = PR.applyMatchToRatings(match1v1(5.0, 2.0, false, PARTIDAZO), cur);
  assert.ok(out.newRatings.yo.rating < cur.yo.rating, "el favorito que pierde baja, aunque sea cerrado");
});

test("v2: anti-farm → repetir el mismo partidazo vs el mismo rival suma MENOS", () => {
  const end = new Date("2026-06-01T12:00:00Z");
  const recentTs = end.getTime() - 60 * 60 * 1000; // hace 1h, dentro de la ventana 3d
  const fresh = { yo: established(3.5), op: established(3.5) };
  const farmed = {
    yo: Object.assign(established(3.5), { recentOpponents: { op: [recentTs, recentTs, recentTs] } }),
    op: Object.assign(established(3.5), { recentOpponents: { yo: [recentTs, recentTs, recentTs] } }),
  };
  const g1 = PR.applyMatchToRatings(match1v1(3.5, 3.5, true, PARTIDAZO, end), fresh);
  const g2 = PR.applyMatchToRatings(match1v1(3.5, 3.5, true, PARTIDAZO, end), farmed);
  const gain1 = g1.newRatings.yo.rating - fresh.yo.rating;
  const gain2 = g2.newRatings.yo.rating - farmed.yo.rating;
  assert.ok(gain2 < gain1, `repetido (${gain2.toFixed(1)}) debe sumar menos que la 1a vez (${gain1.toFixed(1)})`);
});

function match2v2(nA, nB, nC, nD, t1Wins, sets, endedAt) {
  return {
    id: "v2pareja", deporte: "padel", modo: "partido_5",
    jugadores: [
      { uid: "a", equipo: "team1", nombre: "A" }, { uid: "b", equipo: "team1", nombre: "B" },
      { uid: "c", equipo: "team2", nombre: "C" }, { uid: "d", equipo: "team2", nombre: "D" },
    ],
    marcador: { sets, ganador: t1Wins ? "team1" : "team2" },
    endedAt: endedAt || new Date("2026-06-01T12:00:00Z"),
  };
}
const WIN_2V2 = [{ team1: 6, team2: 3 }, { team1: 6, team2: 4 }];

test("v2 pareja: manda el EQUIPO pero lo individual se considera (deltas cercanos, con tilt)", () => {
  // tú 3.0 con compañero 5.0 ganan a dos 4.0 → ambos suben parecido, el débil un pelín más
  const cur = { a: established(3.0), b: established(5.0), c: established(4.0), d: established(4.0) };
  const out = PR.applyMatchToRatings(match2v2(3.0, 5.0, 4.0, 4.0, true, WIN_2V2), cur, { skipAntifarm: true });
  const dA = out.newRatings.a.rating - cur.a.rating;
  const dB = out.newRatings.b.rating - cur.b.rating;
  assert.ok(dA > 0 && dB > 0, "ambos suben");
  assert.ok(dA > dB, "el débil (3.0) sube un pelín MÁS (tilt individual)");
  assert.ok(Math.abs(dA - dB) < 0.25 * Math.max(dA, dB) + 10, "pero MANDA el equipo: deltas cercanos, no como el viejo +0.100/+0.005");
});

test("v2 convergencia: compañeros inseparables se ACERCAN lento (gap baja)", () => {
  let A = established(3.0), B = established(2.0);
  const gap0 = (A.rating - B.rating);
  const LOSE_2V2 = [{ team1: 3, team2: 6 }, { team1: 4, team2: 6 }];
  for (let i = 1; i <= 30; i++) {
    const cur = { a: A, b: B, c: established(2.5), d: established(2.5) };
    const win = i % 2 === 0;
    const out = PR.applyMatchToRatings(match2v2(0, 0, 0, 0, win, win ? WIN_2V2 : LOSE_2V2), cur, { skipAntifarm: true });
    A = out.newRatings.a; B = out.newRatings.b;
  }
  const gapN = (A.rating - B.rating);
  assert.ok(gapN < gap0, `el gap baja (${gapN.toFixed(0)} < ${gap0.toFixed(0)})`);
  assert.ok(gapN > 0, "pero no se cruzan (sigue siendo lento, no instantáneo)");
});

test("v2: perder CLARO (no partidazo) contra mucho mejor NO te sube (anti-inflación)", () => {
  const cur = { a: established(4.5), b: established(4.5), c: established(5.0), d: established(5.0) };
  const clearLoss = [{ team1: 3, team2: 6 }, { team1: 4, team2: 6 }];
  const out = PR.applyMatchToRatings(match2v2(4.5, 4.5, 5.0, 5.0, false, clearLoss), cur, { skipAntifarm: true });
  assert.ok(out.newRatings.a.rating <= cur.a.rating + 0.5, "perder 3-6 4-6 (derrota clara) NO debe subirte el nivel");
});

test("applyMatchToRatings: skip si un equipo no tiene uids (anti 'le gane a Cristiano')", () => {
  const match = {
    id: "m2",
    jugadores: [
      { uid: "pedro", equipo: "team1", nombre: "Pedro" },
      { equipo: "team2", nombre: "Cristiano" }, // dummy sin uid
    ],
    marcador: { sets: [{ team1: 6, team2: 0 }], ganador: "team1" },
    endedAt: new Date(),
  };
  const out = PR.applyMatchToRatings(match, {});
  assert.ok(out.audit.skipped, "debe skippear: team2 sin uid real");
});
