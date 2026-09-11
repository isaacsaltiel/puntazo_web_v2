/**
 * Tests de assets/musica.js — botón de Spotify en los clips con música.
 * Correr: node --test tests/musica.node.test.js
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const M = require("../assets/musica.js");

// Igual que parseFromName: fecha local armada con el nombre del clip.
const meta = (loc, y, mo, d, h, mi, tag) => ({ loc, date: new Date(y, mo - 1, d, h, mi, 0), tag: tag || null });

test("BreakPoint: los clips desde que arrancó la música llevan botón; los de antes no", () => {
  assert.strictEqual(M.llevaMusica(meta("BreakPoint", 2026, 9, 11, 7, 53)), true);
  assert.strictEqual(M.llevaMusica(meta("BreakPoint", 2026, 9, 10, 12, 53)), true, "justo al arrancar");
  assert.strictEqual(M.llevaMusica(meta("BreakPoint", 2026, 9, 10, 11, 54)), false, "antes de la música");
  assert.strictEqual(M.llevaMusica(meta("BreakPoint", 2026, 9, 9, 21, 47)), false);
});

test("WellStreet (los dos clubes) desde el 10-sep 20:12", () => {
  assert.strictEqual(M.llevaMusica(meta("WellStreet-Padel", 2026, 9, 10, 20, 30)), true);
  assert.strictEqual(M.llevaMusica(meta("WellStreet-Pickleball", 2026, 9, 11, 9, 0)), true);
  assert.strictEqual(M.llevaMusica(meta("WellStreet-Padel", 2026, 9, 10, 19, 0)), false);
});

test("Interpadel desde el 11-sep 15:01 (ahí la canción va sobre el audio de la cancha)", () => {
  assert.strictEqual(M.llevaMusica(meta("Interpadel", 2026, 9, 11, 15, 2)), true);
  assert.strictEqual(M.llevaMusica(meta("Interpadel", 2026, 9, 11, 15, 1)), true, "justo al arrancar");
  assert.strictEqual(M.llevaMusica(meta("Interpadel", 2026, 9, 11, 9, 0)), false, "antes de la música");
  assert.strictEqual(M.llevaMusica(meta("Interpadel", 2026, 9, 10, 22, 4)), false);
});

test("el partido completo va sin música: sin botón", () => {
  assert.strictEqual(M.llevaMusica(meta("BreakPoint", 2026, 9, 11, 9, 0, "PARTIDO")), false);
});

test("datos incompletos o raros no rompen: sin botón", () => {
  for (const m of [null, undefined, {}, { loc: "BreakPoint" }, { loc: "BreakPoint", date: "2026-09-11" },
                   { loc: "BreakPoint", date: new Date(NaN) }]) {
    assert.strictEqual(M.llevaMusica(m), false, JSON.stringify(m));
  }
});

function fakeDoc() {
  return {
    createElement: (tag) => ({
      tag, className: "", textContent: "", attrs: {}, hijos: [], _l: {},
      setAttribute(k, v) { this.attrs[k] = String(v); },
      appendChild(n) { this.hijos.push(n); return n; },
      addEventListener(t, f) { this._l[t] = f; },
    }),
  };
}

test("crearBoton: enlace a Spotify, en pestaña nueva, con el nombre del artista", () => {
  const a = M.crearBoton(meta("BreakPoint", 2026, 9, 11, 7, 53), { nombre: "x.mp4", doc: fakeDoc() });
  assert.strictEqual(a.tag, "a");
  assert.strictEqual(a.className, "pz-musica");
  assert.strictEqual(a.href, "https://open.spotify.com/artist/4GTPeoDoqIDrJ6GQZZKy4u");
  assert.strictEqual(a.target, "_blank");
  assert.strictEqual(a.rel, "noopener");
  assert.strictEqual(a.hijos[1].textContent, "AquaWolf");
  assert.match(a.attrs["aria-label"], /AquaWolf en Spotify/);
});

test("crearBoton: clip sin música → null (la fila queda como antes)", () => {
  assert.strictEqual(M.crearBoton(meta("Interpadel", 2026, 9, 11, 9, 0), { doc: fakeDoc() }), null);
});
