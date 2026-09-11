/**
 * Tests de assets/clips-en-vivo.js — el clip aparece solo en lado.html.
 * Correr: node --test tests/clips-en-vivo.node.test.js
 *
 * El doc de ejemplo es un clip REAL de BreakPoint. Su link de rclone (dl=0) se
 * midió el 10-sep-2026: una vez convertido a raw=1 debe ser idéntico al del
 * índice JSON (data/Locaciones/BreakPoint/Cancha3/LadoA/videos_recientes.json).
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const V = require("../assets/clips-en-vivo.js");

const CTX = { loc: "BreakPoint", can: "Cancha3", lado: "LadoA" };
const NOMBRE = "BreakPoint_Cancha3_LadoA_10092026_072950.mp4";
const URL_INDICE = "https://www.dropbox.com/scl/fi/l0d26d4pt33u9sn5xviba/" + NOMBRE +
  "?rlkey=ondi26bxplj8ljtvki0167ljq&raw=1";
const DOC = {
  club: "BreakPoint", cancha: "Cancha3", lado: "LadoA", state: "visible",
  ts_pulso: "2026-09-10 07:29:50", nombre: NOMBRE,
  video_url: "https://www.dropbox.com/scl/fi/l0d26d4pt33u9sn5xviba/" + NOMBRE + "?rlkey=ondi26bxplj8ljtvki0167ljq&dl=0",
  poster_url: "https://www.dropbox.com/scl/fi/svz2pdz0av7joqck2hrx9/BreakPoint_Cancha3_LadoA_10092026_072950.jpg?rlkey=k8mt1cjy7h9a9guy4j7xh08mv&dl=0",
};
const OTRO = { ...DOC, nombre: "BreakPoint_Cancha3_LadoA_10092026_073412.mp4", ts_pulso: "2026-09-10 07:34:12" };

// ── lógica pura ──────────────────────────────────────────────

test("pisoTsPulso: 24 h atrás, en hora de México y con el formato de ts_pulso", () => {
  // 10-sep 20:00 UTC = 14:00 en México
  assert.strictEqual(V.pisoTsPulso(Date.UTC(2026, 8, 10, 20, 0, 0), 24), "2026-09-09 14:00:00");
  // Cruza la medianoche: 10-sep 03:30:05 UTC = 9-sep 21:30:05 MX; 1 h antes
  assert.strictEqual(V.pisoTsPulso(Date.UTC(2026, 8, 10, 3, 30, 5), 1), "2026-09-09 20:30:05");
});

test("urlSegura: el link de rclone (dl=0) queda IDÉNTICO al del índice (raw=1)", () => {
  assert.strictEqual(V.urlSegura(DOC.video_url), URL_INDICE);
  assert.strictEqual(V.urlSegura(URL_INDICE), URL_INDICE, "un link ya directo no cambia");
});

test("urlSegura: rechaza todo lo que no sea https de Dropbox", () => {
  const malos = ["http://www.dropbox.com/x.mp4", "https://evil.com/x.mp4", "javascript:alert(1)",
    "https://www.dropbox.com.evil.com/x.mp4", "", null, 42, undefined];
  for (const u of malos) assert.strictEqual(V.urlSegura(u), null, String(u));
});

test("docAEntrada: doc listo de este lado → entrada con la forma del índice", () => {
  const e = V.docAEntrada(DOC, CTX);
  assert.strictEqual(e.nombre, NOMBRE);
  assert.strictEqual(e.url, URL_INDICE);
  assert.ok(e.poster_url.endsWith("&raw=1"));
  assert.strictEqual(e._vivo, true);
});

test("docAEntrada: ignora lo que no está listo, es de otro lado o viene raro", () => {
  const casos = {
    "en cola": { state: "en_cola" },
    "error": { state: "error" },
    "sin link (NUC que aún no lo publica)": { video_url: null },
    "otro lado": { lado: "LadoB" },
    "otra cancha": { cancha: "Cancha1" },
    "otro club": { club: "Interpadel" },
    "nombre de otra cancha": { nombre: "BreakPoint_Cancha1_LadoA_10092026_072950.mp4" },
    "nombre con ruta": { nombre: "../BreakPoint_Cancha3_LadoA_10092026_072950.mp4" },
    "nombre que no es mp4": { nombre: "BreakPoint_Cancha3_LadoA_10092026_072950.mov" },
    "sin nombre": { nombre: undefined },
    "link fuera de Dropbox": { video_url: "https://evil.com/x.mp4" },
  };
  for (const [caso, cambio] of Object.entries(casos)) {
    assert.strictEqual(V.docAEntrada({ ...DOC, ...cambio }, CTX), null, caso);
  }
});

test("docAEntrada: sin miniatura válida, el clip igual sale", () => {
  const e = V.docAEntrada({ ...DOC, poster_url: "ftp://x.jpg" }, CTX);
  assert.ok(e && !("poster_url" in e));
});

test("entradasDe: deduplica por nombre y descarta lo inválido", () => {
  assert.strictEqual(V.entradasDe([DOC, { ...DOC }, { ...DOC, state: "en_cola" }, null], CTX).length, 1);
});

// ── controlador: cuándo se pinta y cuándo se avisa ───────────

function fakeDoc() {
  const cards = {};
  const body = { hijos: [], appendChild(n) { this.hijos.push(n); n._padre = this; return n; } };
  return {
    body, cards,
    getElementById: (id) => cards[id] || null,
    createElement: (tag) => ({
      tag, className: "", textContent: "", _l: {},
      addEventListener(t, f) { this._l[t] = f; },
      remove() { const p = this._padre; if (p) p.hijos.splice(p.hijos.indexOf(this), 1); this._padre = null; },
      click() { if (this._l.click) this._l.click(); },
    }),
  };
}
function fakeCard() {
  const s = new Set();
  return { classList: { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) } };
}
/** Imita window.PuntazoLado (script.js). `enLista` = lo que ya trae el índice;
 *  `lejos` = bajó más de una pantalla desde el inicio de los clips. */
function fakeLado(o = {}) {
  const lista = new Set(o.enLista || []);
  return {
    estado: { listo: o.listo !== false, pagina: o.pagina || 0, reproduciendo: !!o.reproduciendo, lejos: !!o.lejos },
    llamadas: { render: 0, irAlInicio: 0, mostrarClip: [] },
    listo() { return this.estado.listo; },
    enPrimeraPagina() { return this.estado.pagina === 0; },
    algoReproduciendo() { return this.estado.reproduciendo; },
    lejosDelInicio() { return this.estado.lejos; },
    sumarClipsEnVivo(ents) {
      const n = ents.filter((e) => !lista.has(e.nombre));
      n.forEach((e) => lista.add(e.nombre));
      return n;
    },
    render() { this.llamadas.render++; return Promise.resolve(); },
    irAlInicio() { this.llamadas.irAlInicio++; return Promise.resolve(); },
    mostrarClip(nombres) { this.llamadas.mostrarClip.push(nombres); },
  };
}
function montar(opts = {}) {
  const doc = fakeDoc();
  const L = fakeLado(opts);
  const eventos = [];
  const ctl = V.crearControlador(CTX, { lado: () => L, doc, gtag: () => (...a) => eventos.push(a) });
  return { doc, L, ctl, eventos };
}
const tick = () => new Promise((r) => setImmediate(r));

test("cerca del inicio de los clips y sin video sonando: se pinta y la vista va al clip", async () => {
  const { doc, L, ctl, eventos } = montar();
  doc.cards[NOMBRE] = fakeCard();
  assert.strictEqual(ctl.recibir([DOC]), "directo");
  assert.strictEqual(L.llamadas.render, 1);
  await tick();
  assert.deepStrictEqual(L.llamadas.mostrarClip, [[NOMBRE]], "la vista debe ir al clip nuevo");
  assert.ok(doc.cards[NOMBRE].classList.contains("pz-clip-nuevo"), "la tarjeta nueva no se resaltó");
  assert.deepStrictEqual(eventos[0].slice(0, 2), ["event", "clip_en_vivo"]);
  assert.strictEqual(eventos[0][2].modo, "directo");
});

test("viendo un video: NO re-pinta (no se lo corta); avisa, y el aviso lleva al clip", async () => {
  const { doc, L, ctl } = montar({ reproduciendo: true });
  doc.cards[NOMBRE] = fakeCard();
  assert.strictEqual(ctl.recibir([DOC]), "aviso");
  assert.strictEqual(L.llamadas.render, 0);
  const aviso = doc.body.hijos[0];
  assert.strictEqual(aviso.className, "pz-vivo-aviso");
  assert.strictEqual(aviso.textContent, "↑ 1 clip nuevo");
  aviso.click();
  assert.strictEqual(L.llamadas.irAlInicio, 1);
  assert.strictEqual(doc.body.hijos.length, 0, "el aviso debe desaparecer al tocarlo");
  await tick();
  assert.deepStrictEqual(L.llamadas.mostrarClip, [[NOMBRE]], "tocar el aviso debe llevar AL CLIP, no al tope");
  assert.ok(doc.cards[NOMBRE].classList.contains("pz-clip-nuevo"));
});

test("bajó más de una pantalla desde el inicio de los clips: avisa; otro clip se suma al MISMO aviso", () => {
  const { doc, L, ctl } = montar({ lejos: true });
  assert.strictEqual(ctl.recibir([DOC]), "aviso");
  assert.strictEqual(ctl.recibir([DOC, OTRO]), "aviso");
  assert.strictEqual(doc.body.hijos.length, 1);
  assert.strictEqual(doc.body.hijos[0].textContent, "↑ 2 clips nuevos");
  assert.strictEqual(L.llamadas.render, 0);
});

test("en otra página del feed: avisa en vez de sacarla de donde está", () => {
  const { L, ctl } = montar({ pagina: 2 });
  assert.strictEqual(ctl.recibir([DOC]), "aviso");
  assert.strictEqual(L.llamadas.render, 0);
});

test("mientras script.js carga no toca el feed; al terminar de cargar lo entrega", () => {
  const { L, ctl } = montar({ listo: false });
  assert.strictEqual(ctl.recibir([DOC]), "espera");
  assert.strictEqual(L.llamadas.render, 0);
  assert.strictEqual(ctl.entradas().length, 1, "populateVideos debe poder sumarlo al cargar");
  L.estado.listo = true;
  assert.strictEqual(ctl.entregar(), "directo");
});

test("un clip que el índice ya trae no hace nada", () => {
  const { doc, L, ctl } = montar({ enLista: [NOMBRE] });
  assert.strictEqual(ctl.recibir([DOC]), "nada");
  assert.strictEqual(L.llamadas.render, 0);
  assert.strictEqual(doc.body.hijos.length, 0);
});

test("el mismo doc en snapshots siguientes no se vuelve a entregar", () => {
  const { L, ctl } = montar();
  ctl.recibir([DOC]);
  assert.strictEqual(ctl.recibir([DOC]), "nada");
  assert.strictEqual(L.llamadas.render, 1);
});

test("docs de otros estados o sin link no despiertan nada", () => {
  const { L, ctl } = montar();
  assert.strictEqual(ctl.recibir([{ ...DOC, state: "en_cola" }, { ...DOC, video_url: null }]), "nada");
  assert.strictEqual(L.llamadas.render, 0);
});

test("con un script.js viejo (sin mostrarClip) igual pinta y resalta, sin romperse", async () => {
  const { doc, L, ctl } = montar();
  delete L.mostrarClip;
  doc.cards[NOMBRE] = fakeCard();
  assert.strictEqual(ctl.recibir([DOC]), "directo");
  await tick();
  assert.ok(doc.cards[NOMBRE].classList.contains("pz-clip-nuevo"));
});

// Regresión cazada en el navegador: tras "Actualizar", el clip ya estaba pintado
// arriba y el aviso seguía ahí.
test("tras recargar en la página 1, el aviso sobra y se quita", () => {
  const { doc, ctl } = montar({ lejos: true });
  ctl.recibir([DOC]);
  assert.strictEqual(doc.body.hijos.length, 1);
  ctl.alCargar();
  assert.strictEqual(doc.body.hijos.length, 0);
});

test("tras recargar en otra página, el aviso se queda: el clip está en la página 1", () => {
  const { doc, ctl } = montar({ pagina: 3 });
  ctl.recibir([DOC]);
  ctl.alCargar();
  assert.strictEqual(doc.body.hijos.length, 1);
});
