/**
 * Tests de assets/metricas.js — conteo exacto de las marcas (Loka, AquaWolf).
 * Correr: node --test tests/metricas.node.test.js
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const M = require("../assets/metricas.js");

/** Firestore y localStorage falsos: guarda cada escritura para contarlas. */
function montar(ahoraMs) {
  const escrituras = [];
  const mapa = new Map();
  const storage = { getItem: (k) => mapa.get(k) || null, setItem: (k, v) => mapa.set(k, String(v)) };
  let t = ahoraMs;
  const inst = M.crear({
    db: () => ({
      collection: (col) => ({
        doc: (id) => ({
          set: (data, opts) => { escrituras.push({ col, id, data, opts }); return Promise.resolve(); },
        }),
      }),
    }),
    incremento: () => "INC(1)",
    servidor: () => "AHORA",
    ahora: () => t,
    storage: () => storage,
  });
  const cuenta = (metrica) => escrituras.filter((e) => e.data.metrica === metrica).length;
  return { inst, escrituras, cuenta, avanzar: (ms) => { t += ms; } };
}
const DIA = 24 * 3600 * 1000;
const MEDIODIA_11SEP = Date.UTC(2026, 8, 11, 18, 0, 0);   // 12:00 en México

test("fechaMX: los días se cuentan en hora de México", () => {
  assert.strictEqual(M.fechaMX(Date.UTC(2026, 8, 11, 5, 59)), "2026-09-10", "23:59 del 10 en México");
  assert.strictEqual(M.fechaMX(Date.UTC(2026, 8, 11, 6, 0)), "2026-09-11");
});

test("clave: el id del doc es sujeto__metrica__club__fecha (las reglas lo exigen)", () => {
  assert.strictEqual(M.clave("loka-2026-09", "vista.feed_top", "BreakPoint", "2026-09-11"),
    "loka-2026-09__vista.feed_top__BreakPoint__2026-09-11");
});

test("valida: solo marcas y métricas conocidas", () => {
  assert.ok(M.valida("loka-2026-09", "vista.feed_top"));
  assert.ok(M.valida("aquawolf", "click.spotify"));
  assert.ok(M.valida("loka-2026-09", "click.card_inline.instagram"));
  for (const [s, m] of [["Loka", "vista.feed_top"], ["loka", "hack.x"], ["loka", "vista"], ["loka", "vista.feed_top.a.b"], ["", "vista.x"]]) {
    assert.ok(!M.valida(s, m), s + " / " + m);
  }
});

test("vista: cada vista suma; la persona se cuenta una vez por día y una vez en total", () => {
  const { inst, escrituras, cuenta, avanzar } = montar(MEDIODIA_11SEP);
  inst.vista("loka-2026-09", "feed_top", "BreakPoint");
  inst.vista("loka-2026-09", "feed_top", "BreakPoint");
  assert.strictEqual(cuenta("vista.feed_top"), 2);
  assert.strictEqual(cuenta("persona.feed_top"), 1);
  assert.strictEqual(cuenta("persona_total.feed_top"), 1);
  avanzar(DIA);                                            // al día siguiente vuelve
  inst.vista("loka-2026-09", "feed_top", "BreakPoint");
  assert.strictEqual(cuenta("persona.feed_top"), 2, "otro día = persona de ese día");
  assert.strictEqual(cuenta("persona_total.feed_top"), 1, "pero sigue siendo la misma persona");
  const e = escrituras[0];
  assert.strictEqual(e.col, "metricas_marcas");
  assert.strictEqual(e.id, "loka-2026-09__vista.feed_top__BreakPoint__2026-09-11");
  assert.deepStrictEqual(e.data, { n: "INC(1)", sujeto: "loka-2026-09", metrica: "vista.feed_top",
    club: "BreakPoint", fecha: "2026-09-11", updatedAt: "AHORA" });
  assert.deepStrictEqual(e.opts, { merge: true });
});

test("click: cada clic suma por destino; personas que hicieron clic, por espacio y en total", () => {
  const { inst, cuenta } = montar(MEDIODIA_11SEP);
  inst.click("loka-2026-09", "card_inline", "web", "BreakPoint");
  inst.click("loka-2026-09", "card_inline", "instagram", "BreakPoint");
  inst.click("loka-2026-09", "feed_top", "web", "BreakPoint");
  assert.strictEqual(cuenta("click.card_inline.web"), 1);
  assert.strictEqual(cuenta("click.card_inline.instagram"), 1);
  assert.strictEqual(cuenta("click.feed_top.web"), 1);
  assert.strictEqual(cuenta("clicker.card_inline"), 1);
  assert.strictEqual(cuenta("clicker.feed_top"), 1);
  assert.strictEqual(cuenta("clicker.todos"), 1, "una persona, aunque haya dado clic en dos espacios");
  assert.strictEqual(cuenta("clicker_total.todos"), 1);
});

test("AquaWolf: clic al botón de Spotify sin destino", () => {
  const { inst, cuenta, escrituras } = montar(MEDIODIA_11SEP);
  inst.click("aquawolf", "spotify", null, "WellStreet-Padel");
  inst.click("aquawolf", "spotify", null, "WellStreet-Padel");
  assert.strictEqual(cuenta("click.spotify"), 2);
  assert.strictEqual(cuenta("clicker_total.spotify"), 1);
  assert.strictEqual(escrituras[0].id, "aquawolf__click.spotify__WellStreet-Padel__2026-09-11");
});

test("datos raros no escriben nada, y un club inválido va como sin-club", () => {
  const { inst, escrituras } = montar(MEDIODIA_11SEP);
  inst.vista("loka-2026-09", "feed top!", "BreakPoint");
  inst.click("LOKA", "feed_top", "web", "BreakPoint");
  inst.vista("", "feed_top", "BreakPoint");
  assert.strictEqual(escrituras.length, 0);
  inst.vista("loka-2026-09", "feed_top", "../x");
  assert.strictEqual(escrituras[0].data.club, "sin-club");
});

test("sin localStorage cuenta las vistas pero no inventa personas", () => {
  const escrituras = [];
  const inst = M.crear({
    db: () => ({ collection: () => ({ doc: () => ({ set: (d) => { escrituras.push(d); return Promise.resolve(); } }) }) }),
    incremento: () => 1, servidor: () => 0, ahora: () => MEDIODIA_11SEP,
    storage: () => { throw new Error("bloqueado"); },
  });
  inst.vista("loka-2026-09", "feed_top", "BreakPoint");
  assert.deepStrictEqual(escrituras.map((d) => d.metrica), ["vista.feed_top"]);
});

test("sin Firestore no revienta", () => {
  const inst = M.crear({ db: () => null, incremento: () => 1, servidor: () => 0, ahora: () => 0, storage: () => null });
  assert.doesNotThrow(() => inst.vista("loka-2026-09", "feed_top", "BreakPoint"));
  assert.doesNotThrow(() => inst.click("aquawolf", "spotify", null, "BreakPoint"));
});

test("agregar + sumaPrefijo: totales por métrica, club y día", () => {
  const docs = [
    { n: 5, metrica: "vista.feed_top", club: "BreakPoint", fecha: "2026-09-11" },
    { n: 2, metrica: "vista.feed_top", club: "Interpadel", fecha: "2026-09-11" },
    { n: 3, metrica: "click.feed_top.web", club: "BreakPoint", fecha: "2026-09-12" },
    { n: 1, metrica: "click.card_inline.instagram", club: "BreakPoint", fecha: "2026-09-12" },
    { metrica: "roto" },
  ];
  const a = M.agregar(docs);
  assert.strictEqual(a.total["vista.feed_top"], 7);
  assert.strictEqual(a.porClub.BreakPoint["vista.feed_top"], 5);
  assert.strictEqual(a.porDia["2026-09-12"]["click.feed_top.web"], 3);
  assert.strictEqual(M.sumaPrefijo(a.total, "click."), 4);
});

test("enVentana: el clip lleva la marca solo si salió dentro de la ventana de su club", () => {
  const V = {
    BreakPoint: { desde: "2026-09-08T13:55", hasta: null },
    "WellStreet-Padel": { desde: "2026-09-08T13:47", hasta: "2026-09-11T09:20" },
  };
  assert.strictEqual(M.enVentana("BreakPoint_Cancha1_LadoA_08092026_135400.mp4", V), null, "antes de que empezara");
  assert.strictEqual(M.enVentana("BreakPoint_Cancha1_LadoA_08092026_135500.mp4", V), "BreakPoint");
  assert.strictEqual(M.enVentana("BreakPoint_Cancha5_LadoA_PARTIDO_abc123_11092026_200000.mp4", V), "BreakPoint");
  assert.strictEqual(M.enVentana("WellStreet-Padel_Cancha4_LadoA_11092026_092100.mp4", V), null, "ya había terminado");
  assert.strictEqual(M.enVentana("WellStreet-Padel_Cancha4_LadoA_10092026_200000.mp4", V), "WellStreet-Padel");
  assert.strictEqual(M.enVentana("Interpadel_Cancha3_LadoA_10092026_200000.mp4", V), null, "club sin ventana");
  assert.strictEqual(M.enVentana("basura.mp4", V), null);
});
