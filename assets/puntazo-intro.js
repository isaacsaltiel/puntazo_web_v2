/**
 * puntazo-intro-vertical.js  –  Formato 9:16 (1080x1920)
 * Reels, Stories, TikTok, pantalla vertical  –  Animación de intro para puntazoclips.com
 *
 * USO OVERLAY  (tapa la página, desaparece a los 6s):
 *   PuntazoIntro.overlay({ onDone: () => console.log('listo') });
 *
 * USO HERO  (fondo de sección, loop):
 *   PuntazoIntro.hero('#mi-canvas', { loop: true });
 */
(function (global) {
  'use strict';

  // ── Coordenadas lógicas (igual que el render Python) ──────────────────
  const LW = 1080, LH = 1920;
  const BALL_R = 52, GROUND_Y = LH * 0.80;
  const SQUISH_Z = BALL_R * 2, G = 2400, COR = 0.76;

  const LOGO_S = 0.85, LCX = LW / 2, LCY = Math.floor(LH * 0.445);
  const P_CX = 491, P_CY = 526.5;
  const L_LEFT  = 305 * LOGO_S + (LCX - P_CX * LOGO_S);
  const L_RIGHT = 677 * LOGO_S + (LCX - P_CX * LOGO_S);
  const L_TOP   = 294 * LOGO_S + (LCY - P_CY * LOGO_S);
  const L_BOT   = 759 * LOGO_S + (LCY - P_CY * LOGO_S);

  const SEP_Y = L_BOT + 80, NAME_Y = SEP_Y + 62, HDL_Y = NAME_Y + 56;

  const B1_ENTER = 1.2, B1_EXIT = 4.4;
  const B2_ENTER = 1.5, B2_EXIT = 4.8;
  const B3_START = 3.0, B3_IMPACT = 4.15;
  const CAM_DUR  = 0.95;
  const GLEAM_S  = B3_IMPACT + CAM_DUR + 0.25;
  const GLEAM_D  = 0.70;
  const SHIMMER_T = GLEAM_S + GLEAM_D + 0.55;
  const FADE_OUT_S = 5.5, TOTAL = 6.2;

  // ── Easing ──────────────────────────────────────────────────────────────
  const eoc = t => { t = clamp(t); return 1 - (1-t)**3; };
  const eoi = t => { t = clamp(t); return 1 - (1-t)**5; };
  const prg = (t,s,e) => clamp((t-s)/(e-s));
  const clamp = t => Math.max(0, Math.min(1, t));
  const lerp  = (a,b,t) => a + (b-a)*t;

  // ── SVG paths del logo (extraídos con potrace del logo real) ─────────────
  const P_D = 'M 608 299 C 641 308,663 325,672 347 C 676 358,677 362,677 386 C 677 409,676 418,670 444 C 663 480,655 505,644 528 C 629 558,601 581,568 590 C 547 595,541 596,492 598 C 469 599,449 600,448 601 C 447 602,438 638,429 680 C 420 722,412 757,411 758 C 410 760,307 761,305 758 C 304 757,304 759,337 612 C 349 555,370 461,383 403 C 396 345,407 297,407 296 C 408 294,443 294,502 295 C 583 295,597 296,608 299 Z';
  const T_D = 'M 493 370 C 488 375,487 380,477 430 C 466 485,466 490,472 495 C 479 501,485 500,536 480 C 585 462,587 461,591 454 C 597 441,594 438,549 400 C 520 376,506 366,503 366 C 500 366,496 368,493 370 Z';

  // ── Simulación física ───────────────────────────────────────────────────
  function simulate(enter, exit, x0, y0, vx, vy0) {
    const SIM = 600, dt = 1/SIM, dur = exit - enter;
    const traj = [], bounces = [];
    let x = x0, y = y0, vy = vy0, tr = 0;

    while (tr <= dur + dt) {
      const dist = Math.max(0, GROUND_Y - y);
      const sq   = Math.max(0, 1 - dist / SQUISH_Z);
      traj.push([tr, x, y, sq]);
      tr += dt; x += vx*dt; y += vy*dt; vy += G*dt;
      if (y >= GROUND_Y && vy > 0) {
        y = GROUND_Y; vy = -vy * COR;
        bounces.push([enter + tr, x]);
      }
    }

    function get(tabs) {
      const tr2 = tabs - enter;
      if (tr2 < 0 || tr2 > dur + 0.01) return null;
      const fi = tr2 * SIM, i = fi | 0, f = fi - i;
      if (i >= traj.length - 1) { const r = traj[traj.length-1]; return [r[1],r[2],r[3]]; }
      const [,x0_,y0_,sq0] = traj[i], [,x1,y1,sq1] = traj[i+1];
      return [x0_+(x1-x0_)*f, y0_+(y1-y0_)*f, sq0+(sq1-sq0)*f];
    }

    return { get, bounces };
  }

  // ── Rotaciones 3D ────────────────────────────────────────────────────────
  function ry3d(x,y,z,a) { return [x*Math.cos(a)+z*Math.sin(a), y, -x*Math.sin(a)+z*Math.cos(a)]; }
  function rx3d(x,y,z,a) { return [x, y*Math.cos(a)-z*Math.sin(a), y*Math.sin(a)+z*Math.cos(a)]; }
  function rz3d(x,y,z,a) { return [x*Math.cos(a)-y*Math.sin(a), x*Math.sin(a)+y*Math.cos(a), z]; }

  // ── Costuras 3D ──────────────────────────────────────────────────────────
  function drawSeams(ctx, r, rotZ, tiltX, tiltY) {
    const A = 0.52, N = 80;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.46)';
    ctx.lineWidth = Math.max(2, r * 0.055);
    ctx.lineCap = 'round';

    for (let s = 0; s < 2; s++) {
      const off = s * Math.PI;
      let open = false;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const lam = 2*Math.PI*i/N + off;
        const phi = Math.PI/2 + A*Math.sin(2*lam);
        let [x,y,z] = [Math.sin(phi)*Math.cos(lam), Math.cos(phi), Math.sin(phi)*Math.sin(lam)];
        [x,y,z] = ry3d(x,y,z,tiltY);
        [x,y,z] = rx3d(x,y,z,tiltX);
        [x,y,z] = rz3d(x,y,z,rotZ);
        const sx = x*r, sy = -y*r;
        if (z >= -0.05) {
          if (!open) { ctx.moveTo(sx,sy); open=true; } else ctx.lineTo(sx,sy);
        } else {
          if (open) { ctx.stroke(); ctx.beginPath(); open=false; }
        }
      }
      if (open) ctx.stroke();
    }
    ctx.restore();
  }

  // ── Perspectiva diagonal ─────────────────────────────────────────────────
  function perspB1(bx, by) {
    const nt = (bx + BALL_R) / (LW + 2*BALL_R);
    return [by + lerp(-60,25,nt), lerp(0.84,1.0,nt)];
  }
  function perspB2(bx, by) {
    const nt = (LW + BALL_R - bx) / (LW + 2*BALL_R);
    return [by + lerp(-60,25,nt), lerp(0.84,1.0,nt)];
  }

  // ── Dibujo de bola ────────────────────────────────────────────────────────
  function drawBall(ctx, getFn, t, vx, perspFn, alpha, ghost) {
    const d = getFn(t);
    if (!d || alpha <= 0) return;
    let [bx, by, sq] = d;
    if (ghost) sq = 0;

    const [byP, sc] = perspFn(bx, by);
    const er = BALL_R * sc;
    const ry = er * (1 - 0.20*sq), rx = er * (1 + 0.15*sq);
    const [gp] = perspFn(bx, GROUND_Y);
    const byD = Math.min(byP, gp - ry);

    if (ghost) {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle = '#cce819';
      ctx.beginPath(); ctx.arc(bx, byP, er, 0, Math.PI*2); ctx.fill();
      ctx.restore(); return;
    }

    // Sombra dinámica
    const distG = Math.max(0, gp - byP);
    const shSc  = Math.max(0.2, 1 - distG / (GROUND_Y*0.55));
    ctx.save(); ctx.globalAlpha = (0.07 + 0.22*sq) * alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(bx, gp, rx*1.2*shSc, 5*shSc, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // Bola
    const distRolled = vx > 0 ? bx - (-BALL_R) : LW+BALL_R - bx;
    const rotZ = (distRolled / BALL_R) * (vx > 0 ? 1 : -1);
    const tiltY = vx > 0 ? 0.40 : -0.40;
    const dN = getFn(t + 0.02);
    const tiltX = dN ? Math.max(-0.35, Math.min(0.35, -(dN[1]-by)/0.02/6000)) : 0;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(bx, byD);
    ctx.scale(rx/er, ry/er);
    // Relleno amarillo
    ctx.fillStyle = '#cce819'; ctx.beginPath(); ctx.arc(0,0,er,0,Math.PI*2); ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.19)';
    ctx.beginPath(); ctx.arc(-er*0.28,-er*0.30,er*0.40,0,Math.PI*2); ctx.fill();
    // Costuras 3D
    drawSeams(ctx, er, rotZ, tiltX, tiltY);
    ctx.restore();
  }

  function drawTrail(ctx, getFn, t, vx, perspFn) {
    const d = getFn(t);
    const sq = d ? d[2] : 0;
    const fade = Math.max(0, 1 - 3*sq);
    [[0.085,0.10],[0.055,0.21],[0.028,0.37]].forEach(([lag,a]) => {
      drawBall(ctx, getFn, t-lag, vx, perspFn, a*fade, true);
    });
  }

  // ── Rings de impacto ──────────────────────────────────────────────────────
  function drawRing(ctx, t, bt, bx, byG, big) {
    const dt = t - bt;
    if (dt < 0 || dt > 0.55) return;
    const p = dt/0.55, rxR = 12 + (big?220:170)*eoc(p);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 0.60*(1-p/0.88));
    ctx.strokeStyle = '#cce819';
    ctx.lineWidth = Math.max(0.4, 3*(1-p));
    ctx.beginPath(); ctx.ellipse(bx, byG, rxR, rxR*0.18, 0, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // ── Partículas ────────────────────────────────────────────────────────────
  function drawParticles(ctx, t, bt, bx, byG) {
    const dt = t - bt;
    if (dt < 0 || dt > 0.48) return;
    ctx.save();
    ctx.fillStyle = '#cce819';
    for (let i = 0; i < 14; i++) {
      const ang = i*2*Math.PI/14 - Math.PI*0.65;
      if (Math.sin(ang) > 0.12) continue;
      const spd = 370 + 190*(i%4);
      const px = bx + spd*Math.cos(ang)*dt;
      const py = byG + spd*Math.sin(ang)*dt + 0.5*900*dt*dt;
      const a  = Math.max(0, 0.88*(1-dt/0.40));
      const r  = Math.max(0.8, 5.8*(1-dt/0.40));
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // ── Ball 3 (hacia la cámara) ───────────────────────────────────────────
  const VP_X = LW/2+30, VP_Y = LH*0.22, CAM_Y = LH*0.44;
  function drawBall3(ctx, t) {
    if (t < B3_START || t > B3_IMPACT) return;
    const nt = (t - B3_START) / (B3_IMPACT - B3_START);
    const r  = 7 * Math.exp(nt * 3.8);
    const cx = VP_X + 55*nt;
    const cy = VP_Y + (CAM_Y - VP_Y)*nt - 30*Math.sin(Math.PI*nt*0.75);
    const sq = Math.max(0, Math.exp(-((nt-0.55)**2)/0.004)*0.5);
    const ry = r*(1-0.18*sq), rx2 = r*(1+0.12*sq);
    const rotY = nt * 2.5 * Math.PI;

    ctx.save();
    // Sombra
    ctx.globalAlpha = 0.04 + 0.22*nt;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cx, GROUND_Y, rx2*1.1*(0.15+0.85*nt), 5*(0.15+0.85*nt), 0, 0, Math.PI*2); ctx.fill();
    // Bola
    ctx.globalAlpha = 1;
    ctx.translate(cx, cy); ctx.scale(rx2/r, ry/r);
    ctx.fillStyle = '#cce819'; ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.arc(-r*0.28,-r*0.30,r*0.40,0,Math.PI*2); ctx.fill();
    drawSeams(ctx, r, rotY, -0.5*nt, 0.2);
    ctx.restore();
  }

  // ── Fondo ─────────────────────────────────────────────────────────────────
  function drawBg(ctx, alpha) {
    const g = ctx.createRadialGradient(LW/2,LH/2,0, LW/2,LH/2,1200);
    [[0,'rgb(18,33,76)'],[0.14,'rgb(17,31,73)'],[0.28,'rgb(15,28,68)'],
     [0.42,'rgb(13,25,62)'],[0.57,'rgb(11,22,56)'],[0.71,'rgb(9,18,48)'],
     [0.85,'rgb(7,15,40)'],[1,'rgb(6,12,32)']].forEach(([o,c]) => g.addColorStop(o,c));
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = g;
    ctx.fillRect(0,0,LW,LH); ctx.restore();
  }

  // ── Logo ──────────────────────────────────────────────────────────────────
  const LOGO_PATH = new Path2D(P_D + ' ' + T_D);

  function drawLogo(ctx, t, foScale) {
    const lp = eoi(prg(t,0.55,1.55));
    if (lp <= 0) return;
    const si = 0.97 + 0.03*lp;
    const pulse = t > 3 ? 1 + 0.018*Math.sin(2*Math.PI*(t-3)/4.8) : 1;
    const s = LOGO_S * si * pulse * foScale;

    ctx.save();
    ctx.globalAlpha = lp * foScale;
    // Glow
    const glowA = Math.min(1, prg(t,0.8,1.8)) * 0.07 * foScale;
    if (glowA > 0) {
      ctx.save(); ctx.globalAlpha = glowA;
      ctx.fillStyle = '#2244aa';
      ctx.beginPath(); ctx.ellipse(LCX,LCY, 240,260, 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
    // P shape (evenodd via fill rule)
    ctx.translate(LCX, LCY); ctx.scale(s, s); ctx.translate(-P_CX, -P_CY);
    ctx.fillStyle = 'white';
    ctx.fill(LOGO_PATH, 'evenodd');
    ctx.restore();
  }

  // ── Gleam ─────────────────────────────────────────────────────────────────
  function drawGleam(ctx, t, foScale) {
    const gdt = t - GLEAM_S;
    if (gdt <= 0 || gdt >= GLEAM_D) return;
    const gp = gdt/GLEAM_D;
    const xc = L_LEFT + (L_RIGHT-L_LEFT+200)*eoi(gp) - 70;
    const ga = Math.sin(Math.PI*gp) * 0.24 * foScale;
    const lh = L_BOT - L_TOP + 200;
    ctx.save();
    ctx.globalAlpha = ga;
    ctx.beginPath();
    ctx.rect(L_LEFT, L_TOP-10, L_RIGHT-L_LEFT, L_BOT-L_TOP+20);
    ctx.clip();
    ctx.save();
    ctx.translate(xc - 60, L_TOP - 80);
    ctx.transform(1,0,-Math.tan(20*Math.PI/180),1,0,0); // skewX(-20)
    ctx.fillStyle = 'white';
    ctx.fillRect(0,0,95,lh+160);
    ctx.restore();
    ctx.restore();
  }

  // ── Texto ─────────────────────────────────────────────────────────────────
  function drawText(ctx, t, TBC, foScale) {
    const dtt = t - TBC;
    if (dtt <= 0) return;
    const nmP = clamp(dtt/0.20);
    const nmA = eoc(nmP) * foScale;
    const nmSc = 1.26 - 0.26*eoc(nmP);
    if (nmA > 0) {
      // Sep line
      const sp = eoc(clamp(dtt/0.30));
      ctx.save(); ctx.globalAlpha = sp*0.24*foScale;
      ctx.strokeStyle='white'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(LW/2-160*sp,SEP_Y); ctx.lineTo(LW/2+160*sp,SEP_Y); ctx.stroke();
      ctx.restore();
      // PUNTAZO stamp
      ctx.save();
      ctx.globalAlpha = nmA;
      ctx.translate(LW/2, NAME_Y); ctx.scale(nmSc,nmSc); ctx.translate(-LW/2,-NAME_Y);
      ctx.fillStyle = 'white';
      ctx.font = '700 52px Montserrat, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.letterSpacing = '14px';
      ctx.fillText('PUNTAZO', LW/2, NAME_Y);
      ctx.restore();
    }
    // Handle
    const hdlA = eoc(prg(t, TBC+0.30, TBC+0.90)) * 0.52 * foScale;
    const dtSh = t - SHIMMER_T;
    const hdlFinal = (dtSh > 0 && dtSh < 1) ? Math.min(1, hdlA + Math.sin(Math.PI*dtSh)*0.22) : hdlA;
    if (hdlFinal > 0) {
      ctx.save(); ctx.globalAlpha = hdlFinal;
      ctx.fillStyle = 'white';
      ctx.font = '300 30px Montserrat, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.letterSpacing = '5px';
      ctx.fillText('@puntazoclips', LW/2, HDL_Y);
      ctx.restore();
    }
  }

  // ── Camera shake transform ─────────────────────────────────────────────
  function applyCameraShake(ctx, t) {
    const dt = t - B3_IMPACT;
    if (dt < 0 || dt > CAM_DUR) return false;
    const amp = 32 * Math.exp(-dt*7);
    const sx = amp * Math.sin(dt*44), sy = amp * Math.sin(dt*37+0.9);
    const rot = 3.2 * Math.exp(-dt*6) * Math.sin(dt*30) * Math.PI/180;
    const sc = 1 - 0.038 * Math.max(0, (0.14-dt)/0.14);
    ctx.translate(LW/2+sx, LH/2+sy);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    ctx.translate(-LW/2, -LH/2);
    return true;
  }

  // ── Render principal ────────────────────────────────────────────────────
  function renderFrame(ctx, t, b1, b2, TBC) {
    const foScale = 1 - eoc(prg(t, FADE_OUT_S, TOTAL));
    ctx.clearRect(0, 0, LW, LH);

    drawBg(ctx, eoc(prg(t,0,0.8)) * foScale);

    const shook = t > B3_IMPACT && t < B3_IMPACT + CAM_DUR;
    ctx.save();
    if (shook) applyCameraShake(ctx, t);

    // Rings + particles (todas las bolas)
    [...b1.bounces, ...b2.bounces].forEach(([bt, bx]) => {
      const byG1 = perspB1(bx, GROUND_Y)[0];
      const byG2 = perspB2(bx, GROUND_Y)[0];
      const big = Math.abs(bx - LW/2) < 150;
      // Use correct perspective based on which ball
      const isBall2 = b2.bounces.some(b => b[0]===bt && b[1]===bx);
      drawRing(ctx, t, bt, bx, isBall2 ? byG2 : byG1, big);
      drawParticles(ctx, t, bt, bx, isBall2 ? byG2 : byG1);
    });

    // Ball 1: detrás del logo
    drawTrail(ctx, b1.get, t, (LW+2*BALL_R)/(B1_EXIT-B1_ENTER), perspB1);
    drawBall(ctx, b1.get, t, (LW+2*BALL_R)/(B1_EXIT-B1_ENTER), perspB1, 1, false);

    drawLogo(ctx, t, foScale);
    drawGleam(ctx, t, foScale);

    // Ball 2: delante del logo
    drawTrail(ctx, b2.get, t, -(LW+2*BALL_R)/(B2_EXIT-B2_ENTER), perspB2);
    drawBall(ctx, b2.get, t, -(LW+2*BALL_R)/(B2_EXIT-B2_ENTER), perspB2, 1, false);

    // Ball 3: cámara
    drawBall3(ctx, t);

    drawText(ctx, t, TBC, foScale);

    ctx.restore();

    // Flash de impacto
    if (t >= B3_IMPACT && t < B3_IMPACT + 0.10) {
      const a = 0.55 * (1 - (t-B3_IMPACT)/0.10);
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle='#cce819';
      ctx.fillRect(0,0,LW,LH); ctx.restore();
    }
  }

  // ── Clase principal ─────────────────────────────────────────────────────
  class Intro {
    constructor(canvas, opts = {}) {
      this.canvas  = canvas;
      this.ctx     = canvas.getContext('2d');
      this.opts    = Object.assign({ loop:false, onDone:null, speed:1 }, opts);
      this.speed   = (typeof this.opts.speed === 'number' && this.opts.speed > 0) ? this.opts.speed : 1;
      this.started = false;
      this._resize();

      const b1vx =  (LW+2*BALL_R)/(B1_EXIT-B1_ENTER);
      const b2vx = -(LW+2*BALL_R)/(B2_EXIT-B2_ENTER);
      this.b1 = simulate(B1_ENTER, B1_EXIT, -BALL_R, GROUND_Y, b1vx, -1000);
      this.b2 = simulate(B2_ENTER, B2_EXIT, LW+BALL_R, GROUND_Y, b2vx, -1250);
      this.TBC = this.b1.bounces.reduce((best,b) =>
        Math.abs(b[1]-LW/2) < Math.abs(best[1]-LW/2) ? b : best
      )[0];

      window.addEventListener('resize', () => this._resize());
    }

    _resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width  = r.width  * dpr;
      this.canvas.height = r.height * dpr;
      const sc = Math.min(this.canvas.width/LW, this.canvas.height/LH);
      this.sc = sc;
      this.ox = (this.canvas.width  - LW*sc) / 2;
      this.oy = (this.canvas.height - LH*sc) / 2;
    }

    start() {
      this._t0 = performance.now();
      this._raf = requestAnimationFrame(this._tick.bind(this));
    }

    _tick(ts) {
      const t = (ts - this._t0) / 1000 * this.speed;
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(this.ox, this.oy);
      ctx.scale(this.sc, this.sc);
      renderFrame(ctx, t, this.b1, this.b2, this.TBC);
      ctx.restore();

      if (t >= TOTAL) {
        if (this.opts.loop) { this._t0 = ts; this._raf = requestAnimationFrame(this._tick.bind(this)); }
        else { cancelAnimationFrame(this._raf); this.opts.onDone && this.opts.onDone(); }
      } else {
        this._raf = requestAnimationFrame(this._tick.bind(this));
      }
    }

    stop() { cancelAnimationFrame(this._raf); }
  }

  // ── API pública ─────────────────────────────────────────────────────────
  const PuntazoIntro = {

    /**
     * OVERLAY: tapa la página y desaparece al terminar.
     * PuntazoIntro.overlay({ onDone: () => {} })
     */
    overlay(opts = {}) {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, {
        position:'fixed', inset:'0', zIndex:'9999',
        background:'#000', pointerEvents:'all',
        transition:'opacity 0.4s ease'
      });
      const canvas = document.createElement('canvas');
      Object.assign(canvas.style, { width:'100%', height:'100%', display:'block' });
      wrap.appendChild(canvas);
      document.body.appendChild(wrap);

      // Botón skip
      const skip = document.createElement('button');
      skip.textContent = 'Skip ›';
      Object.assign(skip.style, {
        position:'absolute', bottom:'24px', right:'32px',
        background:'rgba(255,255,255,0.12)', color:'white', border:'none',
        padding:'8px 18px', borderRadius:'20px', cursor:'pointer',
        fontFamily:'Montserrat,sans-serif', fontSize:'13px', letterSpacing:'1px',
        transition:'background 0.2s'
      });
      skip.onmouseenter = () => skip.style.background = 'rgba(255,255,255,0.25)';
      skip.onmouseleave = () => skip.style.background = 'rgba(255,255,255,0.12)';
      wrap.appendChild(skip);

      const done = () => {
        wrap.style.opacity = '0';
        setTimeout(() => { wrap.remove(); opts.onDone && opts.onDone(); }, 400);
      };
      skip.addEventListener('click', () => { intro.stop(); done(); });

      const intro = new Intro(canvas, { loop:false, onDone: done, speed: opts.speed });
      // Esperar 1 frame para que el canvas tenga dimensiones reales
      requestAnimationFrame(() => { intro._resize(); intro.start(); });
    },

    /**
     * HERO: fondo de sección, puede hacer loop.
     * PuntazoIntro.hero('#mi-canvas', { loop: true })
     * PuntazoIntro.hero(canvasElement, { loop: false })
     */
    hero(target, opts = {}) {
      const canvas = typeof target === 'string' ? document.querySelector(target) : target;
      if (!canvas) { console.error('PuntazoIntro: canvas no encontrado:', target); return; }
      const intro = new Intro(canvas, opts);
      requestAnimationFrame(() => { intro._resize(); intro.start(); });
      return intro;
    }
  };

  global.PuntazoIntro = PuntazoIntro;

})(window);
