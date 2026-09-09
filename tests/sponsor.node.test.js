/**
 * Tests del sistema de patrocinios (assets/sponsor.js).
 * Correr: node --test tests/sponsor.node.test.js
 *
 * sponsor.js exporta su lógica pura cuando no hay DOM, así que aquí se
 * requiere directo. Lo que se prueba es lo que cuesta dinero si falla:
 * que una campaña no se muestre fuera de su vigencia (cobrar de más),
 * que no aparezca en un club que no contrató (cobrar mal), y que el
 * reparto entre campañas del mismo nivel sea el pactado.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../assets/sponsor.js");

const DIA = 86400000;
const hoy = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh || 12, mm || 0).getTime();

function campana(extra) {
  return Object.assign({
    id: "c1", sponsorId: "acme", nombre: "Acme", activo: true,
    desde: null, hasta: null, prioridad: 0, peso: 1,
    clubs: [], slots: [],
    creativo: { claim: "x", acciones: [{ texto: "Ir", href: "https://acme.mx" }] },
  }, extra || {});
}

// ── Fechas ───────────────────────────────────────────────────
test("parseFecha: AAAA-MM-DD se lee en hora LOCAL, no UTC", () => {
  const t = S.parseFecha("2026-09-09", false);
  const d = new Date(t);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 8);
  assert.strictEqual(d.getDate(), 9, "no debe correrse de día por zona horaria");
  assert.strictEqual(d.getHours(), 0);
});

test("parseFecha: finDelDia lleva a 23:59:59.999 (hasta es INCLUSIVO)", () => {
  const d = new Date(S.parseFecha("2026-09-30", true));
  assert.strictEqual(d.getDate(), 30);
  assert.strictEqual(d.getHours(), 23);
  assert.strictEqual(d.getMinutes(), 59);
});

test("parseFecha: acepta Timestamp de Firestore, Date y null", () => {
  const ms = hoy(2026, 9, 9);
  assert.strictEqual(S.parseFecha({ toDate: () => new Date(ms) }), ms);
  assert.strictEqual(S.parseFecha({ seconds: Math.floor(ms / 1000) }), Math.floor(ms / 1000) * 1000);
  assert.strictEqual(S.parseFecha(new Date(ms)), ms);
  assert.strictEqual(S.parseFecha(null), null);
  assert.strictEqual(S.parseFecha(""), null);
});

// ── Vigencia ─────────────────────────────────────────────────
test("vigente: sin fechas corre siempre", () => {
  assert.strictEqual(S.vigente(campana(), Date.now()), true);
});

test("vigente: activo=false apaga aunque las fechas estén vigentes", () => {
  assert.strictEqual(S.vigente(campana({ activo: false }), Date.now()), false);
});

test("vigente: no se muestra antes de empezar", () => {
  const c = campana({ desde: "2026-09-10" });
  assert.strictEqual(S.vigente(c, hoy(2026, 9, 9, 23)), false, "el día anterior no");
  assert.strictEqual(S.vigente(c, hoy(2026, 9, 10, 0)), true, "desde las 00:00 sí");
});

test("vigente: el ÚLTIMO día del contrato se ve completo, y al siguiente ya no", () => {
  const c = campana({ hasta: "2026-09-30" });
  assert.strictEqual(S.vigente(c, hoy(2026, 9, 30, 23, 59)), true, "el día 30 a las 23:59 todavía");
  assert.strictEqual(S.vigente(c, hoy(2026, 10, 1, 0, 1)), false, "el 1 de octubre ya no");
});

test("vigente: se apaga sola al vencer, sin desplegar nada", () => {
  const c = campana({ desde: "2026-09-01", hasta: "2026-09-15" });
  assert.strictEqual(S.vigente(c, hoy(2026, 9, 16)), false);
});

// ── Segmentación por club ────────────────────────────────────
test("aplicaAClub: lista vacía = todos los clubes", () => {
  assert.strictEqual(S.aplicaAClub(campana({ clubs: [] }), "BreakPoint"), true);
  assert.strictEqual(S.aplicaAClub(campana({ clubs: [] }), null), true);
});

test("aplicaAClub: segmentada solo sale en sus clubes", () => {
  const c = campana({ clubs: ["BreakPoint", "Interpadel"] });
  assert.strictEqual(S.aplicaAClub(c, "BreakPoint"), true);
  assert.strictEqual(S.aplicaAClub(c, "Interpadel"), true);
  assert.strictEqual(S.aplicaAClub(c, "WellStreet-Padel"), false, "WellStreet no contrató");
  assert.strictEqual(S.aplicaAClub(c, "Scorpion"), false);
});

test("aplicaAClub: si segmenta y NO sabemos el club, no se muestra", () => {
  // Preferimos perder una impresión a cobrarle a un patrocinador por un
  // club que no contrató.
  const c = campana({ clubs: ["BreakPoint"] });
  assert.strictEqual(S.aplicaAClub(c, null), false);
  assert.strictEqual(S.aplicaAClub(c, ""), false);
});

// ── Espacios ─────────────────────────────────────────────────
test("aplicaASlot: lista vacía = cualquier espacio; con lista, solo esos", () => {
  assert.strictEqual(S.aplicaASlot(campana({ slots: [] }), "clip_page"), true);
  const c = campana({ slots: ["feed_banner"] });
  assert.strictEqual(S.aplicaASlot(c, "feed_banner"), true);
  assert.strictEqual(S.aplicaASlot(c, "clip_page"), false);
});

// ── Selección ────────────────────────────────────────────────
test("candidatas: cruza vigencia + club + espacio", () => {
  const lista = [
    campana({ id: "vigente-bp", clubs: ["BreakPoint"], slots: ["clip_page"] }),
    campana({ id: "otro-club", clubs: ["Scorpion"], slots: ["clip_page"] }),
    campana({ id: "otro-slot", clubs: ["BreakPoint"], slots: ["feed_banner"] }),
    campana({ id: "vencida", clubs: ["BreakPoint"], slots: ["clip_page"], hasta: "2026-01-01" }),
    campana({ id: "apagada", clubs: ["BreakPoint"], slots: ["clip_page"], activo: false }),
  ];
  const r = S.candidatas(lista, "clip_page", "BreakPoint", hoy(2026, 9, 9));
  assert.deepStrictEqual(r.map((c) => c.id), ["vigente-bp"]);
});

test("elegir: gana la prioridad más alta", () => {
  const r = S.elegir([
    campana({ id: "baja", prioridad: 1 }),
    campana({ id: "alta", prioridad: 10 }),
    campana({ id: "media", prioridad: 5 }),
  ]);
  assert.strictEqual(r.id, "alta");
});

test("elegir: a igual prioridad reparte por peso", () => {
  const lista = [
    campana({ id: "a", prioridad: 5, peso: 3 }),
    campana({ id: "b", prioridad: 5, peso: 1 }),
  ];
  // total=4; r = aleatorio*4. r<=3 => "a"; r>3 => "b"
  assert.strictEqual(S.elegir(lista, () => 0.10).id, "a", "0.4 de 4 cae en a");
  assert.strictEqual(S.elegir(lista, () => 0.74).id, "a", "2.96 de 4 sigue en a");
  assert.strictEqual(S.elegir(lista, () => 0.90).id, "b", "3.6 de 4 cae en b");
});

test("elegir: el reparto por peso se cumple en el agregado", () => {
  const lista = [
    campana({ id: "a", prioridad: 5, peso: 3 }),
    campana({ id: "b", prioridad: 5, peso: 1 }),
  ];
  let a = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    // barrido determinista en vez de azar: mide el reparto exacto
    if (S.elegir(lista, () => (i + 0.5) / N).id === "a") a++;
  }
  const proporcion = a / N;
  assert.ok(Math.abs(proporcion - 0.75) < 0.01, "peso 3:1 => ~75% para a, dio " + proporcion);
});

test("elegir: sin candidatas devuelve null", () => {
  assert.strictEqual(S.elegir([]), null);
  assert.strictEqual(S.elegir(null), null);
});

// ── Carga: respaldo y cuelgues ───────────────────────────────
// Lo que importa aquí es que SIEMPRE termine. Un Firestore colgado (que ni
// resuelve ni rechaza) es real en redes malas, y sin reloj dejaba el respaldo
// sin disparar para siempre: el anuncio no aparecía nunca.
const cuelga = () => new Promise(() => {});
const responde = (v, ms) => () => new Promise((r) => setTimeout(() => r(v), ms || 0));
const falla = () => Promise.reject(new Error("boom"));

test("carga: usa la primera fuente cuando responde", async () => {
  const r = await S.cargarDeFuentes([
    { nombre: "firestore", fn: responde([campana({ id: "a" })]) },
    { nombre: "json", fn: responde([campana({ id: "b" })]) },
  ], 500);
  assert.strictEqual(r.fuente, "firestore");
  assert.strictEqual(r.campanas[0].id, "a");
});

test("carga: si la primera FALLA, cae al respaldo", async () => {
  const r = await S.cargarDeFuentes([
    { nombre: "firestore", fn: falla },
    { nombre: "json", fn: responde([campana({ id: "b" })]) },
  ], 500);
  assert.strictEqual(r.fuente, "json");
  assert.strictEqual(r.campanas[0].id, "b");
});

test("carga: si la primera se CUELGA, el reloj la corta y cae al respaldo", async () => {
  const t0 = Date.now();
  const r = await S.cargarDeFuentes([
    { nombre: "firestore", fn: cuelga },
    { nombre: "json", fn: responde([campana({ id: "b" })]) },
  ], 120);
  assert.strictEqual(r.fuente, "json", "debe haber caído al respaldo");
  assert.ok(Date.now() - t0 >= 100, "esperó al reloj");
  assert.ok(Date.now() - t0 < 2000, "y no se quedó colgado");
});

test("carga: si TODAS se cuelgan, termina igual con lista vacía", async () => {
  const r = await S.cargarDeFuentes([
    { nombre: "firestore", fn: cuelga },
    { nombre: "json", fn: cuelga },
  ], 60);
  assert.strictEqual(r.fuente, "vacio");
  assert.deepStrictEqual(r.campanas, [], "la página se ve igual, solo sin anuncio");
});

test("carga: un throw síncrono de una fuente no tumba la cadena", async () => {
  const r = await S.cargarDeFuentes([
    { nombre: "firestore", fn: () => { throw new Error("sin db"); } },
    { nombre: "json", fn: responde([campana({ id: "b" })]) },
  ], 200);
  assert.strictEqual(r.fuente, "json");
});

test("conReloj: resuelve normal si llega a tiempo", async () => {
  const v = await S.conReloj(Promise.resolve(42), 200, "x");
  assert.strictEqual(v, 42);
});

// ── Cache de elección ────────────────────────────────────────
// REGRESIÓN (9-sep-2026): la cache se llaveaba solo por espacio, así que la
// primera elección se reusaba para CUALQUIER club. En una página con clips de
// varios clubes (guardados, perfil) el anuncio se filtraba a clubes que no lo
// contrataron. Lo cazó la prueba de integración en el navegador, no estos tests.
test("cache: la llave incluye el club, no solo el espacio", () => {
  assert.notStrictEqual(
    S.llaveEleccion("clip_page", "BreakPoint"),
    S.llaveEleccion("clip_page", "WellStreet-Padel"));
  assert.strictEqual(
    S.llaveEleccion("clip_page", "BreakPoint"),
    S.llaveEleccion("clip_page", "BreakPoint"), "misma pareja, misma llave");
});

test("cache: elegir para un club contratado NO filtra el anuncio a otro club", () => {
  const lista = [campana({ id: "loka", clubs: ["BreakPoint", "Interpadel"] })];
  const cache = {};
  const ahora = Date.now();
  const bp = S.elegirConCache(cache, lista, "clip_page", "BreakPoint", ahora);
  assert.ok(bp, "BreakPoint contrató: debe salir");
  const ws = S.elegirConCache(cache, lista, "clip_page", "WellStreet-Padel", ahora);
  assert.strictEqual(ws, null, "WellStreet no contrató: NO debe salir");
  const sc = S.elegirConCache(cache, lista, "clip_page", "Scorpion", ahora);
  assert.strictEqual(sc, null, "Scorpion tampoco");
  const bp2 = S.elegirConCache(cache, lista, "clip_page", "BreakPoint", ahora);
  assert.strictEqual(bp2, bp, "y BreakPoint sigue devolviendo lo mismo");
});

test("cache: no cambia de campaña a media página (misma respuesta al repetir)", () => {
  const lista = [
    campana({ id: "a", prioridad: 5, peso: 1 }),
    campana({ id: "b", prioridad: 5, peso: 1 }),
  ];
  const cache = {};
  const ahora = Date.now();
  const primera = S.elegirConCache(cache, lista, "feed_banner", "BreakPoint", ahora, () => 0.9);
  // Aunque el azar diga otra cosa, la segunda llamada debe repetir la primera:
  // dos banners distintos en el mismo feed se ven como un error.
  const segunda = S.elegirConCache(cache, lista, "feed_banner", "BreakPoint", ahora, () => 0.1);
  assert.strictEqual(segunda.id, primera.id);
});

test("cache: marca el club en la campaña elegida, sin pisar la original", () => {
  const original = campana({ id: "loka", clubs: ["BreakPoint", "Interpadel"] });
  const cache = {};
  const ahora = Date.now();
  const bp = S.elegirConCache(cache, [original], "clip_page", "BreakPoint", ahora);
  const ip = S.elegirConCache(cache, [original], "clip_page", "Interpadel", ahora);
  assert.strictEqual(bp._club, "BreakPoint");
  assert.strictEqual(ip._club, "Interpadel", "cada club conserva el suyo");
  assert.strictEqual(original._club, undefined, "la campaña original no se ensucia");
});

// ── Normalización ────────────────────────────────────────────
test("normalizar: descarta campañas sin creativo utilizable", () => {
  assert.strictEqual(S.normalizar({ sponsorId: "x" }), null, "sin creativo");
  assert.strictEqual(S.normalizar({ sponsorId: "x", creativo: {} }), null, "sin acciones");
  assert.strictEqual(S.normalizar({ sponsorId: "x", creativo: { acciones: [] } }), null, "acciones vacías");
  assert.ok(S.normalizar(campana()), "una completa sí pasa");
});

test("normalizar: activo por defecto true, peso por defecto 1", () => {
  const c = S.normalizar(campana({ activo: undefined, peso: undefined }));
  assert.strictEqual(c.activo, true);
  assert.strictEqual(c.peso, 1);
});

// ── El archivo real de configuración ─────────────────────────
test("data/sponsors.json es válido y Loka está segmentada como se pactó", () => {
  const j = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "sponsors.json"), "utf8"));
  const campanas = j.campanas.map((c) => S.normalizar(c)).filter(Boolean);
  assert.ok(campanas.length >= 1, "todas las campañas del archivo deben normalizar");

  const loka = campanas.find((c) => c.sponsorId === "loka");
  assert.ok(loka, "Loka debe existir");
  // Decisión de negocio: Loka va en BreakPoint e Interpadel, NO en WellStreet.
  assert.strictEqual(S.aplicaAClub(loka, "BreakPoint"), true);
  assert.strictEqual(S.aplicaAClub(loka, "Interpadel"), true);
  assert.strictEqual(S.aplicaAClub(loka, "WellStreet-Padel"), false);
  assert.strictEqual(S.aplicaAClub(loka, "WellStreet-Pickleball"), false);
  assert.strictEqual(S.aplicaAClub(loka, "Scorpion"), false);
  // Y está vigente hoy.
  assert.strictEqual(S.vigente(loka, Date.now()), true);
  // Los dos destinos que promete el outro del video.
  const destinos = loka.creativo.acciones.map((a) => a.destino);
  assert.ok(destinos.includes("web"), "debe llevar a la web");
  assert.ok(destinos.includes("instagram"), "debe llevar a Instagram");
});

test("data/sponsors.json: ningún club listado está mal escrito", () => {
  const j = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "sponsors.json"), "utf8"));
  const cfg = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "config_locations.json"), "utf8"));
  const validos = new Set(cfg.locaciones.map((l) => l.id));
  for (const c of j.campanas) {
    for (const club of (c.clubs || [])) {
      assert.ok(validos.has(club),
        `"${club}" no existe en config_locations.json (campaña ${c.id})`);
    }
  }
});
