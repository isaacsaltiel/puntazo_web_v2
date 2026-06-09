/**
 * E7 — tests de los builders de notif del LOOP (lib/notify.js). Sin emulador.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const N = require("../lib/notify.js");

test("league_rank: subtitulo nombra rank, pts y rival", () => {
  const sub = N.leagueRankSubtitle({ leagueName: "Liga de los Jueves", rank: 2, ptsGained: 3, rivalName: "Ana", gap: 3 });
  assert.match(sub, /Ganaste 3 pts/);
  assert.match(sub, /#2/);
  assert.match(sub, /Ana/);
});

test("league_rank: lider (#1) tiene mensaje propio", () => {
  const sub = N.leagueRankSubtitle({ leagueName: "L", rank: 1, ptsGained: 3 });
  assert.match(sub, /Eres #1/);
});

test("league_rank payload: refId estable por liga+temporada, href a la liga", () => {
  const p = N.leagueRankPayload("G1", "S1", { leagueName: "L", rank: 1, ptsGained: 3 });
  assert.strictEqual(p.type, "league_rank");
  assert.strictEqual(p.refId, "G1:S1");
  assert.strictEqual(p.href, "/liga.html?id=G1");
});

test("season_champion: el campeon ve mensaje en 1a persona", () => {
  const p = N.seasonChampionPayload("G1", "S1", { leagueName: "L", seasonName: "Temporada 2026", championName: "Ana", youAreChampion: true });
  assert.match(p.title, /Ganaste/);
  assert.match(p.subtitle, /campeon|campeón/i);
});

test("season_champion: el resto ve quien gano", () => {
  const p = N.seasonChampionPayload("G1", "S1", { leagueName: "L", seasonName: "Temporada 2026", championName: "Ana", youAreChampion: false });
  assert.match(p.subtitle, /Ana/);
  assert.match(p.subtitle, /Temporada 2026/);
});

test("league_weekly: refId por liga+semana", () => {
  const p = N.leagueWeeklyPayload("G1", "2026-W24", { leagueName: "L", rank: 3, leaderName: "Ana" });
  assert.strictEqual(p.refId, "G1:2026-W24");
  assert.match(p.subtitle, /#3/);
});

// Cero mojibake: los builders no deben emitir secuencias rotas tipo "Ã".
test("sin mojibake en los subtitulos", () => {
  const subs = [
    N.leagueRankSubtitle({ leagueName: "L", rank: 2, ptsGained: 3, rivalName: "Ana", gap: 3 }),
    N.seasonChampionPayload("G", "S", { championName: "Ana", youAreChampion: true }).subtitle,
    N.leagueWeeklyPayload("G", "W", { rank: 1, chaserName: "Beto" }).subtitle,
  ];
  subs.forEach(function (s) { assert.ok(!/Ã|Â|â€/.test(s), "mojibake en: " + s); });
});
