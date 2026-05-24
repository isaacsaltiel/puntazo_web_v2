/* ══════════════════════════════════════════════════════════════
   PUNTAZO — court-svg.js
   Módulo SVG vectorial de cancha de pádel (Etapa 16.3).

   Cancha real: 20m × 10m (proporción 2:1).
   - Línea central (red) perpendicular al lado largo.
   - Líneas de servicio: 6.95m desde la red en cada mitad.
   - Línea central de servicio: divide cada mitad en 2 cuadrantes.
   - 4 cuadrantes de servicio totales (2 por lado).

   Convención de orientación en topDown(): por defecto cancha "vertical"
   (alta), Equipo 1 abajo, Equipo 2 arriba — coincide con el grid 2x2 de
   mi-partido. Si width > height el caller puede pedir landscape:true.

   API:
     window.PuntazoCourtSVG.topDown({
       width: 200,
       height: 300,
       team1Color: "#0B7CFF",
       team2Color: "#c8e835",
       showNet: true,
       glow: null,             // null | "team1" | "team2"
       label: false,
       landscape: false,       // false = portrait, true = landscape
       slotData: false,        // si true, marca <g data-slot data-team>
     })  →  string con <svg>...</svg>

   No depende de nada. Stateless. Devuelve string (más barato que crear
   DOM e insertarlo desde fuera).
══════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  function num(v, def) {
    var n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  /**
   * Genera el SVG en orientación portrait (cancha vertical: ancho 100, alto 200
   * en coords internas; Equipo 2 arriba, Equipo 1 abajo).
   *
   * Coords internas portrait: viewBox 0 0 100 200
   *  - net horizontal en y=100 (centro)
   *  - service lines a y=100 ± 69.5  →  y=30.5 y y=169.5
   *  - vertical central de servicio: x=50 (solo dentro de cada mitad
   *    desde service line hasta la red)
   *  - cuadrantes:
   *      Eq2 izq (slot 2):  x=0..50, y=30.5..100
   *      Eq2 der (slot 3):  x=50..100, y=30.5..100
   *      Eq1 izq (slot 0):  x=0..50, y=100..169.5
   *      Eq1 der (slot 1):  x=50..100, y=100..169.5
   */
  function buildPortrait(opts) {
    var W = num(opts.width, 200);
    var H = num(opts.height, 300);
    var t1 = opts.team1Color || "#0B7CFF";
    var t2 = opts.team2Color || "#c8e835";
    var showNet = opts.showNet !== false;
    var glow = (opts.glow === "team1" || opts.glow === "team2") ? opts.glow : null;
    var label = !!opts.label;
    var slotData = !!opts.slotData;

    // viewBox 100x200 (cancha vertical, mantiene aspect 1:2 real)
    var vbW = 100, vbH = 200;
    var lineColor = "rgba(255,255,255,0.55)";
    var lineW = 1.4;
    var floorColor = "rgba(11, 60, 140, 0.10)"; // sutil, no compite

    // Filtros para glow (sólo cuando glow !== null)
    var filterDef = "";
    var filterAttr = "";
    if (glow === "team1") {
      filterDef = '<filter id="pzCourtGlow1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
      filterAttr = ' filter="url(#pzCourtGlow1)"';
    } else if (glow === "team2") {
      filterDef = '<filter id="pzCourtGlow2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
      filterAttr = ' filter="url(#pzCourtGlow2)"';
    }

    // Cuadrantes (con leve tinte por equipo)
    var quads = [
      // Equipo 2 (arriba)
      { team: "team2", slot: 2, x: 0,  y: 30.5, w: 50, h: 69.5, fill: t2 },
      { team: "team2", slot: 3, x: 50, y: 30.5, w: 50, h: 69.5, fill: t2 },
      // Equipo 1 (abajo)
      { team: "team1", slot: 0, x: 0,  y: 100,  w: 50, h: 69.5, fill: t1 },
      { team: "team1", slot: 1, x: 50, y: 100,  w: 50, h: 69.5, fill: t1 },
    ];

    var quadHtml = quads.map(function (q) {
      // tinte casi imperceptible (opacity 0.10) — el color del equipo se nota
      // sin saturar la cancha. El highlight viene de los slots interactivos
      // sobrepuestos por mi-partido.
      var gOpen = slotData
        ? '<g class="court-quad" data-team="' + q.team + '" data-slot="' + q.slot + '">'
        : '<g class="court-quad">';
      var rect = '<rect x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '" fill="' + q.fill + '" fill-opacity="0.08"/>';
      return gOpen + rect + '</g>';
    }).join("");

    // Líneas de la cancha
    // Outer rectangle 0,0 → 100,200 (paredes implícitas)
    var outer = '<rect x="0.7" y="0.7" width="98.6" height="198.6" fill="' + floorColor + '" stroke="' + lineColor + '" stroke-width="' + lineW + '" rx="1.2" ry="1.2"' + filterAttr + '/>';

    // Líneas de servicio (horizontales) y=30.5 y y=169.5
    var svcLines =
      '<line x1="0.7" y1="30.5" x2="99.3" y2="30.5" stroke="' + lineColor + '" stroke-width="' + lineW + '"' + filterAttr + '/>' +
      '<line x1="0.7" y1="169.5" x2="99.3" y2="169.5" stroke="' + lineColor + '" stroke-width="' + lineW + '"' + filterAttr + '/>';

    // Línea central de servicio (vertical x=50) entre service lines (no
    // atraviesa toda la cancha — sólo desde y=30.5 a y=169.5).
    var centerSvc = '<line x1="50" y1="30.5" x2="50" y2="169.5" stroke="' + lineColor + '" stroke-width="' + lineW + '"' + filterAttr + '/>';

    // Red (línea central horizontal y=100) — discontinua
    var net = showNet
      ? '<line x1="0.7" y1="100" x2="99.3" y2="100" stroke="' + lineColor + '" stroke-width="' + (lineW * 1.2) + '" stroke-dasharray="3 2"' + filterAttr + '/>'
      : '';

    // Labels opcionales E1 / E2 (centrados en cada mitad, muy sutiles)
    var labels = "";
    if (label) {
      labels +=
        '<text x="50" y="20" text-anchor="middle" fill="' + t2 + '" fill-opacity="0.55" font-family="Montserrat,sans-serif" font-size="8" font-weight="800" letter-spacing="1.2">E2</text>' +
        '<text x="50" y="186" text-anchor="middle" fill="' + t1 + '" fill-opacity="0.55" font-family="Montserrat,sans-serif" font-size="8" font-weight="800" letter-spacing="1.2">E1</text>';
    }

    var defs = filterDef ? ('<defs>' + filterDef + '</defs>') : '';

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + vbW + ' ' + vbH + '" ' +
      'width="' + W + '" height="' + H + '" preserveAspectRatio="xMidYMid meet" ' +
      'class="pz-court-svg" aria-hidden="true">' +
        defs +
        quadHtml +
        outer +
        svcLines +
        centerSvc +
        net +
        labels +
      '</svg>'
    );
  }

  /**
   * Genera el SVG en orientación landscape (cancha horizontal: ancho 200, alto 100).
   * Equipo 1 a la izquierda, Equipo 2 a la derecha. Útil para tablero.html en TV.
   *
   * Coords internas landscape: viewBox 0 0 200 100
   *  - net vertical en x=100
   *  - service lines a x=100 ± 69.5  →  x=30.5 y x=169.5
   *  - línea central de servicio horizontal y=50 entre service lines
   */
  function buildLandscape(opts) {
    var W = num(opts.width, 400);
    var H = num(opts.height, 200);
    var t1 = opts.team1Color || "#0B7CFF";
    var t2 = opts.team2Color || "#c8e835";
    var showNet = opts.showNet !== false;
    var glow = (opts.glow === "team1" || opts.glow === "team2") ? opts.glow : null;
    var label = !!opts.label;
    var slotData = !!opts.slotData;

    var vbW = 200, vbH = 100;
    var lineColor = "rgba(255,255,255,0.55)";
    var lineW = 1.4;
    var floorColor = "rgba(11, 60, 140, 0.10)";

    var filterDef = "";
    var filterAttr = "";
    if (glow === "team1") {
      filterDef = '<filter id="pzCourtGlowL1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
      filterAttr = ' filter="url(#pzCourtGlowL1)"';
    } else if (glow === "team2") {
      filterDef = '<filter id="pzCourtGlowL2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
      filterAttr = ' filter="url(#pzCourtGlowL2)"';
    }

    var quads = [
      // Equipo 1 (izquierda): slots 0 y 1
      { team: "team1", slot: 0, x: 30.5, y: 0,  w: 69.5, h: 50, fill: t1 },
      { team: "team1", slot: 1, x: 30.5, y: 50, w: 69.5, h: 50, fill: t1 },
      // Equipo 2 (derecha): slots 2 y 3
      { team: "team2", slot: 2, x: 100,  y: 0,  w: 69.5, h: 50, fill: t2 },
      { team: "team2", slot: 3, x: 100,  y: 50, w: 69.5, h: 50, fill: t2 },
    ];

    var quadHtml = quads.map(function (q) {
      var gOpen = slotData
        ? '<g class="court-quad" data-team="' + q.team + '" data-slot="' + q.slot + '">'
        : '<g class="court-quad">';
      var rect = '<rect x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '" fill="' + q.fill + '" fill-opacity="0.08"/>';
      return gOpen + rect + '</g>';
    }).join("");

    var outer = '<rect x="0.7" y="0.7" width="198.6" height="98.6" fill="' + floorColor + '" stroke="' + lineColor + '" stroke-width="' + lineW + '" rx="1.2" ry="1.2"' + filterAttr + '/>';
    var svcLines =
      '<line x1="30.5" y1="0.7" x2="30.5" y2="99.3" stroke="' + lineColor + '" stroke-width="' + lineW + '"' + filterAttr + '/>' +
      '<line x1="169.5" y1="0.7" x2="169.5" y2="99.3" stroke="' + lineColor + '" stroke-width="' + lineW + '"' + filterAttr + '/>';
    var centerSvc = '<line x1="30.5" y1="50" x2="169.5" y2="50" stroke="' + lineColor + '" stroke-width="' + lineW + '"' + filterAttr + '/>';
    var net = showNet
      ? '<line x1="100" y1="0.7" x2="100" y2="99.3" stroke="' + lineColor + '" stroke-width="' + (lineW * 1.2) + '" stroke-dasharray="3 2"' + filterAttr + '/>'
      : '';
    var labels = "";
    if (label) {
      labels +=
        '<text x="15" y="55" text-anchor="middle" fill="' + t1 + '" fill-opacity="0.55" font-family="Montserrat,sans-serif" font-size="8" font-weight="800" letter-spacing="1.2">E1</text>' +
        '<text x="185" y="55" text-anchor="middle" fill="' + t2 + '" fill-opacity="0.55" font-family="Montserrat,sans-serif" font-size="8" font-weight="800" letter-spacing="1.2">E2</text>';
    }
    var defs = filterDef ? ('<defs>' + filterDef + '</defs>') : '';

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + vbW + ' ' + vbH + '" ' +
      'width="' + W + '" height="' + H + '" preserveAspectRatio="xMidYMid meet" ' +
      'class="pz-court-svg" aria-hidden="true">' +
        defs +
        quadHtml +
        outer +
        svcLines +
        centerSvc +
        net +
        labels +
      '</svg>'
    );
  }

  function topDown(opts) {
    opts = opts || {};
    if (opts.landscape) return buildLandscape(opts);
    return buildPortrait(opts);
  }

  global.PuntazoCourtSVG = {
    topDown: topDown,
    /* aliases por si el caller prefiere semántica explícita */
    portrait: function (opts) { opts = opts || {}; opts.landscape = false; return buildPortrait(opts); },
    landscape: function (opts) { opts = opts || {}; opts.landscape = true; return buildLandscape(opts); },
  };
})(window);
