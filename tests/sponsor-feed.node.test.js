/**
 * Tests del feed de patrocinios (inyectarEnFeed en assets/sponsor.js).
 * Correr: node --test tests/sponsor-feed.node.test.js
 *
 * Regresión de dos bugs reales del 10-sep-2026, cazados con el constructor real
 * de lado.html:
 *  1. Limpiar los banners con un selector de DESCENDIENTES borraba también las
 *     pastillas de Loka que viven dentro de cada tarjeta.
 *  2. "Borrar y repintar" en cada llamada, con el MutationObserver de lado.html
 *     escuchando, era un ciclo sin fin: el banner parpadeaba y nunca completaba
 *     el segundo en pantalla que exige la impresión vista.
 *
 * sponsor.js solo arma su parte de navegador si hay `document`, así que aquí se
 * levanta un DOM mínimo (lo justo que usa el módulo) y un Firestore falso con
 * la campaña. Cada archivo de test corre en su propio proceso: estos globales
 * no contaminan a tests/sponsor.node.test.js.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");

// ── DOM mínimo ───────────────────────────────────────────────
let MUTACIONES = 0;
function tiene(n, cls) { return String(n.className).split(/\s+/).includes(cls); }
function mk(tag) {
  const n = {
    tagName: String(tag).toUpperCase(),
    children: [], parentNode: null, className: "", dataset: {}, attrs: {},
    style: { display: "", setProperty(k, v) { this[k] = v; } },
    offsetParent: {},                       // visible por defecto
    _t: "",
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return n.attrs[k]; },
    addEventListener() {},
    appendChild(c) {
      if (c.parentNode) c.remove();
      c.parentNode = n; n.children.push(c); MUTACIONES++; return c;
    },
    remove() {
      const p = n.parentNode; if (!p) return;
      p.children.splice(p.children.indexOf(n), 1); n.parentNode = null; MUTACIONES++;
    },
    insertAdjacentElement(pos, c) {
      const p = n.parentNode;
      if (c.parentNode) c.remove();
      const i = p.children.indexOf(n);
      p.children.splice(pos === "afterend" ? i + 1 : i, 0, c);
      c.parentNode = p; MUTACIONES++; return c;
    },
    get nextElementSibling() {
      const p = n.parentNode; return p ? (p.children[p.children.indexOf(n) + 1] || null) : null;
    },
    get previousElementSibling() {
      const p = n.parentNode; return p ? (p.children[p.children.indexOf(n) - 1] || null) : null;
    },
    get firstChild() { return n.children[0] || null; },
    classList: { contains: (c) => tiene(n, c) },
    set textContent(v) { n._t = String(v); n.children = []; },
    get textContent() { return n._t + n.children.map((c) => c.textContent).join(""); },
    // ".a" = descendientes; ":scope > .a" = hijos directos; admite listas con coma.
    querySelectorAll(sel) {
      const out = [];
      const add = (c) => { if (!out.includes(c)) out.push(c); };
      const walk = (x, f) => x.children.forEach((c) => { f(c); walk(c, f); });
      for (const parte of String(sel).split(",").map((s) => s.trim())) {
        if (parte.startsWith(":scope >")) {
          const cls = parte.replace(":scope >", "").trim().replace(/^\./, "");
          n.children.forEach((c) => { if (tiene(c, cls)) add(c); });
        } else {
          const cls = parte.replace(/^\./, "");
          walk(n, (c) => { if (tiene(c, cls)) add(c); });
        }
      }
      return out;
    },
  };
  return n;
}

// Campaña de Loka tal como la sirve Firestore.
const LOKA = {
  sponsorId: "loka", nombre: "Loka Healthy", activo: true, prioridad: 10, peso: 1,
  clubs: ["BreakPoint", "Interpadel"],
  slots: ["clip_page", "feed_banner", "card_inline", "feed_top"],
  creativo: {
    kicker: "Snacks saludables", claim: "Sabor natural, energía real",
    beneficios: ["Opciones sin azúcar", "Superfoods", "Hecho en México"],
    logo: "/assets/img/sponsors/loka-coin.png",
    colores: { bg: "#16342b", acento: "#b8d97a" },
    acciones: [
      { texto: "Pedir en lokahealthy.com", textoCorto: "Pedir", href: "https://lokahealthy.com", estilo: "primary", destino: "web" },
      { texto: "@lokahealthy", textoCorto: "@lokahealthy", href: "https://instagram.com/lokahealthy", estilo: "ghost", destino: "instagram" },
    ],
  },
};

global.document = { createElement: mk };
global.location = { search: "" };
global.window = {
  PuntazoFirebase: {
    db: () => ({
      collection: () => ({
        get: () => Promise.resolve({ forEach(fn) { fn({ id: "loka-2026-09", data: () => LOKA }); } }),
      }),
    }),
  },
};
const S = require("../assets/sponsor.js");

/** Feed como lo arma script.js: tarjetas hijas directas, y DENTRO de cada una
 *  la fila de acciones con el hueco de la pastilla de Loka ya lleno. */
function feed(n) {
  const cont = mk("section");
  for (let i = 0; i < n; i++) {
    const card = mk("div"); card.className = "video-card"; card.dataset.i = String(i + 1);
    const fila = mk("div"); fila.className = "action-pills";
    const hueco = mk("div"); hueco.className = "pz-sponsor-hueco";
    const chip = mk("div"); chip.className = "pz-sponsor-chip";
    hueco.appendChild(chip); fila.appendChild(hueco); card.appendChild(fila);
    cont.appendChild(card);
  }
  return cont;
}
const banners = (cont) => cont.children.filter((c) => tiene(c, "pz-sponsor-banner"));
const orden = (cont) => cont.children.map((c) => tiene(c, "pz-sponsor-banner") ? "B" : c.dataset.i).join(" ");
const OPTS = { cada: 2, selector: ".video-card", club: "BreakPoint" };

test("inyectarEnFeed NO borra las pastillas que viven dentro de cada tarjeta", async () => {
  const cont = feed(6);
  await S.inyectarEnFeed(cont, OPTS);
  cont.children.filter((c) => tiene(c, "video-card")).forEach((card) => {
    assert.strictEqual(card.querySelectorAll(".pz-sponsor-chip").length, 1,
      "la tarjeta " + card.dataset.i + " perdió su pastilla de Loka");
  });
});

test("inyectarEnFeed: un banner cada 2 tarjetas", async () => {
  const cont = feed(6);
  assert.strictEqual(await S.inyectarEnFeed(cont, OPTS), 3);
  assert.strictEqual(orden(cont), "1 2 B 3 4 B 5 6 B");
});

test("inyectarEnFeed es idempotente: repetir NO toca el DOM (sin ciclo con el observer)", async () => {
  const cont = feed(6);
  await S.inyectarEnFeed(cont, OPTS);
  const antes = banners(cont);
  MUTACIONES = 0;
  await S.inyectarEnFeed(cont, OPTS);
  await S.inyectarEnFeed(cont, OPTS);
  assert.strictEqual(MUTACIONES, 0, "una segunda pasada no debe mutar nada");
  const despues = banners(cont);
  assert.strictEqual(despues.length, 3);
  despues.forEach((b, i) => assert.strictEqual(b, antes[i], "el banner " + i + " se recreó (parpadeo)"));
});

test("inyectarEnFeed reacomoda cuando el filtro oculta tarjetas", async () => {
  const cont = feed(6);
  await S.inyectarEnFeed(cont, OPTS);
  const t2 = cont.children.find((c) => c.dataset.i === "2");
  t2.style.display = "none"; t2.offsetParent = null;         // así oculta el filtro de lado
  assert.strictEqual(await S.inyectarEnFeed(cont, OPTS), 2);
  // Visibles: 1 3 4 5 6 → banners tras la 2a (3) y la 4a (5) visibles.
  assert.strictEqual(orden(cont), "1 2 3 B 4 5 B 6");
});

test("inyectarEnFeed: en un club que no contrató no pone banners y quita los que hubiera", async () => {
  const cont = feed(6);
  await S.inyectarEnFeed(cont, OPTS);
  assert.strictEqual(await S.inyectarEnFeed(cont, { cada: 2, selector: ".video-card", club: "WellStreet-Padel" }), 0);
  assert.strictEqual(banners(cont).length, 0);
  // y las pastillas siguen donde estaban (su visibilidad la decide su propio espacio)
  assert.strictEqual(cont.querySelectorAll(".pz-sponsor-chip").length, 6);
});
