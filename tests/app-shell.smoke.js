/* ══════════════════════════════════════════════════════════════
   Smoke test del shell de app (rediseño responsive 2026-09-28).
   Requiere: el sitio servido en BASE (p. ej. `python -m http.server 8790`
   desde la raíz del repo) y Playwright para Node (`npm i playwright`).
     node tests/app-shell.smoke.js [BASE]
   Usa Edge si está instalado (channel msedge), si no el Chromium de Playwright.
══════════════════════════════════════════════════════════════ */
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:8790";
const VIEWPORTS = [
  { w: 390, h: 844 }, { w: 430, h: 932 }, { w: 768, h: 1024 }, { w: 1440, h: 900 },
];

let fails = 0, passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; console.log("  ✓ " + msg); }
  else { fails++; console.log("  ✗ " + msg); }
}

async function newPage(browser, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, isMobile: vp.w < 768, hasTouch: vp.w < 768,
  });
  await ctx.addInitScript(() => { try { sessionStorage.setItem("pz_intro_seen", "1"); } catch (e) {} });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(e.message));
  return page;
}
async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1800);
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch());

  // ── Flujo principal en móvil ──
  console.log("\nFlujo principal (390x844)");
  let p = await newPage(browser, VIEWPORTS[0]);

  // (2026-10-13) Socio de Isaac: portada informativa SIEMPRE → zona de puntos
  // (club → cancha → Clips en horizontal). El scroll vertical va aparte.
  await go(p, "/");
  await p.evaluate(() => localStorage.setItem("firebase:authUser:prueba:[DEFAULT]", "{}"));
  await go(p, "/");
  ok(new URL(p.url()).pathname === "/" && (await p.isVisible("a[href*='entrada.html?modo=clips']")), "1. Portada informativa siempre (también con sesión)");
  await p.evaluate(() => localStorage.removeItem("firebase:authUser:prueba:[DEFAULT]"));
  await p.click("a[href*='entrada.html?modo=clips']:visible");
  await p.waitForURL(/entrada\.html\?modo=clips/, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1800);
  ok((await p.textContent("#selTitle")).includes("¿Dónde jugaste?"), "   «Encuentra tus clips» → selector de club");
  ok(await p.evaluate(() => getComputedStyle(document.querySelector("[data-ctx-chip]")).visibility === "hidden"), "   El header no repite «Elige tu club»");
  ok(!(await p.evaluate(() => document.body.innerText.includes("escapó"))), "   Sin «¿Se te escapó un puntazo?» en el selector de club");
  await p.click(".sel-card:has-text('BreakPoint')");
  await p.waitForURL(/loc=BreakPoint/, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1800);
  ok(/entrada\.html\?modo=clips/.test(p.url()) && (await p.textContent("#selTitle")).includes("cancha"), "2. Club → sus canchas (sin pasar por el Inicio del club)");
  ok((await p.$$(".sel-card--cancha img.court-icon")).length > 0, "   Selector de cancha con íconos");
  await p.click(".sel-card:has-text('Cancha 2')");
  await p.waitForURL(/(lado|feed)\.html/, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(5000);
  ok(/lado\.html\?loc=BreakPoint&can=Cancha2/.test(p.url()), "3. Elegir cancha → Clips abre en HORIZONTAL (vertical es opción)");
  ok(await p.isVisible("#pzVista"), "   Opción de ver en vertical (cancha con verticales)");
  ok(!(await p.isVisible("#filtro-dia .dia-chip")), "   Filtros plegados de inicio (primer clip a la vista)");
  await p.click("#pzFiltroBtn");
  ok(await p.isVisible("#filtro-dia .dia-chip"), "   Botón de filtros despliega Todos/Hoy/Ayer/Fecha");
  await p.click("#pzFiltroBtn");
  ok(!(await p.isVisible(".pz-rb")), "   Sin barra Actualizado/Actualizar");
  ok((await p.textContent("[data-ctx-chip]")).includes("Cancha 2"), "   Chip de Clips muestra club · cancha");

  await p.click("[data-ctx-chip]");
  await p.waitForSelector(".pz-sheet.is-open .pz-court-btn img.pz-court-ico", { timeout: 5000 });
  ok(true, "   Hoja de canchas con íconos");
  await p.click(".pz-sheet.is-open .pz-court-btn:has-text('Cancha 3')");
  await p.waitForURL(/can=Cancha3/, { timeout: 10000 }).catch(() => {});
  ok(/lado\.html\?loc=BreakPoint&can=Cancha3/.test(p.url()), "4. Cambiar cancha desde el chip → Clips de Cancha 3");

  ok((await p.getAttribute(".pz-tab[data-tab=inicio]", "href")) === "/", "5. Barra: Inicio = portada informativa");
  ok(await p.isVisible(".pz-tab[data-tab=scroll]") && !(await p.isVisible(".pz-tab[data-tab=recuperar]")), "   Club con verticales: pestaña Scroll (Recuperar va al menú)");
  for (const [tab, re] of [["scroll", /feed\.html\?loc=BreakPoint/], ["puntazo", /boton\.html/], ["guardados", /guardados\.html/], ["clips", /lado\.html\?loc=BreakPoint&can=Cancha3/]]) {
    await p.click(`.pz-tab[data-tab=${tab}]`);
    await p.waitForURL(re, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(1500);
    ok(re.test(p.url()) && (await p.getAttribute(`.pz-tab[data-tab=${tab}]`, "class")).includes("is-active"),
      `6. Barra inferior → ${tab} (activa)`);
  }
  await p.click("[data-acct-open]");
  await p.waitForTimeout(500);
  ok(await p.isVisible(".pz-sheet.is-open [data-acct-login]"), "   Menú de cuenta (invitado) ofrece iniciar sesión");
  ok(await p.isVisible(".pz-sheet.is-open a[href*='recuperar.html']"), "   Menú de cuenta trae «Recuperar un clip»");
  await go(p, "/recuperar.html");
  await p.waitForTimeout(2500);
  ok(await p.isVisible("#recForm") || await p.isVisible("#recLogin, .rec-login, [data-rec-login]") || !(await p.isVisible("#recSelector")), "7. Recuperar usa la cancha de hoy (no vuelve a preguntar)");
  await go(p, "/boton.html");
  ok(/boton\.html\?loc=BreakPoint&can=Cancha3/.test(p.url()), "8. Botón sin parámetros → usa la cancha global");
  ok(await p.isVisible("#bigBtn"), "   Botón grande visible");
  await go(p, "/inicio.html?loc=BreakPoint");
  ok(/entrada\.html\?modo=clips&loc=BreakPoint|lado\.html/.test(p.url()), "9. Enlace viejo a inicio.html → zona de puntos del club");
  // Día siguiente: la cancha caduca, el club se queda.
  await p.evaluate(() => { const o = JSON.parse(localStorage.getItem("pz_ctx_v1")); o.canTs = Date.now() - 864e5 * 1.2; localStorage.setItem("pz_ctx_v1", JSON.stringify(o)); });
  await go(p, "/entrada.html?modo=clips");
  ok(/entrada\.html\?modo=clips&loc=BreakPoint/.test(p.url()), "10. Al día siguiente «Encuentra tus clips» va directo a las canchas del club guardado");
  ok(/entrada\.html\?modo=clips&loc=BreakPoint/.test(await p.getAttribute(".pz-tab[data-tab=clips]", "href")), "    …y Clips vuelve a pedir la cancha");
  ok(/modo=boton&loc=BreakPoint/.test(await p.getAttribute(".pz-tab[data-tab=puntazo]", "href")), "    …y Puntazo también");
  await p.click("[data-ctx-chip]");
  await p.waitForSelector(".pz-sheet.is-open .pz-club-row", { timeout: 5000 });
  await p.click(".pz-sheet.is-open .pz-club-row:has-text('Interpadel')");
  await p.waitForURL(/loc=Interpadel/, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(2500);
  ok(/entrada\.html\?modo=clips&loc=Interpadel/.test(p.url()), "11. Cambiar de club desde el chip → canchas del nuevo club");
  ok(!(await p.isVisible(".pz-tab[data-tab=scroll]")) && await p.isVisible(".pz-tab[data-tab=recuperar]"), "    Club sin verticales: sin Scroll, Recuperar en la barra");
  await go(p, "/recuperar.html");
  await p.waitForTimeout(2500);
  ok(!(await p.isVisible("#recForm")), "    Recuperar sin cancha de hoy → pide la cancha (o sesión)");
  ok(p.__errors.length === 0, "   Sin errores JS en el flujo" + (p.__errors.length ? ": " + p.__errors.join(" | ") : ""));
  await p.context().close();

  // ── URLs existentes ──
  console.log("\nURLs existentes");
  p = await newPage(browser, VIEWPORTS[0]);
  await go(p, "/entrada.html?loc=Interpadel&can=Cancha4&lado=LadoA");
  ok(/lado\.html\?loc=Interpadel&can=Cancha4/.test(p.url()), "QR de cancha (entrada?loc&can&lado) → Clips de esa cancha, sin selección");
  ok(/lado\.html\?loc=Interpadel&can=Cancha4/.test(await p.getAttribute(".pz-tab[data-tab=clips]", "href")), "   …y la cancha del QR queda como la de hoy");
  await go(p, "/lado.html?loc=BreakPoint&can=Cancha1&lado=LadoA");
  await p.waitForTimeout(3000);
  ok(/lado\.html/.test(p.url()) && (await p.textContent("[data-ctx-chip]")).includes("Cancha 1"), "QR viejo a lado.html sigue funcionando (en horizontal) y fija el contexto");
  await go(p, "/boton.html?loc=BreakPoint&can=Cancha2");
  ok(/boton\.html\?loc=BreakPoint&can=Cancha2/.test(p.url()), "boton.html?loc&can sigue funcionando");
  await go(p, "/cancha.html?loc=BreakPoint&can=Cancha2");
  ok(/(lado|feed)\.html/.test(p.url()), "cancha.html (legacy) sigue redirigiendo a clips");
  await go(p, "/entrada.html?qr=INTERPADEL");
  ok(/entrada\.html/.test(p.url()) && (await p.textContent("#selTitle")).includes("cancha"), "entrada.html?qr=CLUB → canchas del club (zona de puntos)");
  await go(p, "/entrada.html?modo=boton");
  ok(/entrada\.html\?modo=boton/.test(p.url()), "entrada.html?modo=boton sigue mostrando el selector");
  await p.context().close();

  // ── Responsive ──
  console.log("\nResponsive (sin scroll horizontal + forma de la navegación)");
  const PAGES = ["/", "/feed.html?loc=BreakPoint", "/entrada.html", "/lado.html?loc=BreakPoint&can=Cancha2&lado=LadoA",
    "/boton.html?loc=BreakPoint&can=Cancha2", "/guardados.html", "/recuperar.html?loc=BreakPoint&can=Cancha2", "/herramientas.html", "/vivo.html?club=BreakPoint"];
  for (const vp of VIEWPORTS) {
    p = await newPage(browser, vp);
    const bad = [];
    for (const path of PAGES) { await go(p, path); if (!(await noHScroll(p))) bad.push(path); }
    ok(!bad.length, `${vp.w}x${vp.h}: sin scroll horizontal` + (bad.length ? " → " + bad.join(", ") : ""));
    await go(p, "/lado.html?loc=BreakPoint&can=Cancha2&lado=LadoA");
    const bar = await p.evaluate(() => { const r = document.querySelector(".pz-tabbar").getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, bottom: r.bottom }; });
    if (vp.w >= 1024) ok(bar.w < 300 && bar.h > 500, `${vp.w}x${vp.h}: navegación como barra lateral`);
    else ok(Math.abs(bar.bottom - vp.h) < 2 && bar.w === vp.w, `${vp.w}x${vp.h}: navegación como barra inferior`);
    await p.context().close();
  }

  await browser.close();
  console.log(`\n${passes} OK, ${fails} fallas`);
  process.exit(fails ? 1 : 0);
})();
