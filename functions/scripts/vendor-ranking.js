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

const SRC = path.resolve(__dirname, "..", "..", "assets", "ranking.js");
const DEST_DIR = path.resolve(__dirname, "..", "vendor");
const DEST = path.join(DEST_DIR, "ranking.js");

if (!fs.existsSync(SRC)) {
  console.error("[vendor] NO encuentro la fuente:", SRC);
  process.exit(1);
}
fs.mkdirSync(DEST_DIR, { recursive: true });
const banner =
  "/* GENERADO — NO EDITAR. Copia de assets/ranking.js (fuente unica).\n" +
  "   Regenerar: node scripts/vendor-ranking.js  (corre en pretest/predeploy). */\n";
fs.writeFileSync(DEST, banner + fs.readFileSync(SRC, "utf8"));
console.log("[vendor] ranking.js ->", path.relative(process.cwd(), DEST));
