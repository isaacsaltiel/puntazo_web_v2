/**
 * Vendoriza el motor de ranking a la carpeta de la Cloud Function.
 *
 * Por que: `assets/ranking.js` es la UNICA fuente de verdad del Glicko-2 y la usa
 * la web. Pero `firebase deploy` solo sube `functions/`, no puede `require()` un
 * archivo fuera de esa carpeta. Este script copia el motor a `functions/vendor/`
 * (generado, gitignored) en pre-test y pre-deploy, manteniendo una sola fuente.
 *
 * Correr:  node scripts/vendor-ranking.js   (desde functions/)
 */
"use strict";
const fs = require("fs");
const path = require("path");

const DEST_DIR = path.resolve(__dirname, "..", "vendor");
fs.mkdirSync(DEST_DIR, { recursive: true });

// Fuentes UNICAS en assets/ que la Cloud Function necesita require(). `firebase
// deploy` solo sube functions/, asi que las copiamos a functions/vendor/ (gitignored).
const SOURCES = [
  { src: "ranking.js",   reason: "motor Glicko-2 (fuente unica, la usa la web)" },
  { src: "standings.js", reason: "motor de standings de liga (E7, compartido con la web)" },
];

SOURCES.forEach(function (item) {
  const SRC = path.resolve(__dirname, "..", "..", "assets", item.src);
  if (!fs.existsSync(SRC)) {
    console.error("[vendor] NO encuentro la fuente:", SRC);
    process.exit(1);
  }
  const DEST = path.join(DEST_DIR, item.src);
  const banner =
    "/* GENERADO — NO EDITAR. Copia de assets/" + item.src + " (fuente unica).\n" +
    "   Regenerar: node scripts/vendor-ranking.js  (corre en pretest/predeploy). */\n";
  fs.writeFileSync(DEST, banner + fs.readFileSync(SRC, "utf8"));
  console.log("[vendor] " + item.src + " ->", path.relative(process.cwd(), DEST));
});
